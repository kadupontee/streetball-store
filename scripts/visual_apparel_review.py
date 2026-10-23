"""Inspeciona pixels de fotos reais do catálogo com CLIP (sem enviar fotos a serviços externos).

Uso: python scripts/visual_apparel_review.py --max-images 2100 --max-seconds 1900
Apenas audita: NÃO muda preços ou categorias sem confirmação. Grava evidência por SKU.
O modelo aberto pode errar; resultados ambíguos pedem revisão humana.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import re
import time
from collections import Counter
from pathlib import Path

from PIL import Image, ImageOps

ROOT=Path(__file__).resolve().parents[1]
CATALOG=ROOT/"public/catalog.json"
RESULT=ROOT/"scripts/garment_visual_review.json"
SUMMARY=ROOT/"scripts/garment_visual_summary.json"

LABELS={
 "jersey_short":"a product photo of a football soccer jersey short sleeve shirt",
 "jersey_long":"a product photo of a lightweight football jersey shirt with long sleeves",
 "blouse_half_zip":"a product photo of a sporty long sleeve half zip pullover training sweatshirt",
 "blouse_sweatshirt":"a product photo of a cotton crew neck training sweatshirt, no front zipper",
 "blouse_hoodie":"a product photo of a hooded sweatshirt or fleece hoodie",
 "jacket_full_zip":"a product photo of a sports jacket with a full length front zipper",
 "jacket_windbreaker":"a product photo of a hooded windbreaker or waterproof shell jacket",
 "coat":"a product photo of a winter coat or thick insulated overcoat",
 "tracksuit":"a product photo of a matching tracksuit jacket and trousers set",
 "shorts":"a product photo of soccer sports shorts",
 "polo":"a product photo of a polo sports shirt with short sleeves",
 "sleeveless":"a product photo of a sleeveless sports training tank top",
 "pants":"a product photo of long sports training pants or joggers",
 "puffer_vest":"a product photo of a padded sleeveless winter gilet puffer vest with zipper, no sleeves",
 "puffer_coat":"a product photo of a thick quilted winter coat with sleeves and padded hood",
 "jersey_shorts_set":"a product photo showing a short-sleeve soccer jersey alongside matching shorts",
 "sleeveless_shorts_set":"a product photo showing a sleeveless tank top training shirt alongside matching shorts",
 "one_track_jacket":"a product photo of only one track jacket with a full front zipper and no pants",
 "hooded_single_jacket":"a product photo of one lightweight zippered hooded sports jacket and no trousers",
}
GARMENT_HINT=re.compile(
 r"\b(?:sweat|sweater|sudadera|hood|pullover|fleece|half.zip|quarter.zip|"
 r"zipper|track|training|warm.?up|windbreaker|softshell|jacket|casaco|coat|"
 r"blusa|moletom|blusao|treino|long.sleeve|longsleeve|cardigan|"
 r"top|vest|pole?o|polo|pre.?match|trench|anorak|parka|full.zip)\b",re.I
)
VISUAL_KINDS={"jacket","coat","blouse","long","retro_long","set"}
def relative_photo(item):
 u=item.get("image") or next(iter(item.get("images") or []),"")
 if not isinstance(u,str) or not u.startswith("/images/yupoo/"):return None
 name=u.removeprefix("/images/yupoo/")
 if not re.fullmatch(r"[a-zA-Z0-9_.-]+\.(?:png|jpg|jpeg|webp)",name,re.I):return None
 path=ROOT/"public/images/yupoo"/name
 return path if path.is_file() else None

def select(products,max_images):
 relevant=[];other=[]
 for p in products:
  file=relative_photo(p)
  if file is None:continue
  title=str(p.get("supplierTitle") or p.get("title") or "")
  if GARMENT_HINT.search(title) or p.get("kind") in VISUAL_KINDS or p.get("category")=="treino":
   relevant.append((p,file))
  else:other.append((p,file))
 # Deterministic random check of a few otherwise unflagged garments.
 random.Random(20261022).shuffle(other)
 if max_images:
  relevant=relevant[:max_images]
  extra=min(len(other),max(80,max_images//12)) if len(relevant)<max_images else 0
  relevant+=other[:min(extra,max(0,max_images-len(relevant)))]
 return relevant,len(other)

def main():
 import torch
 from transformers import CLIPModel, CLIPProcessor
 parser=argparse.ArgumentParser()
 parser.add_argument("--max-images",type=int,default=2200)
 parser.add_argument("--all-images",action="store_true",help="Examinar cada foto local do catálogo")
 parser.add_argument("--max-seconds",type=int,default=1700)
 parser.add_argument("--model",default="openai/clip-vit-base-patch32")
 args=parser.parse_args()
 data=json.loads(CATALOG.read_text(encoding="utf8"))
 candidates,other=select(data,args.max_images)
 if args.all_images:
  candidates=[(p,file) for p in data if (file:=relative_photo(p)) is not None]
  other=0
 print("TOTAL",len(data),"CANDIDATES",len(candidates),"OTHER_WITH_LOCAL_PHOTO",other,flush=True)
 print("Loading zero-shot visual model",args.model,flush=True)
 torch.set_num_threads(2)
 model=CLIPModel.from_pretrained(args.model).eval()
 processor=CLIPProcessor.from_pretrained(args.model)
 labels=list(LABELS)
 prompts=list(LABELS.values())
 toks=processor(text=prompts,return_tensors="pt",padding=True)
 with torch.inference_mode():
  text_feats=model.get_text_features(**toks)
  text_feats=text_feats/text_feats.norm(dim=-1,keepdim=True)
 rows=[];failures=[];began=time.monotonic()
 def score_batch(batch):
  images=[];entries=[]
  for item,path in batch:
   try:
    with Image.open(path) as im:
     rgb=ImageOps.exif_transpose(im).convert("RGB")
     images.append(rgb.copy())
    entries.append((item,path))
   except Exception as e:
    failures.append({"id":item.get("id"),"why":str(e)[:120]})
  if not images:return
  tensors=processor(images=images,return_tensors="pt")
  with torch.inference_mode():
   v=model.get_image_features(pixel_values=tensors["pixel_values"])
   v=v/v.norm(dim=-1,keepdim=True)
   scores=(100*v@text_feats.T).softmax(dim=-1).cpu()
  for (item,path),probs in zip(entries,scores):
   best=torch.topk(probs,k=3)
   ix=[int(x) for x in best.indices.tolist()]
   top=[{"class":labels[j],"probability":round(float(probs[j]),4)} for j in ix]
   kind=str(item.get("kind") or "")
   predicted=top[0]["class"]
   garment=(
     "blouse" if predicted.startswith("blouse_") else
     "jacket" if predicted.startswith("jacket_") or predicted in ("one_track_jacket","hooded_single_jacket") else
     "coat" if predicted in ("coat","puffer_coat") else
     "vest" if predicted=="puffer_vest" else
     "long" if predicted=="jersey_long" else
     "shorts" if predicted=="shorts" else
     "pants" if predicted=="pants" else
     "set" if predicted in ("tracksuit","jersey_shorts_set","sleeveless_shorts_set") else
     "shirt"
   )
   high=top[0]["probability"]>=0.57 and top[0]["probability"]-top[1]["probability"]>=0.18
   disagrees=(kind in ("fan","long","retro","player_adidas","player_nike","player_puma") and garment in ("blouse","jacket","coat","vest","set","shorts")) or (kind in ("jacket","coat","blouse") and garment in ("shirt","set","vest")) or (kind in ("long","retro_long") and predicted=="jersey_short")
   rows.append({
    "id":item.get("id"),"image":"/images/yupoo/"+path.name,
    "supplierTitle":str(item.get("supplierTitle") or item.get("title") or "")[:175],
    "original_kind":kind,"original_price":item.get("price"),
    "visual_guess":garment,"high_confidence":high,
    "disagrees_with_catalog":disagrees,
    "top":top,
   })
 for n in range(0,len(candidates),12):
  if time.monotonic()-began>args.max_seconds:
   print("Reached time budget",n,"processed",len(rows),flush=True);break
  score_batch(candidates[n:n+12])
  if n%240==0:print("Visual reviewed",len(rows),"/",len(candidates),flush=True)
 RESULT.write_text(json.dumps(rows,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf8")
 disagreed=[r for r in rows if r["disagrees_with_catalog"]]
 high=[r for r in disagreed if r["high_confidence"]]
 summary={
   "method":"CLIP zero-shot classification from each actual local product image; predictions are advisory and not verified by a human",
   "model":args.model,
   "catalog_products":len(data),"candidate_images":len(candidates),
   "all_images_requested":args.all_images,
   "catalog_without_local_photo":len(data)-len(candidates) if args.all_images else None,
   "images_examined":len(rows),"processing_errors":failures[:30],
   "current_kinds":dict(Counter(r["original_kind"] for r in rows)),
   "visual_guesses":dict(Counter(r["visual_guess"] for r in rows)),
   "disagreements":len(disagreed),
   "high_confidence_disagreements":len(high),
   "examples_high_confidence":high[:90],
   "examples_review":disagreed[:70],
   "note":"Confiança do modelo é relativa; sem análise humana individual nenhuma classificação pode ser garantida. Não altera preços ou títulos automaticamente."
 }
 SUMMARY.write_text(json.dumps(summary,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
 print(json.dumps({k:v for k,v in summary.items() if not k.startswith("examples")},ensure_ascii=False),flush=True)

if __name__=="__main__":
 main()
