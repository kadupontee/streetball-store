(() => {
'use strict';
const $=id=>document.getElementById(id);
const CATS=[['todos','Todos'],['brasileirao','Brasileirão'],['europa','Europa'],['selecoes','Seleções'],['retro','Retrô'],['personalizadas','Personalizadas'],['player','Jogador'],['infantil','Infantil'],['feminino','Feminino'],['treino','Treino'],['acessorios','Acessórios'],['outras','Outros produtos']];
const TILES=[['brasileirao','BRASILEIRÃO','Clubes nacionais','#fcfcfc','#cf292c'],['europa','EUROPA','Grandes ligas','#152f6f','#cf3b4f'],['selecoes','SELEÇÕES','Futebol mundial','#ead039','#136849'],['retro','RETRÔ','Lendas eternas','#17549d','#f8e4c6'],['player','JOGADOR','Versão de campo','#eee','#1b2b4a'],['infantil','INFANTIL','Pequenos craques','#c42c3c','#1b1d1c']];

// Subcategorias da Série A 2026 (lista oficial da CBF).
const BR_CLUBS=[
 ['athletico-pr','Athletico-PR',['athletico paranaense','athletico pr','athletico']],
 ['atletico-mg','Atlético-MG',['atletico mineiro','atletico mg','atletico m g']],
 ['bahia','Bahia',['bahia']], ['botafogo','Botafogo',['botafogo']],
 ['chapecoense','Chapecoense',['chapecoense']], ['corinthians','Corinthians',['corinthians','corinthian']],
 ['coritiba','Coritiba',['coritiba']], ['cruzeiro','Cruzeiro',['cruzeiro']],
 ['flamengo','Flamengo',['flamengo']], ['fluminense','Fluminense',['fluminense']],
 ['gremio','Grêmio',['gremio']], ['internacional','Internacional',['internacional porto alegre','internacional rs','internacional']],
 ['mirassol','Mirassol',['mirassol']], ['palmeiras','Palmeiras',['palmeiras']],
 ['bragantino','Red Bull Bragantino',['red bull bragantino','rb bragantino','bragantino']],
 ['remo','Remo',['clube do remo','clube remo','remo']], ['santos','Santos',['santos']],
 ['sao-paulo','São Paulo',['sao paulo','saopaulo']], ['vasco','Vasco da Gama',['vasco da gama','vasco']],
 ['vitoria','Vitória',['vitoria']]
];
const clubNormalized=s=>String(s||'').replace(/(\d)([A-Za-zÀ-ÿ])/g,'$1 $2').replace(/([a-zà-ÿ])([A-Z])/g,'$1 $2').replace(/(flamengo|gremio|vasco|santos|remo)(home|away|black|special|goalkeeper)/gi,'$1 $2').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function findBrazilClub(p){
 if(p.category==='europa'||p.category==='selecoes')return '';
 const name=' '+clubNormalized(p.supplierTitle||p.title)+' ';
 for(const [slug,,aliases] of BR_CLUBS){
   if(!aliases.some(term=>name.includes(' '+term+' ')))continue;
   if(slug==='santos'&&/\bsantos laguna\b/.test(name))continue;
   if(slug==='botafogo'&&/\bbotafogo (sp|pb)\b/.test(name))continue;
   if(slug==='vitoria'&&/\bvitoria (guimaraes|setubal)\b/.test(name))continue;
   if(slug==='cruzeiro'&&/\bcruzeiro (rs|do sul)\b/.test(name))continue;
   return slug;
 }
 return '';
}
const clubFor=p=>p.brazilClub===undefined?findBrazilClub(p):p.brazilClub;
const isBrazilProduct=p=>!!clubFor(p)||(p.category==='brasileirao'&&!/\b(santos laguna|manchester united|cremona)\b/.test(clubNormalized(p.supplierTitle||p.title)));
function renderBrazilClubNavigation(){
 const section=$('brasileiraoClubs');
 if(!section)return;
 section.hidden=state.category!=='brasileirao'||state.favoritesOnly;
 if(section.hidden)return;
 const totals=Object.fromEntries(BR_CLUBS.map(([slug])=>[slug,0]));
 let all=0,other=0;
 for(const p of catalog){
   if(!hasVerifiedPhoto(p)||!isBrazilProduct(p))continue;
   all++;
   const club=clubFor(p);
   if(club&&Object.hasOwn(totals,club))totals[club]++;
   else other++;
 }
 const current=state.club;
 const opts=[['todos','Todos os clubes',all],...BR_CLUBS.map(([slug,title])=>[slug,title,totals[slug]]),['outros','Outros clubes brasileiros',other]];
 $('brasileiraoClubGrid').innerHTML=opts.map(([slug,title,n])=>'<button type="button" class="br-club '+(current===slug?'active':'')+'" data-br-club="'+esc(slug)+'" aria-pressed="'+(current===slug)+'" aria-label="'+esc(title)+', '+n+' modelos"><span class="br-club-name">'+esc(title)+'</span><span class="br-club-count">'+n+' '+(n===1?'modelo':'modelos')+'</span></button>').join('');
}
function selectBrazilClub(slug){
 if(!BR_CLUBS.some(([id])=>id===slug)&&slug!=='todos'&&slug!=='outros')return;
 state.category='brasileirao';state.club=slug;state.limit=PRODUCT_LIMIT;state.favoritesOnly=false;state.query='';$('globalSearch').value='';
 catalogRender();
 $('productsGrid').scrollIntoView({behavior:'smooth',block:'start'});
}

const ADDON={personalization:20,patch:8,size:{XXL:5,'3XL':10,'4XL':15}};
const PRODUCT_LIMIT=36;
const isBasketball=p=>p?.category==='nba'||p?.kind==='nba'||/\b(nba|basketball)\b/i.test(String(p?.title||''));
let catalog=(Array.isArray(window.STREETBALL_CATALOG)?window.STREETBALL_CATALOG:[]).filter(p=>!isBasketball(p));
const ls=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
const persist=(key,val)=>{try{localStorage.setItem(key,JSON.stringify(val))}catch{}};
let state={checkoutRequestKey:null,checkoutPayload:null,checkoutReady:false,checkoutSandbox:false,checkoutShipping:null,category:'todos',club:'todos',query:'',sort:'featured',limit:PRODUCT_LIMIT,favoritesOnly:false,favorites:ls('streetball_favorites',[]),cart:ls('streetball_cart',[]),detail:null,choice:null,drawer:false,checkout:false};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)||0);
const localImageURL=u=>String(u||'').startsWith('/images/')?new URL(String(u).slice(1),document.baseURI).href:String(u||'');
const imgValid=u=>/^(https:\/\/[^\s"<>]+|\/images\/(?:yupoo\/)?[a-zA-Z0-9_.-]+)$/i.test(String(u||''));
// So anunciar produtos cuja fotografia autorizada foi hospedada na propria loja.
// Aceitar capas reais do fornecedor e imagens autorizadas hospedadas nesta loja.
const trustedPhoto=u=>typeof u==='string' && (/^\/images\/[a-zA-Z0-9_./-]+\.(?:webp|jpe?g|png)$/i.test(u) && !u.includes('..') || /^https:\/\/photo\.yupoo\.com\/james66jersey\/[a-zA-Z0-9_./-]+\.(?:webp|jpe?g|png)(?:\?[^"<>\\s]*)?$/i.test(u));
const photoSources=p=>[p.image,...(Array.isArray(p.images)?p.images:[]),p.sourceImageUrl].filter((u,i,all)=>trustedPhoto(u)&&all.indexOf(u)===i);
const hasVerifiedPhoto=p=>photoSources(p).length>0;
function jersey(p,extra=''){
const a=esc(p.primary||'#ededed'),b=esc(p.accent||'#304130'),id='i'+Math.random().toString(36).slice(2,9);
const isNBA=p.kind==='nba',isShort=p.kind==='shorts'||p.kind==='shorts_player',isSocks=p.kind==='socks';
if(isSocks)return `<svg class="jersey-drawing ${extra}" viewBox="0 0 280 300" role="img" aria-label="Ilustração de meião"><g fill="${a}" stroke="${b}" stroke-width="2"><path d="M74 40h60v156q0 27-34 27H70v-28h32l-28-12Z"/><path d="M149 40h60v156q0 27-34 27h-30v-28h32l-28-12Z"/></g><path d="M73 71h61m15 0h61M73 81h61m15 0h61" stroke="${b}" stroke-width="8"/></svg>`;
if(isShort)return `<svg class="jersey-drawing ${extra}" viewBox="0 0 280 300" role="img" aria-label="Ilustração de calção"><defs><filter id="${id}"><feDropShadow dx="0" dy="8" stdDeviation="6" flood-opacity=".15"/></filter></defs><path filter="url(#${id})" d="M64 87h150l12 118-74 15-12-68-12 68-74-15Z" fill="${a}" stroke="${b}" stroke-width="3"/><path d="M64 99h150" stroke="${b}" stroke-width="7"/></svg>`;
return `<svg class="jersey-drawing ${extra}" viewBox="0 0 310 330" role="img" aria-label="Ilustração de produto; foto a confirmar"><defs><filter id="${id}" x="-20%" y="-20%" width="150%" height="170%"><feDropShadow dx="0" dy="11" stdDeviation="7" flood-opacity=".19"/></filter><linearGradient id="shine-${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".28"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".19"/></linearGradient><clipPath id="shirt-${id}"><path d="M105 54q50 36 100 0l52 26 35 74-50 23-21-36v143H89V141l-21 36-50-23 35-74Z"/></clipPath></defs><path filter="url(#${id})" d="M105 54q50 36 100 0l52 26 35 74-50 23-21-36v143H89V141l-21 36-50-23 35-74Z" fill="${a}" stroke="${b}" stroke-opacity=".36" stroke-width="2"/><g clip-path="url(#shirt-${id})">${(isNBA?`<path d="M122 47h66v31q-33 18-66 0Z" fill="${b}"/>`:`<path d="M89 80h132v200H89Z" fill="${b}" opacity=".13"/><path d="M106 81h19v208h-19zm40 0h19v208h-19zm40 0h19v208h-19z" fill="${b}" opacity=".3"/>`)}<rect x="18" y="50" width="274" height="234" fill="url(#shine-${id})"/></g><path d="M125 65q30 26 60 0l-7 21q-23 15-46 0Z" fill="${b}"/><path d="M154 104v173" stroke="${b}" stroke-opacity=".17"/><circle cx="189" cy="119" r="10" fill="${b}" stroke="#fff" stroke-opacity=".6" stroke-width="2"/><path d="M115 115h24" stroke="${b}" stroke-width="7" stroke-linecap="round"/>${isNBA?`<text x="155" y="191" font-size="50" font-family="Arial" text-anchor="middle" font-weight="900" fill="${b}">30</text>`:''}</svg>`;
}
function imageHTML(p,extra=''){
 const urls=photoSources(p);
 if(!urls.length)return '<span class="product-no-photo">FOTO INDISPONÍVEL</span>';
 const first=urls[0],fallback=urls.slice(1).join('|');
 return `<span class="product-asset"><img class="product-photo" src="${esc(localImageURL(first))}" data-fallback="${esc(fallback)}" alt="${esc(p.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`;
}
// Se a foto local ou do fornecedor falhar, tentar a proxima URL do MESMO album.
document.addEventListener('error', e=>{
 const img=e.target;
 if(!(img instanceof HTMLImageElement)||!img.classList.contains('product-photo'))return;
 const next=(img.dataset.fallback||'').split('|').filter(trustedPhoto);
 if(next.length){img.dataset.fallback=next.slice(1).join('|');img.src=localImageURL(next[0]);return;}
 const holder=img.closest('.product-asset');
 if(holder){holder.classList.add('missing-photo');holder.innerHTML='<span class="product-no-photo">FOTO TEMPORARIAMENTE INDISPONÍVEL</span>';}
},true);
const matchCategory=(p,c)=>c==='todos'||(c==='brasileirao'?isBrazilProduct(p):p.category===c)||(c==='infantil'&&p.kind==='kids')||(c==='feminino'&&p.kind==='female')||(c==='player'&&(String(p.kind).startsWith('player_')||p.kind==='shorts_player'))||(c==='personalizadas'&&!['acessorios','treino'].includes(p.category)&&!['socks','shorts','shorts_player'].includes(p.kind));
function filtered(){
 let ps=catalog.filter(p=>hasVerifiedPhoto(p)&&matchCategory(p,state.category));
 if(state.category==='brasileirao'&&state.club!=='todos'){
   ps=ps.filter(p=>state.club==='outros'?!clubFor(p):clubFor(p)===state.club);
 }
 if(state.query)ps=ps.filter(p=>[p.title,p.category,p.kind].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(state.query.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()));
 if(state.favoritesOnly)ps=ps.filter(p=>state.favorites.includes(p.id));
 // Fotos efetivamente guardadas na loja primeiro; exemplos sem imagem por último.
 if(state.sort==='featured'){
  const rank=p=>p.imageOrigin==='cache_autorizado'||p.imageOrigin==='upload_local'?3:(p.image&&String(p.id).startsWith('YUP-')?2:(p.image?1:0));
  ps.sort((a,b)=>rank(b)-rank(a));
 }
 if(state.sort==='lowest')ps.sort((a,b)=>a.price-b.price);
 if(state.sort==='highest')ps.sort((a,b)=>b.price-a.price);
 if(state.sort==='az')ps.sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'));
 return ps;
}

// O nome original do fornecedor e mantido em supplierTitle.
const TEAM_NAMES={
 'ivory coast':'Costa do Marfim','united states':'Estados Unidos','south korea':'Coreia do Sul','saudi arabia':'Arábia Saudita',
 'real madrid':'Real Madrid','atletico madrid':'Atlético de Madrid','vasco da gama':'Vasco da Gama','sao paulo':'São Paulo',
 'bayern munich':'Bayern de Munique','borussia dortmund':'Borussia Dortmund','dortmund':'Borussia Dortmund',
 'marseille':'Olympique de Marseille','braga':'SC Braga','brazil':'Brasil','spain':'Espanha','germany':'Alemanha',
 'england':'Inglaterra','france':'França','netherlands':'Holanda','italy':'Itália','japan':'Japão','korea':'Coreia',
 'uruguay':'Uruguai','morocco':'Marrocos','tunisia':'Tunísia','algeria':'Argélia','egypt':'Egito','switzerland':'Suíça',
 'sweden':'Suécia','denmark':'Dinamarca','norway':'Noruega','finland':'Finlândia','turkey':'Turquia','mexico':'México',
 'colombia':'Colômbia','australia':'Austrália','croatia':'Croácia','serbia':'Sérvia','poland':'Polônia','greece':'Grécia',
 'usa':'Estados Unidos','scotland':'Escócia','ireland':'Irlanda','wales':'País de Gales','belgium':'Bélgica',
 'austria':'Áustria','almeria':'Almería','gremio':'Grêmio','psg':'Paris Saint-Germain'
};
const REPLACEMENTS=Object.entries(TEAM_NAMES).sort((a,b)=>b[0].length-a[0].length).map(([name,pt])=>[new RegExp('\\b'+name+'\\b','gi'),pt]);
const KEEP_UPPER=new Set(['sc','fc','ac','pec','rb','afc','psg','psv','usa','cf','cd','ss','as']);
function niceCase(s){return s.split(/\s+/).map((word,i)=>{let l=word.toLocaleLowerCase('pt-BR');return KEEP_UPPER.has(l)?l.toUpperCase():i&&['de','do','da','dos','das','e'].includes(l)?l:l.replace(/^\p{L}/u,v=>v.toLocaleUpperCase('pt-BR'));}).join(' ')}
function displayTitle(p){
 if(!String(p.id||'').startsWith('YUP-'))return p.title;
 let t=String(p.supplierTitle||p.title||'').replace(/[\u4e00-\u9fff]/g,' ').replace(/[‐‑–—]/g,'-').replace(/\s+/g,' ').trim();
 const kids=/\b16\s*[-~]\s*(28|30)\b|\b(kids?|children|child|youth)\b/i.test(t)||p.kind==='kids';
 t=t.replace(/\b16\s*[-~]\s*(28|30)\b/g,' ').replace(/^(\d{2})(\d{2})(?=[A-Za-zÀ-ÿ])/,'$1-$2 ');
 let season='',m=t.match(/\b(20\d{2})\s*[-_/]\s*(\d{2})\b/);
 if(m)season=m[1]+'/'+m[2];else{m=t.match(/\b([0-9]{2})\s*[-_/]\s*(\d{2})\b/);if(m)season=(Number(m[1])>=80?'19':'20')+m[1]+'/'+m[2];}
 if(m&&season)t=t.replace(m[0],' ');
 let type=p.kind==='jacket'?'Jaqueta':'Camisa';
 const types=[[/trench\s*coat|long\s*coat|winter\s*coat/i,'Casaco longo'],[/tracksuit|track\s*suit|training\s*suit/i,'Agasalho'],[/windbreaker|wind\s*breaker/i,'Jaqueta corta-vento'],[/\bpolo\b/i,'Camisa polo'],[/\bshorts?\b/i,'Calção'],[/\bsocks?\b|stockings?/i,'Meião'],[/\bpre\s*-?\s*match\s*kit/i,'Kit pré-jogo'],[/\btraining\s*(?:shirt|jersey)\b/i,'Camisa de treino'],[/\bhalf\s*pull\b/i,'Blusa de treino'],[/\bvest\b/i,'Regata'],[/\bcultural\s*shirt\b/i,'Camisa cultural'],[/\bkit\b|\bset\b/i,'Conjunto']];
 for(const [re,v] of types)if(re.test(t)){if(p.kind!=='jacket')type=v;t=t.replace(new RegExp(re.source,'gi'),' ');break}
 if(p.kind==='jacket')t=t.replace(/\b(?:jackets?|jaquetas?|casacos?|hoodies?|windbreakers?|softshell|cardigan)\b/gi,' ');
 const tags=[],patterns=[[/\bgoal\s*keeper\b|\bgoalkeeper\b|\bgk\b/i,'Goleiro'],[/\b2\s*away\b/i,'Segunda reserva'],[/\bthird\b|\b3rd\b/i,'Terceira'],[/\bfourth\b|\b4th\b/i,'Quarta'],[/\baway\b/i,'Reserva'],[/\bhome\b/i,'Titular'],[/\bretro\b|\bvintage\b|\bclassic\b/i,'Retrô'],[/\bspecial\s*edition\b/i,'Edição especial'],[/\banniversary\b/i,'Comemorativa'],[/\bpre\s*-?\s*match\b/i,'Pré-jogo'],[/\blong\s*-?\s*sleeves?\b/i,'Manga longa'],[/\bplayer\s*version\b|\bplayers?\s*edition\b|\bplayer\b/i,'Versão jogador'],[/\bfan\s*version\b|\bfan\b/i,'Versão torcedor'],[/\bchildren\b|\bchild\b|\bkids?\b|\byouth\b/i,'Infantil'],[/\bwomen\b|\bwoman\b|\bfemale\b/i,'Feminina']];
 for(const [re,v] of patterns)if(re.test(t)){tags.push(v);t=t.replace(new RegExp(re.source,'gi'),' ')}
 if(p.category==='retro'||p.kind==='retro'||p.kind==='retro_long')tags.push('Retrô');
 if(kids)tags.push('Infantil');
 if(p.kind==='female')tags.push('Feminina');
 if(String(p.kind).startsWith('player_'))tags.push('Versão jogador');
 t=t.replace(/\b(?:XXS|XS|S|M|L|XL|XXL|[2-6]XL)\s*[-~]\s*(?:XXS|XS|S|M|L|XL|XXL|[2-6]XL|[2-6]X)\b/gi,' ').replace(/\b(?:XXL|[2-6]XL)\b(?=\s*$)/gi,' ').replace(/\b(?:jersey|shirt|soccer|football|uniform)\b/gi,' ').replace(/_+/g,' ').replace(/\s+/g,' ').trim();
 for(const [re,pt] of REPLACEMENTS)t=t.replace(re,pt);
 t=niceCase(t.replace(/^[\s./-]+|[\s./-]+$/g,''));
 if(!t)t='Modelo '+String(p.id).replace('YUP-','');
 return (t+(season?' '+season:'')+' — '+type+(tags.length?' · '+[...new Set(tags)].join(' · '):'')).slice(0,170);
}
// Proteção visual: o catálogo exibido usa a mesma regra de preço do importador.
function retroSeasonStart(title){
 const text=String(title||'');
 const now=new Date(), year=now.getFullYear(), limit=year-5-(now.getMonth()<7?1:0);
 const expand=s=>s.length===4?+s:(+s<=year%100+2?2000+ +s:1900+ +s);
 const seasons=/\b((?:19|20)\d{2}|\d{2})\s*[-/._]\s*((?:19|20)\d{2}|\d{2})\b/g;
 let m;
 while((m=seasons.exec(text))){const start=expand(m[1]);if(expand(m[2])===start+1&&start>=1950&&start<=year+2)return start<=limit;}
 const single=/\b((?:19|20)\d{2})\b/g;
 while((m=single.exec(text))){const y=+m[1];if(y>=1950&&y<=year+2)return y<=limit;}
 return false;
}
function retroProduct(p){
 const item={...p};
 if(!retroSeasonStart(item.supplierTitle||item.title))return item;
 if(!item.categoryLocked)item.category='retro';
 const kind=String(item.kind||'fan').toLowerCase();
 if(['fan','long','retro','retro_long','player_nike','player_adidas','player_puma'].includes(kind)){
  const isLong=kind==='long'||kind==='retro_long'||/long\s*[- ]?sleeves?|manga\s*longa/i.test(item.supplierTitle||item.title);
  if(!item.kindLocked)item.kind=isLong?'retro_long':'retro';
  if(!item.priceLocked)item.price=Math.round(Math.max(Number(item.price)||0,isLong?229.90:199.90)*100)/100;
 }
 if(!item.badgeLocked&&['','NOVO','NEW'].includes(String(item.badge||'').toUpperCase()))item.badge='RETRÔ';
 return item;
}
// Calção versão jogador: custo US$12 contra US$10 do comum. Preço público
// proporcional: R$143,90 (base comum R$119,90). Mantém preço manual travado.
function playerShortsReprice(p){
 const item={...p};
 const title=String(item.supplierTitle||item.title||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const kind=String(item.kind||'').toLowerCase();
 const playerShorts=kind==='shorts_player'||(kind==='shorts'&&/\b(?:shorts?|calcao|bermuda)\b/.test(title)&&/\b(?:player|jogador|versao\s+jogador)\b/.test(title));
 if(!playerShorts)return item;
 if(!item.kindLocked)item.kind='shorts_player';
 if(!item.priceLocked&&Math.abs(Number(item.price)-119.90)<0.005)item.price=143.90;
 return item;
}
function prepareCatalog(data){return data.filter(p=>p&&p.id&&p.title&&Number.isFinite(p.price)&&!isBasketball(p)).map(p=>{const clean=playerShortsReprice(retroProduct({...p,supplierTitle:p.supplierTitle||p.title}));clean.title=displayTitle(clean);if(!String(clean.id).startsWith('YUP-')&&clean.category==='retro'&&!/retr[oô]/i.test(clean.title))clean.title+=' · Retrô';clean.brazilClub=findBrazilClub(clean);return clean;});}

function catalogRender(){
 const ps=filtered();const visible=ps.slice(0,state.limit);$('catalogSubtitle').textContent=state.favoritesOnly?'Modelos que você salvou.':state.query?`Resultados da busca por “${state.query}”.`:'Modelos com fotografias cadastradas no catálogo do fornecedor.';
 if(state.category==='brasileirao'&&!state.query){
 const club=BR_CLUBS.find(([id])=>id===state.club);
 $('catalogSubtitle').textContent=state.club==='todos'?'Escolha seu clube e explore as camisas dos times brasileiros.':state.club==='outros'?'Modelos dos demais clubes brasileiros.':club?'Camisas, versões de jogador, retrôs e modelos infantis do '+club[1]+'.':'Escolha seu clube.';
 }
 $('productsGrid').innerHTML=visible.map(p=>`<article class="product-card" data-id="${esc(p.id)}"><div class="product-image"><span class="label-chip ${p.badge==='NOVO'||p.badge==='COPA 2026'?'highlight':''}">${esc(p.badge||'STREETBALL')}</span><button class="fav-btn ${state.favorites.includes(p.id)?'active':''}" data-fav="${esc(p.id)}" aria-label="Adicionar aos favoritos"><svg viewBox="0 0 24 24"><path d="M20 4c-2.3-2-5.3-1.2-8 1.6C9.3 2.8 6.4 2 4 4c-3.1 3-2.2 7.2 0 9.4L12 21l8-7.6c2.2-2.2 3.1-6.4 0-9.4Z"/></svg></button>${imageHTML(p)}<button class="quick-btn" data-open="${esc(p.id)}" aria-label="Escolher opções de ${esc(p.title)}"><span>ESCOLHER OPÇÕES</span><svg class="quick-btn-arrow" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 19 19 5M8 5h11v11"/></svg></button></div><div class="product-meta"><div class="product-label">${esc(categoryLabel(p))}</div><h3 class="product-title">${esc(p.title)}</h3><div class="product-price"><small>A partir de</small>${money(p.price)}</div><div class="product-price-note">Tamanhos e personalização disponíveis</div></div></article>`).join('')||'<div class="empty-cart">'+esc(state.category==='brasileirao'&&state.club!=='todos'&&state.club!=='outros'?'Ainda não temos modelos com foto cadastrada para '+(BR_CLUBS.find(([id])=>id===state.club)?.[1]||'este clube')+'.':'Nenhum modelo encontrado. Experimente outra pesquisa ou categoria.')+'</div>';
 $('catalogTotal').textContent=`Exibindo ${visible.length} de ${ps.length} modelos · ${catalog.filter(hasVerifiedPhoto).length} produtos com foto cadastrada`;
 $('loadMore').classList.toggle('hide',visible.length>=ps.length);
 renderBrazilClubNavigation();
 $('activeFilters').innerHTML=CATS.map(([id,label])=>`<button class="filter-tag ${id===state.category?'active':''}" data-category="${id}">${label}</button>`).join('');
 document.querySelectorAll('[data-category]').forEach(b=>b.classList.toggle('active',b.dataset.category===state.category));
}
function categoryLabel(p){const labels={personalizadas:'Camisas Personalizadas',brasileirao:'Clubes Brasileiros',europa:'Clubes Europeus',selecoes:'Seleções',retro:'Coleção Retrô',outras:'Outros produtos',infantil:'Infantil',feminino:'Feminino',treino:'Treino',acessorios:'Acessórios'};return labels[p.category]||p.category;}
// Editorial aprovada: 9 recortes FIXOS, separados do catálogo dinâmico.
// Estes caminhos correspondem ao pacote public/images/editorial/ enviado ao proprietário.
const EDITORIAL_ASSETS={
 maradona:'/images/editorial/hero-maradona.png',
 ronaldo:'/images/editorial/hero-ronaldo-inter.png',
 juventus:'/images/editorial/hero-juventus-pb.png',
 united:'/images/editorial/hero-manchester-united.png',
 rack:'/images/editorial/hero-arara-camisas.png',
 retro:'/images/editorial/card-retro.png',
 atuais:'/images/editorial/card-atuais.png',
 personalizadas:'/images/editorial/card-personalizadas.png',
 colecoes:'/images/editorial/card-todas-colecoes.png'
};
// Mesmos PNGs, com URL nova para impedir cache negativo de 404 no navegador.
const EDITORIAL_IMAGE_REVISION='20261022-mobile-refresh-v8';
// Pinamos os fallbacks ao commit que contém as 4 artes NOVAS; @main pode
// permanecer cacheado em CDNs mesmo depois de um push.
const EDITORIAL_ASSET_COMMIT='d27a00d6bcd45c27132f445b7e214f3bc934c61a';
const editorialLocalSource=path=>path+'?v='+EDITORIAL_IMAGE_REVISION;
const editorialGithubSource=path=>'https://raw.githubusercontent.com/kadupontee/streetball-store/'+EDITORIAL_ASSET_COMMIT+'/public'+path+'?v='+EDITORIAL_IMAGE_REVISION;
const editorialCdnSource=path=>'https://cdn.jsdelivr.net/gh/kadupontee/streetball-store@'+EDITORIAL_ASSET_COMMIT+'/public'+path+'?v='+EDITORIAL_IMAGE_REVISION;
const EDITORIAL_HERO_SETS=[
 ['ronaldo','maradona','juventus','united','rack'],
 ['maradona','united','rack','ronaldo','juventus'],
 ['united','ronaldo','maradona','rack','juventus'],
 ['rack','juventus','united','maradona','ronaldo']
];
const EDITORIAL_ALT={
 maradona:'Camisa retrô da Argentina',
 ronaldo:'Camisa retrô da Inter de Milão, Ronaldo',
 juventus:'Futebol clássico em preto e branco',
 united:'Camisa clássica do Manchester United',
 rack:'Coleção de camisas de futebol'
};
// Banner editorial sempre usa as nove imagens aprovadas, em desktop e mobile.
// Não substituir por fotos aleatórias do catálogo em nenhum dispositivo.
let heroActive=0,heroTimer=null;
function showHeroSlide(index){
 const slides=[...document.querySelectorAll('.editorial-hero-scene')];
 if(!slides.length)return;
 heroActive=((index%slides.length)+slides.length)%slides.length;
 slides.forEach((slide,i)=>{slide.classList.toggle('active',i===heroActive);slide.setAttribute('aria-hidden',String(i!==heroActive))});
 document.querySelectorAll('[data-hero-slide]').forEach(b=>b.setAttribute('aria-current',String(Number(b.dataset.heroSlide)===heroActive)));
}
function renderEditorialHero(){
 const target=$('editorialHeroScenes');if(!target)return;
 const variants=['main','left','right','low','low-left'];
 const defaults=['#8b91d7','#c9c9d1','#7d8092','#a6a6b6','#b5b5cd'];
 target.innerHTML=EDITORIAL_HERO_SETS.map((images,scene)=>
  '<div class="editorial-hero-scene'+(scene===0?' active':'')+'" aria-hidden="'+(scene!==0)+'">'+
  images.map((name,j)=>'<div class="editorial-frame '+variants[j]+'" style="background:'+defaults[j]+'">'+
   '<img src="'+editorialLocalSource(EDITORIAL_ASSETS[name])+'" data-editorial-path="'+EDITORIAL_ASSETS[name]+'" data-editorial-source="local" alt="'+esc(EDITORIAL_ALT[name])+'" decoding="async" loading="'+(scene===0?'eager':'lazy')+'">'+
   '</div>').join('')+
  '</div>'
 ).join('');
 showHeroSlide(heroActive);
 if(heroTimer)clearInterval(heroTimer);
 if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  heroTimer=setInterval(()=>{if(!document.hidden)showHeroSlide(heroActive+1)},5600);
}
function categoryRender(){
 // Cada PNG mantém suas dimensões nativas, inclusive antes do carregamento no celular.
 const tiles=[
  ['retro','RETRÔ','O passado que nunca sai de moda.',EDITORIAL_ASSETS.retro,960],
  ['europa','ATUAIS','Os lançamentos da temporada no seu estilo.',EDITORIAL_ASSETS.atuais,960],
  ['personalizadas','PERSONALIZADAS','Deixe sua camisa com a sua identidade.',EDITORIAL_ASSETS.personalizadas,960],
  ['todos','TODAS AS COLEÇÕES','Explore nosso catálogo completo.',EDITORIAL_ASSETS.colecoes,960]
 ];
 $('categoryGrid').innerHTML=tiles.map(([id,label,sub,url,imageWidth])=>
  '<button class="category-tile editorial-fixed-tile" data-category="'+id+'" data-editorial-label="'+esc(label)+'" data-editorial-sub="'+esc(sub)+'" aria-label="Explorar '+esc(label)+'">'+
  '<img class="category-photo" src="'+editorialLocalSource(url)+'" width="'+imageWidth+'" height="557" data-editorial-path="'+url+'" data-editorial-source="local" alt="" loading="lazy" decoding="async">'+
  '<span class="editorial-tile-sr">'+esc(label)+' — '+esc(sub)+'</span></button>'
 ).join('');
}
// Se a Cloudflare não disponibilizar os assets após o deploy, usar os MESMOS
// arquivos PNG sincronizados no GitHub; jamais substituir por produtos aleatórios.
document.addEventListener('error',event=>{
 const img=event.target;
 if(!(img instanceof HTMLImageElement))return;
 if(!(img.closest('.editorial-frame')||img.closest('.editorial-fixed-tile')))return;
 const path=img.dataset.editorialPath;
 if(!path||!Object.values(EDITORIAL_ASSETS).includes(path))return;
 const source=img.dataset.editorialSource;
 if(source==='local'){
  img.dataset.editorialSource='github';
  img.src=editorialGithubSource(path);
  return;
 }
 if(source==='github'){
  img.dataset.editorialSource='cdn';
  img.src=editorialCdnSource(path);
  return;
 }
 img.dataset.editorialSource='unavailable';
 img.hidden=true;
 const tile=img.closest('.editorial-fixed-tile');
 if(tile)tile.classList.add('needs-label');
 const frame=img.closest('.editorial-frame');
 if(frame){frame.classList.add('image-unavailable');frame.setAttribute('aria-label','Foto temporariamente indisponível');}
},true);
function selectCategory(cat){state.category=cat;state.club='todos';state.query='';$('globalSearch').value='';state.limit=PRODUCT_LIMIT;state.favoritesOnly=false;catalogRender();document.querySelector('.desktop-nav').classList.remove('mobile-open');$('colecao').scrollIntoView({behavior:'smooth'});}
function openUI(kind){state.drawer=kind==='cart';state.checkout=kind==='checkout';$('cartDrawer').classList.toggle('open',state.drawer);$('checkoutModal').classList.toggle('open',state.checkout);$('productModal').classList.toggle('open',kind==='product');$('overlay').classList.toggle('visible',!!kind);document.body.classList.toggle('lock',!!kind);$('cartDrawer').setAttribute('aria-hidden',String(!state.drawer));}
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove('show'),3100);}
function findProduct(id){return catalog.find(p=>p.id===id)}
function unitPrice(item){const p=findProduct(item.id);return p?(p.price+(ADDON.size[item.size]||0)+(item.patch?ADDON.patch:0)+(item.personalize?ADDON.personalization:0)):0}
function cartSum(){return state.cart.reduce((acc,it)=>acc+unitPrice(it)*it.qty,0)}
function cartRender(){const count=state.cart.reduce((a,it)=>a+it.qty,0);$('cartCount').textContent=count;$('drawerCount').textContent=`(${count})`;$('cartSubtotal').textContent=money(cartSum());$('checkoutSubtotal').textContent=money(cartSum());$('checkoutShipping').textContent=state.checkoutReady?money(state.checkoutShipping):'A calcular';$('checkoutGrandTotal').textContent=state.checkoutReady?money(cartSum()+state.checkoutShipping):'A calcular';$('checkoutBtn').disabled=!count||!state.checkoutReady;
 $('cartItems').innerHTML=state.cart.map((it,index)=>{const p=findProduct(it.id);if(!p)return '';return `<div class="cart-item"><div class="cart-thumb">${imageHTML(p)}</div><div><div class="cart-title">${esc(p.title)}</div><div class="cart-sub">${esc(it.size)} ${it.personalize?` · ${esc(it.customName)} #${esc(it.customNumber)}`:''}${it.patch?' · Patch':''}</div><div class="cart-qty"><button data-qty="${index}" data-dir="-1" aria-label="Diminuir quantidade">−</button><span>${it.qty}</span><button data-qty="${index}" data-dir="1" aria-label="Aumentar quantidade">+</button></div></div><div><button class="cart-remove" data-remove="${index}" title="Remover">×</button><div class="cart-price">${money(unitPrice(it)*it.qty)}</div></div></div>`}).join('')||'<div class="empty-cart"><svg viewBox="0 0 24 24"><path d="M4 7h16l-1 14H5L4 7ZM8 8V5a4 4 0 0 1 8 0v3" stroke-width="1.2"/></svg><strong>Sua sacola está vazia</strong><p>Encontre seu próximo manto na coleção.</p></div>';
 persist('streetball_cart',state.cart)}
function detailPrice(){const p=findProduct(state.detail);if(!p)return 0;const c=state.choice;return p.price+(ADDON.size[c.size]||0)+(c.patch?ADDON.patch:0)+(c.personalize?ADDON.personalization:0)}
function updateDetailPrice(){$('detailTotal').textContent=money(detailPrice());$('detailAdd').disabled=!state.choice.size;$('detailAdd').setAttribute('aria-label',state.choice.size?'Adicionar à sacola':'Selecione um tamanho');$('sizeCaption').textContent=state.choice.size?`Tamanho selecionado: ${state.choice.size}`:'Selecione um tamanho para continuar';}
function detailOpen(id){const p=findProduct(id);if(!p)return;state.detail=id;state.choice={size:'',patch:false,personalize:false,customName:'',customNumber:''};$('productModalInner').innerHTML=`<div class="detail-grid"><div class="detail-media"><div id="detailMainPhoto">${imageHTML(p)}</div>${(p.images||[]).length>1?`<div class="detail-photo-strip">${photoSources(p).map((u,i)=>`<button type="button" class="detail-photo-btn ${i===0?'active':''}" data-photo-index="${i}" aria-label="Ver foto ${i+1}"><img src="${esc(localImageURL(u))}" loading="lazy" referrerpolicy="no-referrer" alt="Foto ${i+1}: ${esc(p.title)}" onerror="this.style.opacity='.3'"></button>`).join('')}</div>`:''}</div><div class="detail-content"><p class="micro">${esc(categoryLabel(p))} · REF. ${esc(p.id)}</p><h3 id="modalProductTitle">${esc(p.title)}</h3><p>${hasVerifiedPhoto(p)?'Fotografia cadastrada do fornecedor; confirme os detalhes e a disponibilidade do modelo.':'Fotografia deste modelo indisponível no momento.'}</p><div class="product-price" id="detailTotal">${money(p.price)}</div><span class="field-title" id="sizeCaption">SELECIONE UM TAMANHO</span><div class="sizes">${(p.sizes||['P','M','G','GG']).map(s=>`<button class="size-btn" data-size="${esc(s)}">${esc(s)}</button>`).join('')}</div><label class="optional-check"><input type="checkbox" id="optPersonalize"> Nome e número (+ ${money(ADDON.personalization)})</label><div id="personalizeFields" class="personalization hide"><input id="customName" maxlength="14" placeholder="Nome nas costas"><input id="customNumber" maxlength="3" placeholder="Nº" inputmode="numeric"></div><label class="optional-check"><input type="checkbox" id="optPatch"> Adicionar patch (+ ${money(ADDON.patch)})</label><button class="btn-accent full" id="detailAdd" disabled>ADICIONAR À SACOLA <span>→</span></button><p>Venda sob encomenda. Disponibilidade e prazo sujeitos à confirmação.</p></div></div>`;openUI('product');updateDetailPrice();}
function addCart(){state.checkoutRequestKey=null;const c={...state.choice},p=findProduct(state.detail);if(!p||!c.size){toast('Selecione um tamanho.');return}if(c.personalize&&!c.customName.trim()&&!c.customNumber.trim()){toast('Preencha o nome ou o número para personalizar.');return}const record={id:p.id,size:c.size,patch:c.patch,personalize:c.personalize,customName:c.personalize?c.customName.trim():'',customNumber:c.personalize?c.customNumber.trim():'',qty:1};const found=state.cart.find(it=>it.id===record.id&&it.size===record.size&&it.patch===record.patch&&it.personalize===record.personalize&&it.customName===record.customName&&it.customNumber===record.customNumber);if(found)found.qty++;else state.cart.push(record);cartRender();openUI('cart');toast('Produto adicionado à sacola.');}
function toggleFav(id){state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];persist('streetball_favorites',state.favorites);catalogRender();}
function totals(){return {items:state.cart,subtotal:cartSum()}}
function openCheckout(){
 if(!state.cart.length||!state.checkoutReady)return;
 openUI('checkout');$('checkoutStatus').textContent='';
 // Sem dados da conta no localStorage: cookie de sessão HttpOnly com consulta same-origin.
 fetch('/api/account/me',{credentials:'same-origin',cache:'no-store'})
  .then(r=>r.ok?r.json():null).then(me=>{
   if(!me?.authenticated||!state.checkout)return;
   const form=$('checkoutForm');
   if(!form.elements.email.value)form.elements.email.value=me.user.email;
   if(!form.elements.name.value)form.elements.name.value=me.user.displayName;
  }).catch(()=>{});
}
async function submitOrder(e){e.preventDefault();const status=$('checkoutStatus');const btn=$('placeOrder');if(!state.cart.length||!state.checkoutReady){status.textContent='Checkout ainda não habilitado.';return;}const data=new FormData(e.currentTarget);const customer=Object.fromEntries(data.entries());delete customer.consent;const whatsappOptIn=customer.whatsappOptIn==='on';delete customer.whatsappOptIn;const importTaxAcknowledged=customer.importTaxAcknowledged==='on';delete customer.importTaxAcknowledged;customer.cpf=String(customer.cpf).replace(/\D/g,'');customer.phone=String(customer.phone).replace(/\D/g,'');customer.zip=String(customer.zip).replace(/\D/g,'');const payload={customer,whatsappOptIn,importTaxAcknowledged,paymentMethod:data.get('paymentMethod'),items:state.cart.map(({id,size,qty,patch,personalize,customName,customNumber})=>({id,size,qty,patch,personalize,customName,customNumber}))};const fingerprint=JSON.stringify(payload);if(state.checkoutPayload!==fingerprint){state.checkoutRequestKey=crypto.randomUUID();state.checkoutPayload=fingerprint;}btn.disabled=true;status.textContent='Verificando integração segura...';
 try{if(location.hostname.endsWith('.github.io'))throw new Error('Esta é uma vitrine de demonstração. O checkout exige a publicação do backend de pagamentos (Cloudflare/Asaas).');const res=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':state.checkoutRequestKey},body:JSON.stringify(payload)});const result=await res.json().catch(()=>null);if(!res.ok)throw new Error(result?.error||'Checkout indisponível. A loja ainda não está conectada a um provedor de pagamento.');if(!result?.paymentUrl||!/^https:\/\//.test(result.paymentUrl))throw new Error('A cobrança não retornou um endereço seguro.');if(typeof result.trackingUrl==='string'&&result.trackingUrl.startsWith(location.origin+'/track.html#')){try{localStorage.setItem('streetball_tracking_link',result.trackingUrl)}catch{}}
 status.textContent=result.sandbox?'Redirecionando ao ambiente de testes Asaas...':'Redirecionando para o pagamento seguro no Asaas...';window.location.assign(result.paymentUrl)}catch(err){status.textContent=err.message.includes('Failed to fetch')?'Prévia: conecte o backend e o Asaas antes de receber pedidos reais.':err.message;btn.disabled=false;}}
// Links de cadastro aparecem apenas para visitantes, nunca para uma sessão autenticada.
// A sessão pertence ao cookie HttpOnly do Worker; não inferir login do localStorage.
let homepageSessionRequest=0;
function setHomepageSignupVisibility(authenticated){
 document.querySelectorAll('[data-guest-only]').forEach(link=>{
  link.hidden=authenticated;
  // O CSS da loja usa display:inline-flex em botões e pode sobrescrever [hidden].
  link.style.display=authenticated?'none':'';
 });
}
async function refreshHomepageSessionLinks(){
 const request=++homepageSessionRequest;
 try{
  const response=await fetch('/api/account/me',{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw new Error('Sessão indisponível');
  const session=await response.json();
  if(request===homepageSessionRequest)setHomepageSignupVisibility(session?.authenticated===true);
 }catch{
  // Sem confirmação de sessão, mantém os links de cadastro para visitantes.
  if(request===homepageSessionRequest)setHomepageSignupVisibility(false);
 }
}
refreshHomepageSessionLinks();
// Back/forward cache e volta de outra aba após login ou logout.
window.addEventListener('pageshow',event=>{if(event.persisted)refreshHomepageSessionLinks()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshHomepageSessionLinks()});
// Delegate events from cards, tabs and cart controls.
document.addEventListener('click',e=>{const brClub=e.target.closest('[data-br-club]');if(brClub){selectBrazilClub(brClub.dataset.brClub);return}const cat=e.target.closest('[data-category]');if(cat){selectCategory(cat.dataset.category);return}const foot=e.target.closest('[data-footer-category]');if(foot){selectCategory(foot.dataset.footerCategory);return}const fav=e.target.closest('[data-fav]');if(fav){toggleFav(fav.dataset.fav);return}const photo=e.target.closest('[data-photo-index]');if(photo&&state.detail){const p=findProduct(state.detail),i=Number(photo.dataset.photoIndex),u=photoSources(p||{})[i];if(trustedPhoto(u)){const main=$('detailMainPhoto');main.innerHTML=imageHTML({...p,image:u});document.querySelectorAll('.detail-photo-btn').forEach(b=>b.classList.toggle('active',b===photo));}return}const product=e.target.closest('[data-open]')||e.target.closest('.product-card');if(product){detailOpen(product.dataset.open||product.dataset.id);return}const size=e.target.closest('[data-size]');if(size&&state.choice){state.choice.size=size.dataset.size;document.querySelectorAll('.size-btn').forEach(b=>b.classList.toggle('active',b.dataset.size===state.choice.size));updateDetailPrice();return}const remove=e.target.closest('[data-remove]');if(remove){state.checkoutRequestKey=null;state.cart.splice(+remove.dataset.remove,1);cartRender();return}const qty=e.target.closest('[data-qty]');if(qty){state.checkoutRequestKey=null;const it=state.cart[+qty.dataset.qty];if(!it)return;it.qty+=+qty.dataset.dir;if(it.qty<=0)state.cart.splice(+qty.dataset.qty,1);cartRender();return}});
$('globalSearch').addEventListener('input',e=>{state.query=e.target.value.trim();state.limit=PRODUCT_LIMIT;catalogRender();if(state.query)$('colecao').scrollIntoView({behavior:'smooth',block:'start'})});
$('sortSelect').addEventListener('change',e=>{state.sort=e.target.value;catalogRender()});
$('loadMore').addEventListener('click',()=>{state.limit+=PRODUCT_LIMIT;catalogRender()});
$('heroShop').addEventListener('click',()=>selectCategory('todos'));
document.querySelectorAll('[data-hero-slide]').forEach(button=>button.addEventListener('click',()=>showHeroSlide(Number(button.dataset.heroSlide))));
$('storyRetro').addEventListener('click',()=>selectCategory('retro'));
$('showAllCats').addEventListener('click',()=>selectCategory('todos'));
$('menuToggle').addEventListener('click',()=>document.querySelector('.desktop-nav').classList.toggle('mobile-open'));
$('mobileSearch').addEventListener('click',()=>{$('globalSearch').closest('.search-box').classList.toggle('open');$('globalSearch').focus()});
$('favoriteTrigger').addEventListener('click',()=>{state.favoritesOnly=!state.favoritesOnly;state.category='todos';catalogRender();$('colecao').scrollIntoView({behavior:'smooth'})});
const accountTrigger=$('accountTrigger'),accountDropdown=$('accountDropdown');
if(accountTrigger&&accountDropdown){
 accountTrigger.addEventListener('click',event=>{
  event.stopPropagation();
  accountDropdown.hidden=!accountDropdown.hidden;
  accountTrigger.setAttribute('aria-expanded',String(!accountDropdown.hidden));
 });
 document.addEventListener('click',event=>{
  if(!event.target.closest('.account-menu-wrap')){
   accountDropdown.hidden=true;accountTrigger.setAttribute('aria-expanded','false');
  }
 });
}
$('cartTrigger').addEventListener('click',()=>openUI('cart'));
$('closeCart').addEventListener('click',()=>openUI(null));
$('closeProduct').addEventListener('click',()=>openUI(null));
$('closeCheckout').addEventListener('click',()=>openUI(null));
$('overlay').addEventListener('click',()=>openUI(null));
$('checkoutBtn').addEventListener('click',openCheckout);
$('checkoutForm').addEventListener('submit',submitOrder);
$('footerHelp').addEventListener('click',()=>toast('Configure o canal de atendimento antes de publicar a loja.'));
$('dismissNotice').addEventListener('click',()=>{$('demoNotice').style.display='none'});
$('productModal').addEventListener('change',e=>{if(e.target.id==='optPersonalize'){state.choice.personalize=e.target.checked;$('personalizeFields').classList.toggle('hide',!e.target.checked);updateDetailPrice()}if(e.target.id==='optPatch'){state.choice.patch=e.target.checked;updateDetailPrice()}});
$('productModal').addEventListener('input',e=>{if(e.target.id==='customName')state.choice.customName=e.target.value;if(e.target.id==='customNumber')state.choice.customNumber=e.target.value});
$('productModal').addEventListener('click',e=>{if(e.target.closest('#detailAdd'))addCart()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){openUI(null);document.querySelector('.desktop-nav').classList.remove('mobile-open');if($('accountDropdown')){$('accountDropdown').hidden=true;$('accountTrigger').setAttribute('aria-expanded','false')}}if(e.key==='/'&&document.activeElement?.tagName!=='INPUT'){e.preventDefault();$('globalSearch').closest('.search-box').classList.add('open');$('globalSearch').focus()}});
$('year').textContent=new Date().getFullYear();
catalog=prepareCatalog(catalog);
renderEditorialHero();
categoryRender();catalogRender();cartRender();

function checkoutIndicator(){
 const info=$('checkoutAvailability'),banner=$('demoText'),note=$('checkoutNote');
 // NÃO sobrescreva checkoutIntro: contém divulgação tributária e link dos Correios.
 if(state.checkoutReady){
   info.textContent=state.checkoutSandbox?'Pagamento em ambiente de testes: nenhuma cobrança real será feita.':'Pagamento seguro por Pix ou cartão. Tributos de importação NÃO incluídos.';
   note.textContent=state.checkoutSandbox?'AMBIENTE DE TESTES: não há cobrança real. O cliente deverá assumir eventuais tributos de importação e Despacho Postal quando as vendas estiverem liberadas.':'O total pago à Streetball Store não inclui Imposto de Importação, ICMS nem eventual Despacho Postal. Se cobrados, são pagos pelo destinatário exclusivamente nos canais oficiais.';
   banner.textContent=state.checkoutSandbox?'LOJA EM TESTES · nenhum pagamento real será cobrado':'LOJA · pagamento seguro via Asaas';
 }else{
   info.textContent='Checkout não liberado. O pagamento será disponibilizado após a configuração e os testes do backend.';
   note.textContent='Nenhuma cobrança será gerada nesta prévia. Eventuais tributos de importação e Despacho Postal serão de responsabilidade do destinatário quando as vendas reais estiverem liberadas.';
   banner.textContent='PRÉVIA · pagamentos ainda não habilitados';
 }
 cartRender();
}
async function loadCheckoutConfig(){
 if(location.hostname.endsWith('.github.io')){checkoutIndicator();return;}
 try{
   const response=await fetch('/api/checkout/config',{cache:'no-store'});
   if(!response.ok)throw Error('Checkout não disponível');
   const info=await response.json();
   state.checkoutReady=info.enabled===true&&Number.isFinite(Number(info.shipping));
   state.checkoutSandbox=info.sandbox===true;
   state.checkoutShipping=state.checkoutReady?Number(info.shipping):null;
 }catch(e){state.checkoutReady=false;state.checkoutShipping=null;}
 checkoutIndicator();
}

loadCheckoutConfig();
// If published with catalog.json generated by importer, use its full validated catalog.
if(/^https?:$/.test(location.protocol)){fetch('catalog.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Catálogo indisponível');return r.json()}).then(data=>{if(Array.isArray(data)&&data.length){catalog=prepareCatalog(data);state.cart=state.cart.filter(it=>findProduct(it.id));renderEditorialHero();categoryRender();catalogRender();cartRender()}}).catch(err=>{$('catalogSubtitle').textContent='Falha ao carregar o catálogo. Atualize a página para tentar novamente.';console.error('Erro ao carregar catálogo:',err);});}
})();
