#!/usr/bin/env python3
"""Atualiza referências fotográficas a partir de fabricantes/lojas reconhecidas.

Modo padrão: descoberta e auditoria, não publica imagens alheias comercialmente.
- Busca uma página por produto com fonte pré-verificada e, opcionalmente, descoberta de
  novas URLs via feed RSS público (best-effort; nenhum serviço externo é garantido).
- Não altera preços nem campos de catálogo do fornecedor.
- Só coloca foto na vitrine se o operador autorizar especificamente o domínio por
  contrato/licença e habilitar --publish-authorized. Sem licença mantém fila de análise.
- Não contorna captcha, senha, limitação de acesso nem proibição dos provedores.

Execute: python scripts/sync_official_images.py --max-products 49
"""
from __future__ import annotations
import argparse, datetime as dt, html, json, os, re, sys, time, unicodedata, urllib.error, urllib.parse, urllib.request, xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from catalog_utils import ROOT, read_catalog, save_catalog, valid_image_url

CONFIG_PATH=ROOT/'scripts'/'official_image_sources.json'
CANDIDATES=ROOT/'scripts'/'official_image_candidates.json'
USER_AGENT='StreetballCatalogResearch/1.0 (technical contact: store owner; product reference search)'
MAX_SIZE=2_000_000

def simplified(value):
    return re.sub(r'\s+',' ',''.join(c for c in unicodedata.normalize('NFD',str(value).casefold()) if unicodedata.category(c)!='Mn')).strip()

def trusted_domain(url,domains):
    try:
        o=urllib.parse.urlsplit(url)
        h=o.hostname or ''
        return o.scheme=='https' and not o.username and not o.password and o.port in (None,443) and any(h==d or h.endswith('.'+d) for d in domains)
    except (TypeError, ValueError):return False

def match_features(text):
    s=simplified(text)
    teams={
      'real madrid':['real madrid'],'corinthians':['corinthians'],'flamengo':['flamengo','cr flamengo'],
      'sao paulo':['sao paulo','spfc'],'brasil':['brasil','brazil'],'palmeiras':['palmeiras'],
      'santos':['santos'],'gremio':['gremio'],'internacional':['internacional'],'barcelona':['barcelona'],
      'manchester united':['manchester united'],'manchester city':['manchester city'],
      'arsenal':['arsenal'],'benfica':['benfica'],'portugal':['portugal'],
      'golden state warriors':['golden state warriors','warriors']}
    team=next((k for k,vals in teams.items() if any(re.search(r'(?<!\w)'+re.escape(v)+r'(?!\w)',s) for v in vals)),None)
    years=[]
    for m in re.finditer(r'(?<!\d)(20\d\d|19\d\d)\s*[/\-]\s*(\d{2}|20\d\d)(?!\d)',s):
        years.append((int(m.group(1)), int(m.group(2)) if len(m.group(2))==4 else 2000+int(m.group(2))))
    if not years:
        for m in re.finditer(r'(?<!\d)(20\d\d|19\d\d)(?!\d)',s):years.append((int(m.group(1)), None))
        # 26/27 without explicit millennium
        if not years:
            for m in re.finditer(r'(?<!\d)(\d{2})\s*[/\-]\s*(\d{2})(?!\d)',s):
                a,b=int(m.group(1)),int(m.group(2));years.append(((1900 if a>75 else 2000)+a,(1900 if b>75 else 2000)+b))
    # Exact isolated roman numerals or predictable manufacturer text before team.
    kit=None
    if re.search(r'\b(?:iii|3|terceir[ao]|third|3rd|kit\s*3)\b',s): kit=3
    elif re.search(r'\b(?:ii|2|segund[ao]|away|2nd|kit\s*2)\b',s):kit=2
    elif re.search(r'\b(?:i|1|primeir[ao]|home|1st|kit\s*1)\b',s):kit=1
    # Caution: don't treat generic digits in jersey player number as kit number.
    if re.search(r'\b(?:jogador|authentic|match|player version|versao do jogador)\b',s):variant='player'
    elif re.search(r'\b(?:torcedor|fa|fan|stadium|replica)\b',s):variant='fan'
    else:variant=None
    if re.search(r'\b(?:feminin[ao]|women|woman|womens)\b',s):audience='female'
    elif re.search(r'\b(?:infantil|kid|kids|juvenil|crianca|children|junior|youth)\b',s):audience='kids'
    elif re.search(r'\b(?:masculin[ao]|homem|men)\b',s):audience='men'
    else:audience=None
    return dict(team=team,years=years,kit=kit,variant=variant,audience=audience)

