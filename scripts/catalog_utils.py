"""Shared catalog utilities. No network access and no vendor credentials here."""
from __future__ import annotations
import json, re, unicodedata
from pathlib import Path
from urllib.parse import urlparse
from retro_policy import apply_retro_policy, is_older_than_five_seasons
from garment_policy import garment_decision, apply_garment_pricing, PRICES_BRL
ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'public' / 'catalog.json'
CATALOG_JS = ROOT / 'public' / 'catalog.js'
CATEGORIES = {'brasileirao','europa','selecoes','retro','infantil','feminino','nba','treino','acessorios','outras'}
PRICES = {'fan':159.90,'female':159.90,'kids':179.90,'retro':199.90,'retro_long':229.90,'long':189.90,
          'player_adidas':209.90,'player_puma':219.90,'player_nike':229.90,'nba':219.90,'shorts':119.90,'shorts_player':143.90,'socks':59.90,'jacket':379.90,'coat':189.90,'blouse':189.90,'set':299.90}
KINDS = set(PRICES)
BRAZIL = ('sao paulo','corinthians','palmeiras','flamengo','gremio','internacional','santos','vasco', 'botafogo','fluminense','bahia','fortaleza','remo','paysandu','cruzeiro','atletico mineiro','bragantino','ceara','sport recife','vitoria','nautico','athletico','paranaense','santa cruz','chapecoense','guarani','figueirense','goias','avai','corinthian')
EUROPE = ('real madrid','barcelona','manchester','arsenal','chelsea','liverpool','tottenham','juventus','milan','napoli','paris','psg','bayern','dortmund','benfica','porto','sporting','braga','valencia','betis','sevilla','ajax','lyon','marseille','villarreal','roma','aston villa','leicester','newcastle','leeds','frankfurt','wolfsburg','st pauli','bremen','hannover')
COUNTRIES = ('brazil','brasil','argentina','portugal','france','franca','england','inglaterra','japan','japao','germany','alemanha','mexico','netherlands','holanda','colombia','australia','uruguay','italy','italia','spain','espanha','croatia','morocco','marrocos','jamaica','korea','coreia','nigeria','egypt','egito','usa','united states','tunisia','ivory coast','senegal','algeria','costa rica','turkey','turkiye')

def normalized(text):
    return ''.join(ch for ch in unicodedata.normalize('NFD',str(text).lower()) if unicodedata.category(ch)!='Mn')

# Linha de basquete removida da Streetball Store. Evitar reimportação de NBA.
NBA_TEAM_MARKERS = ('warriors','lakers','celtics','basketball','brooklyn nets',
                    'chicago bulls','new york knicks','miami heat','toronto raptors',
                    'milwaukee bucks','phoenix suns','dallas mavericks','denver nuggets',
                    'san antonio spurs','memphis grizzlies','los angeles clippers',
                    'oklahoma city thunder','houston rockets','utah jazz','sacramento kings',
                    'new orleans pelicans','philadelphia 76ers','detroit pistons',
                    'minnesota timberwolves','cleveland cavaliers','portland trail blazers',
                    'orlando magic','washington wizards','charlotte hornets','indiana pacers',
                    'atlanta hawks')
def is_nba_product(item):
    if not isinstance(item,dict): return False
    if str(item.get('category','')).strip().lower() == 'nba': return True
    if str(item.get('kind','')).strip().lower() == 'nba': return True
    title = normalized(item.get('title') or '')
    if re.search(r'\bnba\b',title): return True
    return any(term in title for term in NBA_TEAM_MARKERS)


def is_player_shorts(title, kind=''):
    """Identifica calção versão jogador sem confundir com camisa jogador."""
    code=str(kind or '').lower()
    if code=='shorts_player': return True
    if code not in ('','shorts'): return False
    s=normalized(title)
    return bool(re.search(r'\b(shorts?|calcao|bermuda)\b',s) and re.search(r'\b(player|jogador|versao\s+jogador)\b',s))


