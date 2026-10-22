"""Audita categorias de vestuário de forma conservadora; não altera preços."""
from __future__ import annotations
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CATALOG=ROOT/'public/catalog.json'
OUT=ROOT/'scripts/garment_audit_summary.json'

def norm(value):
 return ''.join(c for c in unicodedata.normalize('NFD',str(value or '').lower()) if unicodedata.category(c)!='Mn')

JACKET=re.compile(r'\b(jackets?|jacke?t|jaquetas?|casacos?|wind\s*breakers?|windbreakers?|track\s*jackets?|shell\s*jackets?|zip\s*(?:up|jacket)|full\s*zip(?:per)?|half\s*zip(?:per)?|1/2\s*zip(?:per)?|1/4\s*zip(?:per)?|quarter\s*zip(?:per)?|hoodies?|hooded\s*jacket|anoraks?|parka|corta\s*vento|blusao|training\s*top)\b',re.I)
LONG=re.compile(r'\b(long\s*[- ]?sleeves?|long\s*[- ]?sleeved|longsleeves?|ml|mangas?\s*longas?|compridas?\s*sleeves?)\b',re.I)
RETRO=re.compile(r'\b(retro|vintage|classic|classico|classica|heritage)\b',re.I)
SHIRT=re.compile(r'\b(shirts?|jerseys?|camisas?|football\s*kit|soccer\s*kit|uniforme|gk|goalkeepers?)\b',re.I)
SET=re.compile(r'\b(tracksuit|trainings?\s*set|suits?|conjuntos?|kits?|jacket\s*\+\s*pants?|jacket.*\+.*pants?|jaqueta.*\+.*calcas?|2\s*pieces?|two\s*pieces?|sets?)\b',re.I)
SHORTS=re.compile(r'\b(shorts?|calcao|bermuda|socks?|meiao)\b',re.I)
RANGE=re.compile(r'(?<!\d)((?:19|20)\d{2}|\d{2})\s*[-/._]\s*((?:19|20)\d{2}|\d{2})(?!\d)')

def garment_class(item):
 raw=str(item.get('supplierTitle') or item.get('title') or '')
 txt=norm(raw)
 kind=str(item.get('kind') or '')
 has_photo=bool(item.get('image') or item.get('images'))
 jacket=bool(JACKET.search(txt))
 lon=bool(LONG.search(txt))
 retro=bool(RETRO.search(txt)) or kind=='retro_long'
 is_set=bool(SET.search(txt)) and bool(re.search(r'\b(pants?|calcas?|trousers?|bottoms?|conjunto|set|suit|tracksuit)\b',txt))
 # Past-season shirts can be retro even when album omits the word "retro".
 if lon and not retro:
  for m in RANGE.finditer(txt):
   y=m.group(1); year=int(y) if len(y)==4 else 2000+int(y) if int(y)<=28 else 1900+int(y)
   if year<=2021: retro=True
 if SHORTS.search(txt) and not SHIRT.search(txt) and not jacket:return 'other',has_photo
 if jacket and is_set:return 'jacket_set_review',has_photo
 if jacket:return 'jacket',has_photo
 if lon and (SHIRT.search(txt) or kind in ('long','retro_long','retro','fan','player_adidas','player_nike','player_puma')):return ('retro_long' if retro else 'long'),has_photo
 if lon:return 'long_review',has_photo
 if kind=='retro_long':return 'retro_long',has_photo
 if kind=='long':return 'long_review',has_photo
 return 'other',has_photo

def audit(catalog):
 counts=Counter();examples={};samples={}
 for item in catalog:
  category,has_photo=garment_class(item);counts[category]+=1;counts[category+'_photo' if has_photo else category+'_no_photo']+=1
  if category=='other':continue
  name=str(item.get('supplierTitle') or item.get('title') or '')
  example={'id':item.get('id'),'title':name[:180],'kind':item.get('kind'),'category':item.get('category'),'price':item.get('price'),'image':item.get('image'),'sourceUrl':item.get('sourceUrl'),'priceLocked':item.get('priceLocked',False),'categoryLocked':item.get('categoryLocked',False)}
  if len(examples.setdefault(category,[]))<70:examples[category].append(example)
  if has_photo and len(samples.setdefault(category,[]))<16:samples[category].append(example)
 return {'total':len(catalog),'counts':dict(counts),'examples':examples,'image_linked_samples':samples}

if __name__=='__main__':
 result=audit(json.loads(CATALOG.read_text()))
 OUT.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
 print(json.dumps({'total':result['total'],'counts':result['counts'],'sample_counts':{k:len(v) for k,v in result['examples'].items()}},ensure_ascii=False))