def compare(product, found_title):
    """Fail closed: ambiguous/unrelated images cannot be published."""
    wanted=match_features(product['title']);got=match_features(found_title)
    reasons=[]
    if not wanted['team'] or wanted['team']!=got['team']:reasons.append('clube/seleção não confirmado')
    wy=wanted['years'];gy=got['years']
    if not wy or not gy:reasons.append('temporada ausente')
    elif not any(a==b and (ae==be or ae is None or be is None) for a,ae in wy for b,be in gy):reasons.append('temporada diferente')
    if wanted['kit'] is None or got['kit'] is None or wanted['kit']!=got['kit']:reasons.append('I/II/III não confirmado')
    if wanted['audience'] and got['audience'] and wanted['audience']!=got['audience']:reasons.append('público diferente')
    if product.get('kind')=='kids' and got['audience']!='kids':reasons.append('infantil não confirmado')
    if product.get('kind')=='female' and got['audience']!='female':reasons.append('feminino não confirmado')
    if 'player' in str(product.get('kind')) and got['variant']!='player':reasons.append('versão jogador não confirmada')
    if product.get('kind')=='fan' and got['variant'] not in ('fan', None):reasons.append('versão torcedor diferente')
    if 'retro' in product.get('kind','') and not re.search(r'\b(?:retro|classic|vintage|199\d|200\d)\b',simplified(found_title)):reasons.append('retrô não confirmado')
    return not reasons, reasons

class MetaParser(HTMLParser):
    def __init__(self):super().__init__();self.meta=[];self.ld=[];self._json=False;self._current='';self.title='';self._title=False
    def handle_starttag(self,tag,attrs):
        data=dict(attrs)
        if tag=='meta':self.meta.append(data)
        if tag=='script' and data.get('type','').lower()=='application/ld+json':self._json=True;self._current=''
        if tag=='title':self._title=True
    def handle_data(self,data):
        if self._json:self._current+=data
        if self._title:self.title+=data
    def handle_endtag(self,tag):
        if tag=='script' and self._json:
            try:self.ld.append(json.loads(self._current))
            except (ValueError,TypeError):pass
            self._json=False
        if tag=='title':self._title=False

def iter_product_jsonld(values):
    if isinstance(values,list):
        for v in values:yield from iter_product_jsonld(v)
    if isinstance(values,dict):
        if values.get('@type')=='Product' or (isinstance(values.get('@type'),list) and 'Product' in values['@type']):yield values
        for k in ('@graph','mainEntity','itemListElement'):
            if k in values:yield from iter_product_jsonld(values[k])

def parse_product_page(body,url):
    parser=MetaParser();parser.feed(body)
    meta={str(m.get('property') or m.get('name') or '').lower():m.get('content','') for m in parser.meta}
    title=meta.get('og:title') or parser.title
    images=[]
    for j in parser.ld:
        for row in iter_product_jsonld(j):
            title=row.get('name') or title
            imgs=row.get('image',[]);imgs=imgs if isinstance(imgs,list) else [imgs]
            for i in imgs:
                val=i.get('url') or i.get('contentUrl') if isinstance(i,dict) else i
                if isinstance(val,str):images.append(urllib.parse.urljoin(url,val))
    if meta.get('og:image'):images.append(urllib.parse.urljoin(url,meta['og:image']))
    if meta.get('twitter:image'):images.append(urllib.parse.urljoin(url,meta['twitter:image']))
    images=list(dict.fromkeys(i for i in images if valid_image_url(i) and i.startswith('https://')))
    return dict(title=html.unescape(str(title)),images=images[:16])

def fetch_text(url,timeout=12):
    req=urllib.request.Request(url,headers={'User-Agent':USER_AGENT,'Accept':'text/html,application/xml,application/rss+xml;q=0.9'})
    with urllib.request.urlopen(req,timeout=timeout) as result:
        if result.status!=200:raise OSError('HTTP '+str(result.status))
        typ=result.headers.get('Content-Type','')
        if not any(x in typ.lower() for x in ('text/','xml','application/json')):raise ValueError('Resposta não textual')
        data=result.read(MAX_SIZE+1)
        if len(data)>MAX_SIZE:raise ValueError('Página grande demais')
    return data.decode('utf-8','replace')

def find_via_public_rss(p,domains,max_results=10):
    # Busca pública convencional, sem chave. O provedor pode não devolver RSS: falha sem alterar o catálogo.
    q='"'+p['title'].replace('—',' ')+'" (camisa OR jersey) ('+' OR '.join('site:'+d for d in domains)+')'
    url='https://www.bing.com/search?'+urllib.parse.urlencode({'q':q,'format':'rss'})
    root=ET.fromstring(fetch_text(url))
    found=[]
    for item in root.findall('.//item'):
        link=(item.findtext('link') or '').strip();title=(item.findtext('title') or '').strip()
        ok,reasons=compare(p,title)
        if trusted_domain(link,domains) and ok:
            found.append(dict(url=link,title=title,mode='discovered',site=urlsplit(link).hostname))
        if len(found)>=max_results:break
    return found

