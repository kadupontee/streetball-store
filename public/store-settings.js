// Modelo compartilhado pela vitrine, pelo editor e pela validação do checkout.
export const CATEGORIES={brasileirao:'Brasileirão',europa:'Europa',selecoes:'Seleções',retro:'Retrô',personalizadas:'Personalizadas',player:'Jogador',infantil:'Infantil',feminino:'Feminino',treino:'Treino',acessorios:'Acessórios',outras:'Outros'};
export const KINDS={fan:'Torcedor',female:'Feminina',kids:'Infantil',retro:'Retrô',retro_long:'Retrô manga longa',long:'Manga longa',player_adidas:'Jogador Adidas',player_nike:'Jogador Nike',player_puma:'Jogador Puma',shorts:'Calção',shorts_player:'Calção jogador',socks:'Meião',jacket:'Jaqueta',coat:'Casaco',blouse:'Blusa',set:'Conjunto'};
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
  if(Object.keys(patch).some(k=>!['title','price','category','kind','hidden'].includes(k)))reject('Campo de produto desconhecido.');
  const clean={};
  if(patch.title!==undefined){if(typeof patch.title!=='string'||patch.title.trim().length<2||patch.title.length>200)reject('O nome deve ter entre 2 e 200 caracteres.');clean.title=patch.title.trim();}
  if(patch.price!==undefined){if(typeof patch.price!=='number'||!Number.isFinite(patch.price)||patch.price<0.01||patch.price>9999||Math.abs(patch.price*100-Math.round(patch.price*100))>0.00001)reject('Preço inválido. Informe reais e até dois centavos.');clean.price=patch.price;}
  for(const [field,allowed] of [['category',CATEGORIES],['kind',KINDS]]){if(patch[field]!==undefined){if(!Object.hasOwn(allowed,patch[field]))reject('Categoria ou tipo de produto inválido.');clean[field]=patch[field];}}
  if(patch.hidden!==undefined){if(typeof patch.hidden!=='boolean')reject('Visibilidade inválida.');clean.hidden=patch.hidden;}
  if(Object.keys(clean).length)products[id]=clean;
 }
 const settings={design,products};
 if(new TextEncoder().encode(JSON.stringify(settings)).length>1400000)reject('As correções ultrapassam o limite de armazenamento desta versão.');
 return settings;
}
export function applyProductOverride(product,patch){
 if(!patch)return product;
 const result={...product};
 for(const key of ['title','price','category','kind','hidden'])if(Object.hasOwn(patch,key))result[key]=patch[key];
 if(Object.hasOwn(patch,'title'))result.titleLocked=true;
 if(Object.hasOwn(patch,'price'))result.priceLocked=true;
 if(Object.hasOwn(patch,'category'))result.categoryLocked=true;
 if(Object.hasOwn(patch,'kind'))result.kindLocked=true;
 return result;
}
