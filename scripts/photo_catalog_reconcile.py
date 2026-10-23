"""Reconciliar o catalogo completo contra a auditoria visual de 10.885 fotos.

Aplica apenas concordancia FORTE entre nome e classificador visual.
Nao trata probabilidade CLIP como certeza e nao recalcula precos de conjuntos.
"""
from __future__ import annotations
import json
import re
from collections import Counter
from pathlib import Path
from catalog_utils import ROOT, read_catalog, save_catalog

SOURCE = ROOT / "scripts" / "garment_visual_review.json"
REPORT = ROOT / "scripts" / "photo_reconcile_result.json"
OUTER = re.compile(r"\b(?:jacket|windbreaker|corta[ -]?vento|jaqueta|full[ -]?zip|track jacket|anorak|softshell)\b", re.I)
BLOUSE = re.compile(r"\b(?:hoodie|hoodies|sweatshirt|sweater|moletom|blusa|pullover|fleece|half[ -]?zip|quarter[ -]?zip|half[ -]?pull)\b", re.I)
SINGLE_SHIRT = re.compile(r"\b(?:training (?:jersey|shirt)|pre[ -]?match (?:jersey|shirt)|training uniform|training top|camiseta de treino)\b",re.I)
LONG = re.compile(r"\b(?:long[ -]?sleeve|manga longa|retro|vintage|classic|retr[oô])\b",re.I)
MULTI = re.compile(r"\b(?:sets?|kits?|tracksuits?|suits?|conjunto|with pants|and pants|training clothes|two pieces|2[- ]?piece)\b",re.I)
CAN_RETYPE = {"fan","long","retro","retro_long"}
STANDARD = (159.90,189.90,199.90,209.90,219.90,229.90,379.90)

def proposed(p, r):
    if (p.get("kindLocked") or p.get("priceLocked") or p.get("categoryLocked")
        or p.get("visualReviewStatus") or p.get("photoAuditRule")):return None
    if p.get("id")!=r.get("id") or p.get("image")!=r.get("image"):return None
    top=r.get("top") or []
    if len(top)<2:return None
    kind=str(p.get("kind") or "")
    if kind not in CAN_RETYPE:return None
    title=str(p.get("supplierTitle") or p.get("title") or "")
    if MULTI.search(title):return None
    category=str(top[0].get("class") or "")
    score=float(top[0].get("probability") or 0)
    margin=score-float(top[1].get("probability") or 0)
    if category in ("jacket_full_zip","jacket_windbreaker","one_track_jacket","hooded_single_jacket") and OUTER.search(title) and score>=0.65 and margin>=0.35:
        return ("jacket","treino",379.90,"modelo+titulo:jaqueta")
    if category.startswith("blouse_") and BLOUSE.search(title) and score>=0.64 and margin>=0.27:
        return ("blouse","treino",189.90,"modelo+titulo:blusa")
    if kind=="long" and category in ("jersey_short","polo") and score>=0.85 and margin>=0.65:
        if SINGLE_SHIRT.search(title) and not LONG.search(title) and not re.search(r"\b(?:player|jogador|vest|sleeveless)\b",title,re.I):
            return ("fan","treino",159.90,"modelo+titulo:camiseta_curta")
    return None

def reconcile(products, audit):
    visions={str(v.get("id")):v for v in audit}
    changed=[]; pending=[]; reasons=Counter(); checked=0; unchecked=[]
    revised=[]
    for p in products:
        key=str(p.get("id") or "")
        v=visions.get(key)
        if not v or p.get("image")!=v.get("image"):
            unchecked.append(key);revised.append(p);continue
        checked+=1
        prop=proposed(p,v)
        new=p
        if prop:
            kind,cat,price,why=prop
            try:old=float(p.get("price") or 0)
            except (TypeError,ValueError):old=0
            if any(abs(old-x)<0.01 for x in STANDARD):
                new={**p,"kind":kind,"category":cat,"price":price,
                     "kindLocked":True,"categoryLocked":True,"priceLocked":True,
                     "photoAuditRule":why,"photoAuditSource":"CLIP_plus_supplier_title",
                     "photoAuditReviewedImage":p["image"]}
                reasons[why]+=1
                changed.append({"id":key,"before":p.get("kind"),"after":kind,
                                "old_price":p.get("price"),"new_price":price})
        if new is p and not p.get("kindLocked"):
            top=v.get("top") or []
            if top and top[0].get("class") in ("tracksuit","jersey_shorts_set","sleeveless_shorts_set") and p.get("kind")!="set" and float(top[0].get("probability") or 0)>=0.85:
                if len(pending)<140:pending.append({"id":key,"title":p.get("supplierTitle"),"kind":p.get("kind"),"image":p.get("image")})
        revised.append(new)
    if checked < 10500 or len(revised)!=len(products):
        raise RuntimeError("Auditoria visual incompleta: nenhuma alteracao publicada")
    return revised,{"catalog_items":len(products),"previously_scanned_images":len(audit),
        "matched_images":checked,"without_corresponding_scanned_image":len(unchecked),
        "new_safe_corrections":len(changed),"corrections_by_rule":dict(reasons),
        "corrected_items":changed,"unpriced_possible_set_examples":pending,
        "not_repriced":"Conjuntos, coletes, roupas sem foto e modelos ambiguos",
        "limits":"Triagem automatica de cada foto com CLIP e titulo; nao equivale a 10 mil revisoes humanas."}

def main():
    products=read_catalog()
    audit=json.loads(SOURCE.read_text(encoding="utf8"))
    result, summary=reconcile(products,audit)
    if summary["new_safe_corrections"]:save_catalog(result)
    REPORT.write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print(json.dumps({k:v for k,v in summary.items() if k not in ("corrected_items","unpriced_possible_set_examples")},ensure_ascii=False))

if __name__=="__main__":main()