def sync(products,config, *, fetch=fetch_text, discover=False, publish=False, authorized=(), approved_ids=(), limit=0, pause=.4, no_fetch=False):
    domains=config['trusted_domains']; reference={row['product_id']:row for row in config['sources'] if not row.get('unverified') and not row.get('listing_only')}
    results=[];changed=0;investigated=0
    for p in products:
        if limit and investigated>=limit:break
        investigated+=1;matches=[];errors=[]
        candidates=[]
        if p['id'] in reference:candidates.append({**reference[p['id']],'mode':'curated'})
        if discover and not no_fetch:
            try:candidates.extend(find_via_public_rss(p,domains))
            except Exception as e:errors.append('Busca indisponível: '+type(e).__name__)
        seen=set()
        if no_fetch:candidates=[]
        for item in candidates[:6]:
            url=item['url']
            if url in seen or not trusted_domain(url,domains):continue
            seen.add(url)
            try:
                data=parse_product_page(fetch(url),url)
                ok,reasons=compare(p,data['title'])
                if not ok:errors.append(url+': '+', '.join(reasons));continue
                images=[u for u in data['images'] if trusted_domain(u,domains) or trusted_domain(url,domains)]
                if not images:errors.append('Sem foto acessível: '+url);continue
                matches.append(dict(sourcePage=url,sourceSite=item.get('site') or urlsplit(url).hostname,foundTitle=data['title'],photos=images,match='estrito',publishable=False,rights='autorização comercial não confirmada'))
            except (OSError,ValueError,TimeoutError,urllib.error.URLError) as e:errors.append('Fonte inacessível '+urlsplit(url).hostname+': '+type(e).__name__)
            time.sleep(pause)
        for match in matches:
            host=urlsplit(match['sourcePage']).hostname
            licensed=any(host==d or host.endswith('.'+d) for d in authorized)
            match['publishable']=licensed and p['id'] in approved_ids
            if licensed:match['rights']='Licença indicada pelo operador para a origem. Requer correspondência física do produto.'
            if licensed and p['id'] not in approved_ids:match['rights']='Falta confirmar que a imagem representa exatamente o produto que será entregue ao comprador.'
            if publish and match['publishable'] and not p.get('images') and not p.get('imageLocked'):
                p['image']=match['photos'][0];p['images']=match['photos'];p['imageOrigin']='fonte_licenciada_externa';p['imageSourceUrl']=match['sourcePage'];changed+=1
                break
        results.append(dict(id=p['id'],title=p['title'],referenceUrl=reference.get(p['id'],{}).get('url',''),referenceTitle=reference.get(p['id'],{}).get('expected',''),sources=matches,errors=errors[:8],status='aprovado_para_sincronizar' if any(x['publishable'] for x in matches) else 'pendente_de_licenca' if matches else 'fonte_identificada_sem_fotos' if p['id'] in reference else 'sem_correspondencia_confirmada'))
    return results,changed

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--max-products',type=int,default=49)
    ap.add_argument('--discover',action='store_true',help='Tenta descobrir páginas de produto via resultados RSS públicos de sites confiáveis')
    ap.add_argument('--publish-authorized',action='store_true',help='Só publica imagens de domínios previamente autorizados via variáveis; caso contrário, gera relatório')
    ap.add_argument('--report-only',action='store_true');ap.add_argument('--no-fetch',action='store_true',help='Gera fila a partir de URLs pesquisadas, sem acessar sites externos');ap.add_argument('--pause',type=float,default=.5)
    args=ap.parse_args()
    config=json.loads(CONFIG_PATH.read_text(encoding='utf-8'));catalog=read_catalog()
    allowed=tuple(d.strip().lower() for d in os.getenv('AUTHORIZED_IMAGE_DOMAINS','').split(',') if d.strip())
    trusted=config['trusted_domains'];allowed=tuple(d for d in allowed if d in trusted)
    approved_ids=tuple(x.strip().upper() for x in os.getenv('APPROVED_PRODUCT_IMAGE_IDS','').split(',') if re.fullmatch(r'[A-Za-z0-9_-]{3,64}',x.strip()))
    results,changed=sync(catalog,config,discover=args.discover,publish=args.publish_authorized and not args.report_only,authorized=allowed,approved_ids=approved_ids,limit=max(0,args.max_products),pause=max(.05,args.pause),no_fetch=args.no_fetch)
    CANDIDATES.write_text(json.dumps({'generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'publishedNewImages':changed,'allowedDomains':list(allowed),'items':results},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    if changed:save_catalog(catalog)
    print(json.dumps({'checked':len(results),'matched':sum(bool(x['sources']) for x in results),'published':changed,'pending':sum(x['status']=='pendente_de_licenca' for x in results),'report':str(CANDIDATES)},ensure_ascii=False))

if __name__=='__main__':main()
