(() => {
 'use strict';
 const preview=window.parent!==window&&new URLSearchParams(location.search).get('editor')==='visual';
 let model,current,selectMode=true,designStyle;
 const originalTexts=new Map();
 const send=(type,data={})=>{if(preview)parent.postMessage({source:'streetball-store-preview',type,...data},location.origin);};
 function applyDesign(design){
  if(!designStyle){designStyle=document.createElement('style');designStyle.id='storefront-custom-design';document.head.append(designStyle);}
  const d=model.DEFAULT_DESIGN,rules=[];
  const changed=k=>design[k]!==d[k];
  if(changed('accent'))rules.push(`:root{--accent:${design.accent};--lime:${design.accent}}.btn-accent,.cart-count,.hero-dot[aria-current="true"]{background:${design.accent};border-color:${design.accent}}`);
  if(changed('background'))rules.push(`body,.desktop-nav{background:${design.background}}`);
  if(changed('textColor'))rules.push(`:root{--ink:${design.textColor}}body,.product-title,.hero h1,.hero h1 em{color:${design.textColor}}`);
  if(changed('headerBackground'))rules.push(`.site-header{background:${design.headerBackground}}`);
  if(changed('heroBackground'))rules.push(`.hero{background:${design.heroBackground}}`);
  if(changed('maxWidth'))rules.push(`:root{--max:${design.maxWidth}px}`);
  if(changed('gridColumns'))rules.push(`@media(min-width:1001px){.products-grid{grid-template-columns:repeat(${design.gridColumns},minmax(0,1fr))}}`);
  if(changed('mobileColumns'))rules.push(`@media(max-width:680px){.products-grid{grid-template-columns:repeat(${design.mobileColumns},minmax(0,1fr))}}`);
  if(changed('productGap'))rules.push(`.products-grid{gap:${design.productGap}px}`);
  if(changed('cardRadius'))rules.push(`.product-image{border-radius:${design.cardRadius}px;overflow:hidden}`);
  if(changed('heroHeight'))rules.push(`@media(min-width:981px){.hero-layout{height:${design.heroHeight}px;min-height:${design.heroHeight}px}}`);
  if(changed('fontScale'))rules.push(`.product-title{font-size:${14*design.fontScale/100}px}.product-price{font-size:${20*design.fontScale/100}px}`);
  if(changed('imageFit'))rules.push(`.product-image img{object-fit:${design.imageFit}!important}`);
  const reordered=design.sectionOrder.join()!==d.sectionOrder.join();
  if(reordered){
   rules.push('main#inicio{display:flex;flex-direction:column}main#inicio>.shipping-disclosure{order:25}');
   design.sectionOrder.forEach((key,index)=>rules.push(`[data-store-section="${key}"]{order:${index*10}}`));
  }
  design.hiddenSections.forEach(key=>rules.push(`[data-store-section="${key}"]{display:none!important}`));
  designStyle.textContent=rules.join('\n');
  document.querySelectorAll('[data-store-text]').forEach(el=>{
   const key=el.dataset.storeText;
   if(!originalTexts.has(key))originalTexts.set(key,[...el.childNodes].map(n=>n.cloneNode(true)));
   if(Object.hasOwn(design.texts,key))el.textContent=design.texts[key];
   else el.replaceChildren(...originalTexts.get(key).map(n=>n.cloneNode(true)));
  });
 }
 function apply(settings){
  current=model.normalizeSettings(settings);
  applyDesign(current.design);
  window.dispatchEvent(new CustomEvent('streetball:settings-change',{detail:current}));
 }
 function frameMessage(event){
  if(!preview||event.origin!==location.origin||event.source!==parent||event.data?.source!=='streetball-visual-editor')return;
  const msg=event.data;
  if(msg.type==='preview'&&model){try{apply(msg.settings);}catch(e){send('error',{message:e.message});}}
  if(msg.type==='mode'){
   selectMode=msg.select===true;document.documentElement.classList.toggle('store-editor-select',selectMode);
  }
  if(msg.type==='select-product')window.dispatchEvent(new CustomEvent('streetball:editor-select-product',{detail:msg.id}));
  if(msg.type==='catalog-request')window.dispatchEvent(new Event('streetball:editor-catalog-request'));
 }
 window.addEventListener('message',frameMessage);
 if(preview){
  document.documentElement.classList.add('store-editor-preview','store-editor-select');
  const style=document.createElement('style');
  style.textContent='.store-editor-select .product-card:hover,.store-editor-select [data-store-text]:hover{outline:2px solid #626cca!important;outline-offset:4px;cursor:crosshair}.store-editor-select [data-store-section]:hover{box-shadow:inset 0 0 0 1px #818bd555}';
  document.head.append(style);
  document.addEventListener('click',event=>{
   const card=event.target.closest('.product-card');
   if(selectMode&&card){event.preventDefault();event.stopImmediatePropagation();send('select-product',{id:card.dataset.id});return;}
   const text=event.target.closest('[data-store-text]');
   if(selectMode&&text){event.preventDefault();event.stopImmediatePropagation();send('select-text',{key:text.dataset.storeText});return;}
   const link=event.target.closest('a[href]');
   if(link){const url=new URL(link.href,location.href);if(url.origin!==location.origin||!['/','/index.html'].includes(url.pathname)){event.preventDefault();event.stopImmediatePropagation();send('notice',{message:'Esta é a prévia da vitrine. Conta e links externos abrem pelo botão Ver loja.'});return;}}
   if(selectMode){const section=event.target.closest('[data-store-section]');if(section){event.preventDefault();event.stopImmediatePropagation();send('select-section',{key:section.dataset.storeSection});}}
  },true);
  document.addEventListener('submit',event=>{event.preventDefault();event.stopImmediatePropagation();send('notice',{message:'A prévia não envia pedidos nem gera pagamentos.'});},true);
  window.addEventListener('streetball:catalog-ready',event=>send('catalog',{products:event.detail}));
  window.addEventListener('streetball:catalog-error',event=>send('error',{message:event.detail}));
 }
 window.STREETBALL_SETTINGS_READY=(async()=>{
  model=await import('./store-settings.js?v=20261028-commission-pricing-v1');
  let info;
  if(location.hostname.endsWith('.github.io')||location.protocol==='file:')info={revision:0,settings:model.emptySettings()};
  else{
   const response=await fetch('/api/storefront/config',{cache:'no-store'});
   if(!response.ok)throw Error('Não foi possível carregar as correções de preços. Atualize a página.');
   info=await response.json();
  }
  current=model.normalizeSettings(info.settings);
  if(info.revision>0)applyDesign(current.design);
  send('ready',{textDefaults:Object.fromEntries([...document.querySelectorAll('[data-store-text]')].map(el=>[el.dataset.storeText,el.innerText]))});
  return {...info,settings:current,model};
 })();
 // Mantém a rejeição disponível para o app sem produzir erro global não tratado.
 window.STREETBALL_SETTINGS_READY.catch(()=>{});
})();