def classify(title, category_hint=''):
    s = normalized(f'{title} {category_hint}')
    garment,_ = garment_decision({'title':title})
    if garment in ('jacket','coat','blouse'): return 'treino',garment
    if re.search(r'\b(retro|vintage|classic)\b',s) or is_older_than_five_seasons(title): cat = 'retro'
    elif any(x in s for x in ('kids','children','infantil','baby','youth','16-28','16~28','16-30')): cat = 'infantil'
    elif any(x in s for x in ('women','woman','feminina','feminino')): cat = 'feminino'
    elif any(x in s for x in ('basketball','nba','warriors','lakers','celtics')): cat = 'nba'
    elif re.search(r'\b(shorts?|calcao|bermuda|stockings?|socks?|meiao)\b',s): cat = 'acessorios'
    elif any(x in s for x in ('training','tracksuit','suit','windbreaker','polo','pre-match','trainning')): cat = 'treino'
    elif any(x in s for x in BRAZIL): cat = 'brasileirao'
    elif any(x in s for x in EUROPE): cat = 'europa'
    elif any(x in s for x in COUNTRIES): cat = 'selecoes'
    else: cat = 'outras'
    if cat == 'nba': kind = 'nba'
    elif cat == 'infantil': kind = 'kids'
    elif cat == 'feminino': kind = 'female'
    elif cat == 'acessorios': kind = 'socks' if 'sock' in s or 'meiao' in s else 'shorts_player' if is_player_shorts(title) else 'shorts'
    elif cat == 'treino': kind = 'set' if 'suit' in s or 'kit' in s else 'long'
    elif cat == 'retro': kind = 'retro_long' if any(x in s for x in ('long sleeve','long-sleeve','manga longa')) else 'retro'
    elif any(x in s for x in ('long-sleeve','long sleeve','manga longa')): kind = 'long'
    elif any(x in s for x in ('player','jogador','match jersey','player version','players edition')):
        kind = 'player_nike' if 'nike' in s else 'player_puma' if 'puma' in s or 'new balance' in s else 'player_adidas'
    else: kind = 'fan'
    if garment in ('long','retro_long') and cat not in ('nba','infantil','feminino'):
        kind=garment
    return cat,kind

def is_yupoo_album_url(u):
    try:
        p = urlparse(u)
        return p.scheme == 'https' and p.hostname == 'james66jersey.x.yupoo.com' and bool(re.fullmatch(r'/albums/\d+/?',p.path))
    except (ValueError,TypeError):return False

def valid_image_url(u):
    if not isinstance(u,str) or len(u)>2000:return False
    if u.startswith('/images/'):return bool(re.fullmatch(r'/images/[a-zA-Z0-9_.-]+',u))
    try:
        p=urlparse(u)
        return p.scheme=='https' and bool(p.hostname) and not p.username and not p.password
    except (TypeError, ValueError): return False

