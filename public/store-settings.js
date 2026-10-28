// Modelo compartilhado pela vitrine, pelo editor e pela validação do checkout.
export const CATEGORIES={brasileirao:'Brasileirão',europa:'Europa',selecoes:'Seleções',retro:'Retrô',personalizadas:'Personalizadas',player:'Jogador',infantil:'Infantil',feminino:'Feminino',treino:'Treino',acessorios:'Acessórios',outras:'Outros'};
export const KINDS={fan:'Torcedor',female:'Feminina',kids:'Infantil',retro:'Retrô',retro_long:'Retrô manga longa',long:'Manga longa',player_adidas:'Jogador Adidas',player_nike:'Jogador Nike',player_puma:'Jogador Puma',shorts:'Calção',shorts_player:'Calção jogador',socks:'Meião',jacket:'Jaqueta',coat:'Casaco',blouse:'Blusa',set:'Conjunto'};
export const APPAREL_PRICE_BRL=409.90;
export const RETAIL_PRICE_POLICY_VERSION='commission25-coupon5-min10-20261028';
export const RETAIL_PRICES_BRL=Object.freeze({fan:189.90,female:189.90,kids:209.90,retro:249.90,retro_long:279.90,long:239.90,player_adidas:249.90,player_puma:259.90,player_nike:269.90,shorts:179.90,shorts_player:199.90,socks:149.90,jacket:APPAREL_PRICE_BRL,coat:APPAREL_PRICE_BRL,blouse:APPAREL_PRICE_BRL,set:579.90});
export const RETAIL_ADDONS_BRL=Object.freeze({personalization:35,patch:12,size:Object.freeze({XXL:12,'3XL':23,'4XL':35})});
const APPAREL_KINDS=new Set(['jacket','coat','blouse']);
const APPAREL_TITLE=/\b(?:jaquetas?|jackets?|casacos?|coats?|blusas?|blusoes?|blusao|moletom|moletons|hoodies?|sweatshirts?|sweaters?|pullovers?|windbreakers?|corta[- ]?vento|half[- ]?zip|quarter[- ]?zip)\b/i;
export function apparelPriceMode(product){
 if(APPAREL_KINDS.has(product?.kind))return 'shared';
 if(product?.kindLocked)return null;
 if(product?.apparelPriceReviewRequired===true)return 'highest';
 // A name corrected in the editor also participates, even when the old kind was a shirt.
 const title=String(product?.title||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 return product?.titleLocked&&APPAREL_TITLE.test(title)?'shared':null;
}
export function applyApparelRetailPrice(product){
 const mode=apparelPriceMode(product);
 const floor=RETAIL_PRICES_BRL[product?.kind];
 if(!mode&&!floor)return product;
 // Published editor corrections and old imports must not bypass the new floor.
 const price=mode==='shared'?APPAREL_PRICE_BRL:Math.max(Number(product.price)||0,floor||0,mode==='highest'?APPAREL_PRICE_BRL:0);
 return product.price===price?product:{...product,price};
}
const CURRENT_SHIRT_KINDS=new Set(['fan','female','kids','long','player_adidas','player_nike','player_puma']);
// Table-price presentation only. The existing product price remains the amount
// charged; a reference is never treated as a previously charged historical price.
export function productOfferPrice(product,{unitPrice=product?.price,quantity=1}={}){
 if(!Number.isFinite(unitPrice)||unitPrice<=0||!Number.isSafeInteger(quantity)||quantity<1)return null;
 const retro=product?.category==='retro'||['retro','retro_long'].includes(product?.kind);
 const percent=!retro&&!apparelPriceMode(product)&&CURRENT_SHIRT_KINDS.has(product?.kind)?20:17;
 const currentUnitCents=Math.round(unitPrice*100);
 if(currentUnitCents<1||!Number.isSafeInteger(currentUnitCents*100))return null;
 // Divide by the amount paid after discount, rather than adding 20%/17%:
 // a 20% markup would only represent 16.67% off when charging today's price.
 const referenceUnitCents=Math.ceil(currentUnitCents*100/(100-percent));
 if(!Number.isSafeInteger(referenceUnitCents*quantity))return null;
 return {percent,currentUnit:currentUnitCents/100,referenceUnit:referenceUnitCents/100,quantity,
  currentTotal:currentUnitCents*quantity/100,referenceTotal:referenceUnitCents*quantity/100};
}
export const BRAZIL_TEAMS=Object.freeze([['athletico-pr','Athletico-PR'],['atletico-mg','Atlético-MG'],['bahia','Bahia'],['botafogo','Botafogo'],['chapecoense','Chapecoense'],['corinthians','Corinthians'],['coritiba','Coritiba'],['cruzeiro','Cruzeiro'],['flamengo','Flamengo'],['fluminense','Fluminense'],['gremio','Grêmio'],['internacional','Internacional'],['mirassol','Mirassol'],['palmeiras','Palmeiras'],['bragantino','Red Bull Bragantino'],['remo','Remo'],['santos','Santos'],['sao-paulo','São Paulo'],['vasco','Vasco da Gama'],['vitoria','Vitória']]);
export const SECTIONS={hero:'Banner principal',services:'Serviços',categories:'Coleções',catalog:'Produtos',story:'Destaque retrô',promises:'Diferenciais'};
export const TEXTS={announcement:'Faixa superior',heroEyebrow:'Chamada do banner',heroLine1:'Título do banner · linha 1',heroLine2:'Título do banner · linha 2',heroSubtitle:'Subtítulo do banner',heroButton:'Botão do banner',categoryTitle:'Título das coleções',catalogTitle:'Título dos produtos',storyTitle:'Título do destaque retrô',storyText:'Texto do destaque retrô',footerText:'Texto do rodapé'};
export const DEFAULT_DESIGN=Object.freeze({accent:'#818bd5',background:'#e6e6e8',textColor:'#1b1b21',headerBackground:'#e3e3e6',heroBackground:'#d7d7dc',maxWidth:1470,gridColumns:4,mobileColumns:2,productGap:24,cardRadius:0,heroHeight:600,fontScale:100,imageFit:'contain',texts:{},sectionOrder:Object.keys(SECTIONS),hiddenSections:[]});
export const emptySettings=()=>({design:structuredClone(DEFAULT_DESIGN),products:{}});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const reject=message=>{throw new Error(message)};
export function normalizeSettings(input){
 if(!plain(input)||!plain(input.design)||!plain(input.products))reject('Arquivo de edição inválido.');
 if(Object.keys(input).some(k=>!['design','products'].includes(k)))reject('Campo de configuração desconhecido.');
 const design=structuredClone(DEFAULT_DESIGN),source=input.design;
 if(Object.keys(source).some(k=>!Object.hasOwn(design,k)))reject('Opção de layout desconhecida.');
 for(const k of ['accent','background','textColor','headerBackground','heroBackground']){
  if(source[k]!==undefined){if(!/^#[0-9a-f]{6}$/i.test(source[k]))reject('Cor inválida. Use o formato #RRGGBB.');design[k]=source[k];}
 }
 for(const [k,min,max] of [['maxWidth',1080,1720],['gridColumns',2,5],['mobileColumns',1,2],['productGap',8,40],['cardRadius',0,28],['heroHeight',380,780],['fontScale',85,120]]){
  if(source[k]!==undefined){if(!Number.isInteger(source[k])||source[k]<min||source[k]>max)reject('Valor de layout fora do intervalo: '+k);design[k]=source[k];}
 }
 if(source.imageFit!==undefined){if(!['contain','cover'].includes(source.imageFit))reject('Enquadramento inválido.');design.imageFit=source.imageFit;}
 if(source.texts!==undefined){
  if(!plain(source.texts))reject('Textos inválidos.');
  for(const [key,value] of Object.entries(source.texts)){
   if(!Object.hasOwn(TEXTS,key)||typeof value!=='string'||value.length>500||/[\u0000-\u0008]/.test(value))reject('Texto inválido.');
   if(value.trim())design.texts[key]=value.trim();
  }
 }
 if(source.sectionOrder!==undefined){
  if(!Array.isArray(source.sectionOrder)||source.sectionOrder.length!==Object.keys(SECTIONS).length||new Set(source.sectionOrder).size!==Object.keys(SECTIONS).length||source.sectionOrder.some(k=>!Object.hasOwn(SECTIONS,k)))reject('Ordem de seções inválida.');
  design.sectionOrder=[...source.sectionOrder];
 }
 if(source.hiddenSections!==undefined){
  if(!Array.isArray(source.hiddenSections)||source.hiddenSections.some(k=>!Object.hasOwn(SECTIONS,k)||k==='catalog'))reject('A seção de produtos deve permanecer visível.');
  design.hiddenSections=[...new Set(source.hiddenSections)];
 }
 const entries=Object.entries(input.products);
 if(entries.length>12000)reject('Limite de 12.000 produtos editados.');
 const products={};
 for(const [id,patch] of entries){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||['__proto__','constructor','prototype'].includes(id)||!plain(patch))reject('Referência de produto inválida.');
  if(Object.keys(patch).some(k=>!['title','price','category','kind','hidden','team'].includes(k)))reject('Campo de produto desconhecido.');
  const clean={};
  if(patch.title!==undefined){if(typeof patch.title!=='string'||patch.title.trim().length<2||patch.title.length>200)reject('O nome deve ter entre 2 e 200 caracteres.');clean.title=patch.title.trim();}
  if(patch.price!==undefined){if(typeof patch.price!=='number'||!Number.isFinite(patch.price)||patch.price<0.01||patch.price>9999||Math.abs(patch.price*100-Math.round(patch.price*100))>0.00001)reject('Preço inválido. Informe reais e até dois centavos.');clean.price=patch.price;}
  for(const [field,allowed] of [['category',CATEGORIES],['kind',KINDS]]){if(patch[field]!==undefined){if(!Object.hasOwn(allowed,patch[field]))reject('Categoria ou tipo de produto inválido.');clean[field]=patch[field];}}
  if(patch.team!==undefined){if(typeof patch.team!=='string'||!/^(?:brasileirao|europa):[a-z0-9-]{1,45}$/.test(patch.team))reject('Time inválido. Escolha um clube da lista.');clean.team=patch.team;}
  if(patch.hidden!==undefined){if(typeof patch.hidden!=='boolean')reject('Visibilidade inválida.');clean.hidden=patch.hidden;}
  if(Object.hasOwn(clean,'price')&&apparelPriceMode({kind:clean.kind,kindLocked:Object.hasOwn(clean,'kind'),title:clean.title,titleLocked:Object.hasOwn(clean,'title')})==='shared')clean.price=APPAREL_PRICE_BRL;
  if(Object.keys(clean).length)products[id]=clean;
 }
 const settings={design,products};
 if(new TextEncoder().encode(JSON.stringify(settings)).length>1400000)reject('As correções ultrapassam o limite de armazenamento desta versão.');
 return settings;
}
export function applyProductOverride(product,patch){
 if(!patch)return applyApparelRetailPrice(product);
 const result={...product};
 for(const key of ['title','price','category','kind','hidden','team'])if(Object.hasOwn(patch,key))result[key]=patch[key];
 if(Object.hasOwn(patch,'title'))result.titleLocked=true;
 if(Object.hasOwn(patch,'price'))result.priceLocked=true;
 if(Object.hasOwn(patch,'category'))result.categoryLocked=true;
 if(Object.hasOwn(patch,'kind'))result.kindLocked=true;
 if(Object.hasOwn(patch,'team'))result.teamLocked=true;
 return applyApparelRetailPrice(result);
}
