"""Localiza peças potencialmente mal classificadas entre TODAS as fotos auditadas.

Relatório somente de leitura. A probabilidade CLIP é relativa, não autoriza mudança
automática de tipo/preço. Prioriza divergências, conjuntos e títulos pouco claros.
"""
from __future__ import annotations
import json
import re
from collections import Counter
from pathlib import Path
from visual_verified import PHOTO_CONFIRMED, REVIEW_ONLY

ROOT=Path(__file__).resolve().parents[1]
catalog=json.loads((ROOT/"public/catalog.json").read_text(encoding="utf-8"))
visual=json.loads((ROOT/"scripts/garment_visual_review.json").read_text(encoding="utf-8"))
by_id={p.get("id"):p for p in catalog}
already=set(PHOTO_CONFIRMED)|set(REVIEW_ONLY)
outer=set(("jacket_full_zip","jacket_windbreaker","one_track_jacket","hooded_single_jacket","coat","puffer_coat","puffer_vest","blouse_half_zip","blouse_sweatshirt","blouse_hoodie"))
garment_hints=re.compile(r"jacket|hoodie|sweat|fleece|windbreaker|pullover|half.?zip|quarter.?zip|coat|casaco|blusa|moletom|track.?suit|long.?pull|treino|training|kit|suit|套装|外套|卫衣|棉衣|棉服|夹克",re.I)
result=[]
reason_counts=Counter()
for r in visual:
    pid=str(r.get("id") or "")
    n=pid.removeprefix("YUP-")
    p=by_id.get(pid)
    if not p or n in already:continue
    top=r.get("top") or []
    if not top:continue
    t=top[0]; guess=t.get("class") or ""
    prob=float(t.get("probability") or 0)
    second=float((top[1] if len(top)>1 else {}).get("probability") or 0)
    title=str(p.get("supplierTitle") or p.get("title") or "")
    kind=str(p.get("kind") or "")
    hits=bool(garment_hints.search(title))
    reason=None; priority=0
    if guess in outer and kind not in ("jacket","coat","blouse") and prob>=.20:
        reason="possivel_casaco_blusa"
        priority=95 + prob*25 + (12 if hits else 0)
    elif guess in ("tracksuit","jersey_shorts_set","sleeveless_shorts_set") and kind!="set" and prob>=.36:
        reason="possivel_conjunto"
        priority=77 + prob*25 + (15 if hits else 0)
    elif kind in ("jacket","coat","blouse") and guess in ("jersey_short","jersey_long","polo") and prob>=.36:
        reason="possivel_camisa_ou_polo"
        priority=85 + prob*20
    elif hits and kind in ("fan","long","retro","player_adidas","player_nike","player_puma","kids","female") and (p.get("category")=="treino" or guess in outer or guess=="tracksuit"):
        reason="nome_de_treino_pendente"
        priority=70 + prob*20
    if reason is None:continue
    if p.get("visualReviewStatus"):continue
    reason_counts[reason]+=1
    result.append({
      "id":pid,"image":p.get("image"),"title":title[:145],
      "kind":kind,"category":p.get("category"),"price":p.get("price"),
      "vision":guess,"score":prob,"margin":round(prob-second,4),
      "reason":reason,"priority":round(priority,2)
    })
result.sort(key=lambda x:(-x["priority"],x["id"]))
path=ROOT/"scripts"/"remaining_visual_candidates.json"
path.write_text(json.dumps({
    "catalog_size":len(catalog),"images_examined":len(visual),
    "selected_candidates":len(result),"counts_by_reason":dict(reason_counts),
    "already_confirmed_by_photo":len(PHOTO_CONFIRMED),
    "manual_review_only":len(REVIEW_ONLY),
    "method":"Priorizacao pelo modelo e titulo. Nenhuma alteracao automatica de produtos ou precos.",
    "candidates_by_reason":{name: [x for x in result if x["reason"]==name][:70] for name in sorted(reason_counts)}
},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("Candidatos adicionais:",len(result),"amostra",min(200,len(result)))