def normalize_product(raw):
    title = str(raw.get('title') or '').strip()[:170]
    if not title:raise ValueError('Produto sem nome')
    source = str(raw.get('sourceUrl') or '').strip()
    if source and not is_yupoo_album_url(source):raise ValueError('Link de álbum inválido; use james66jersey.x.yupoo.com/albums/ID')
    cat0,kind0=classify(title)
    cat = str(raw.get('category') or cat0).strip().lower()
    kind = str(raw.get('kind') or kind0).strip().lower()
    if cat not in CATEGORIES:cat=cat0
    if kind not in KINDS:kind=kind0
    if not raw.get('kindLocked') and is_player_shorts(title,kind):kind='shorts_player'
    if source:
        aid=re.search(r'/albums/(\d+)',source).group(1)
        product_id='YUP-'+aid
    else:
        product_id=str(raw.get('id') or '').strip()
        if not re.fullmatch(r'[\w-]{3,64}',product_id):raise ValueError('ID inválido; informe um identificador estável')
    images=raw.get('images') or []
    if isinstance(images,str):images=re.split(r'[\n|;]+',images)
    image=raw.get('image')
    if image:images=[image]+images
    images=list(dict.fromkeys(u.strip() for u in images if isinstance(u,str) and valid_image_url(u.strip())))[:200]
    sz=raw.get('sizes') or (['16','18','20','22','24','26','28'] if kind=='kids' else ['Único'] if kind=='socks' else ['P','M','G','GG','XXL','3XL','4XL'])
    if isinstance(sz,str):sz=[s.strip() for s in re.split(r'[,;|]+',sz) if s.strip()]
    price=raw.get('price')
    if price is None or str(price).strip()=='':price=PRICES[kind]
    # Catálogo legado importava calção jogador como calção comum (R$ 119,90).
    # Preserve preços diferentes e itens bloqueados manualmente.
    elif kind=='shorts_player' and not raw.get('priceLocked') and str(price).strip() in ('119.9','119.90','119,90'):
        price=PRICES['shorts_player']
    if isinstance(price,str):price=price.replace('R$','').strip().replace('.','').replace(',','.') if ',' in price else price
    price=float(price)
    if not 1<=price<=100000:raise ValueError('Preço fora do intervalo permitido')
    return apply_garment_pricing(apply_retro_policy({**raw,'id':product_id,'title':title,'category':cat,'kind':kind,'price':round(price,2),
       'image':images[0] if images else '', 'images':images,'imageOrigin':('upload_local' if images[0].startswith('/images/') else 'fornecedor_yupoo') if images else 'ilustracao_svg',
       'source': 'import_yupoo_publico' if source else str(raw.get('source') or 'manual'), 'sourceUrl':source,
       'sizes':sz[:25], 'primary':str(raw.get('primary') or '#ededed'), 'accent':str(raw.get('accent') or '#2e3936'),
       'description':str(raw.get('description') or 'Modelo sob encomenda. Disponibilidade e grade sujeitos à confirmação do fornecedor.')[:450],
       'badge':str(raw.get('badge') or '')[:60]}),require_photo=True)

def read_catalog():
    try:return json.loads(CATALOG.read_text(encoding='utf-8'))
    except (OSError,ValueError):return []

def save_catalog(products):
    products=[apply_garment_pricing(apply_retro_policy(p),require_photo=True) for p in products if not is_nba_product(p)]
    CATALOG.parent.mkdir(parents=True,exist_ok=True)
    content=json.dumps(products,ensure_ascii=False,indent=2)
    path=CATALOG.with_suffix('.json.tmp')
    path.write_text(content+'\n',encoding='utf-8')
    path.replace(CATALOG)
    js=CATALOG_JS.with_suffix('.js.tmp')
    js.write_text('window.STREETBALL_CATALOG = '+json.dumps(products,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
    js.replace(CATALOG_JS)

def merge_catalog(new_products, *, keep_existing=True):
    before=read_catalog() if keep_existing else []
    out={p['id']:p for p in before}
    added=updated=0
    for raw in new_products:
        if is_nba_product(raw): continue
        entry=normalize_product(raw)
        if is_nba_product(entry): continue
        if entry['id'] in out:
            old=out[entry['id']]
            # No-data imports must never discard existing imagery or manually set prices.
            if not entry.get('images') and old.get('images'):
                entry['images']=old['images'];entry['image']=old.get('image','');entry['imageOrigin']=old.get('imageOrigin','')
            if old.get('priceLocked'):
                entry['price']=old['price'];entry['priceLocked']=True
            if old.get('categoryLocked'):
                entry['category']=old['category'];entry['categoryLocked']=True
            updated+=1
        else:added+=1
        out[entry['id']]={**out.get(entry['id'],{}),**entry}
    save_catalog(list(out.values()))
    return {'added':added,'updated':updated,'total':len(out)}
