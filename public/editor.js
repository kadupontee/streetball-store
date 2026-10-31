import {emptySettings,normalizeSettings,applyProductOverride,apparelPriceMode,DEFAULT_DESIGN,CATEGORIES,KINDS,RETAIL_PRICES_BRL,BRAZIL_TEAMS,SECTIONS,TEXTS} from './store-settings.js?v=20261028-seller-portals-v1';

const $=id=>document.getElementById(id);
const clone=x=>structuredClone(x);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const normalizeText=x=>String(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const DRAFT_KEY='streetball_visual_draft_v1';
let token='',settings=emptySettings(),published=emptySettings(),revision=0,versions=[],catalog=[],byId=new Map(),textDefaults={};
let tab='layout',selection=null,device='desktop',select=true,undo=[],redo=[],busy=false,recovery=null,query='',category='',onlyEdited=false,onlyUnassigned=false,resultLimit=30,toastTimer,previewTimer,draftStored=true;
const dirty=()=>JSON.stringify(settings)!==JSON.stringify(published);
const frame=()=>$('storePreview').contentWindow;
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?7500:4200);}
async function api(method='GET',body,queryString=''){
 const response=await fetch('/api/admin/store-editor'+queryString,{method,cache:'no-store',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json().catch(()=>({error:'O editor não respondeu. Confira a conexão e a publicação da loja.'}));
 if(!response.ok)throw Error(data.error||'Não foi possível acessar o editor.');
 return data;
}
function send(type,data={}){frame()?.postMessage({source:'streetball-visual-editor',type,...data},location.origin);}
function sendPreview(){clearTimeout(previewTimer);previewTimer=setTimeout(()=>send('preview',{settings}),70);}
function saveDraft(){try{draftStored=true;if(dirty())localStorage.setItem(DRAFT_KEY,JSON.stringify({format:'streetball-visual-editor-v1',baseRevision:revision,settings,savedAt:new Date().toISOString()}));else localStorage.removeItem(DRAFT_KEY);}catch{draftStored=false;toast('O navegador não conseguiu guardar o rascunho. Use Exportar rascunho para preservar as alterações.',true);}}
function updateStatus(){
 const changed=dirty();$('publicationStatus').textContent=changed?'Rascunho com alterações':'Versão publicada · '+revision;
 $('saveStatus').textContent=changed?(draftStored?'Salvo neste navegador':'Exporte para guardar o rascunho'):'Tudo atualizado';
 $('publish').disabled=!changed||busy||!token;$('undo').disabled=!undo.length||busy;$('redo').disabled=!redo.length||busy;
 const count=Object.keys(settings.products).length;$('editCount').textContent=count?count+' produto'+(count===1?' corrigido':'s corrigidos'):'Nenhuma correção manual';
}
function commitDraft(next,{history=true,render=true}={}){
 try{
  const clean=normalizeSettings(next);if(JSON.stringify(clean)===JSON.stringify(settings))return;
  if(history){undo.push(clone(settings));if(undo.length>30)undo.shift();redo=[];}
  settings=clean;saveDraft();updateStatus();sendPreview();if(render)renderPanel();
 }catch(e){toast(e.message,true);}
}
function goUndo(){if(!undo.length||busy)return;redo.push(clone(settings));settings=undo.pop();saveDraft();updateStatus();renderPanel();sendPreview();}
function goRedo(){if(!redo.length||busy)return;undo.push(clone(settings));settings=redo.pop();saveDraft();updateStatus();renderPanel();sendPreview();}
function setTab(value){tab=value;document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.setAttribute('aria-pressed',String(b.dataset.tab===tab));});renderPanel();}
function setSelection(kind,value){selection={kind,value};setTab(kind==='product'?'products':'layout');if(kind==='text')setTimeout(()=>$('properties').querySelector('[data-text-key="'+CSS.escape(value)+'"]')?.focus(),0);}
function options(map,value,empty=''){return (empty?'<option value="">'+esc(empty)+'</option>':'')+Object.entries(map).map(([key,label])=>'<option value="'+esc(key)+'"'+(key===value?' selected':'')+'>'+esc(label)+'</option>').join('');}
function colorField(key,label){return '<div class="color-field"><label for="design-'+key+'">'+label+'</label><span class="color-code">'+esc(settings.design[key])+'</span><input id="design-'+key+'" type="color" data-design="'+key+'" value="'+esc(settings.design[key])+'"></div>';}
function rangeField(key,label,min,max,unit=''){return '<label class="field"><span>'+label+'<output>'+settings.design[key]+unit+'</output></span><input type="range" min="'+min+'" max="'+max+'" data-design="'+key+'" value="'+settings.design[key]+'"></label>';}
function textField(key){return '<label class="field"><span>'+esc(TEXTS[key])+'</span><textarea data-text-key="'+key+'" maxlength="500" rows="2" placeholder="'+esc(textDefaults[key]||'Texto original da loja')+'">'+esc(settings.design.texts[key]??'')+'</textarea></label>';}
function renderLayout(){
 const focusedText=selection?.kind==='text'?selection.value:null;
 const sectionRows=settings.design.sectionOrder.map((key,index)=>'<div class="section-row'+(selection?.kind==='section'&&selection.value===key?' selected':'')+'"><input type="checkbox" data-section-visible="'+key+'" aria-label="Exibir '+esc(SECTIONS[key])+'" '+(!settings.design.hiddenSections.includes(key)?'checked':'')+(key==='catalog'?' disabled':'')+'><span>'+esc(SECTIONS[key])+'</span><button class="small-icon" data-move="'+key+'" data-direction="-1" aria-label="Subir '+esc(SECTIONS[key])+'" '+(index===0?'disabled':'')+'>↑</button><button class="small-icon" data-move="'+key+'" data-direction="1" aria-label="Descer '+esc(SECTIONS[key])+'" '+(index===settings.design.sectionOrder.length-1?'disabled':'')+'>↓</button></div>').join('');
 return (focusedText?'<section class="panel-section"><h2 class="panel-title">Texto selecionado <span class="edited-badge">PRÉVIA</span></h2>'+textField(focusedText)+'</section>':'')+
 '<section class="panel-section"><h2 class="panel-title">Cores da loja</h2>'+colorField('accent','Botões e destaques')+colorField('background','Fundo da página')+colorField('headerBackground','Cabeçalho')+colorField('heroBackground','Banner principal')+colorField('textColor','Textos')+'</section>'+
 '<section class="panel-section"><h2 class="panel-title">Produtos e espaçamento</h2>'+rangeField('gridColumns','Colunas no computador',2,5)+rangeField('mobileColumns','Colunas no celular',1,2)+rangeField('productGap','Espaço entre produtos',8,40,' px')+rangeField('cardRadius','Cantos das fotos',0,28,' px')+rangeField('fontScale','Texto dos produtos',85,120,'%')+'<label class="field"><span>Enquadramento das fotos</span><select data-design="imageFit"><option value="contain" '+(settings.design.imageFit==='contain'?'selected':'')+'>Mostrar a foto inteira</option><option value="cover" '+(settings.design.imageFit==='cover'?'selected':'')+'>Preencher o espaço</option></select></label></section>'+
 '<section class="panel-section"><h2 class="panel-title">Dimensões</h2>'+rangeField('maxWidth','Largura do conteúdo',1080,1720,' px')+rangeField('heroHeight','Altura do banner no computador',380,780,' px')+'</section>'+
 '<section class="panel-section"><h2 class="panel-title">Ordem e visibilidade</h2><p class="panel-description">Use as setas para mover uma seção. Desmarque para ocultar na vitrine.</p>'+sectionRows+'</section>'+
 '<section class="panel-section"><h2 class="panel-title">Textos da vitrine</h2>'+Object.keys(TEXTS).filter(k=>k!==focusedText).map(textField).join('')+'</section><button class="text-button" id="resetLayout">Restaurar o layout original</button>';
}
function productImage(url,cls=''){const allowed=typeof url==='string'&&(/^\/images\/[a-zA-Z0-9_./-]+\.(?:webp|jpe?g|png)$/i.test(url)&&!url.includes('..')||/^https:\/\/photo\.yupoo\.com\//i.test(url));return allowed?'<img class="'+cls+'" src="'+esc(url)+'" alt="Foto do produto" loading="lazy">':'<span class="editor-no-photo" role="img" aria-label="Produto sem foto">SEM<br>FOTO</span>';}
function currentProduct(id){const original=byId.get(id);return original?applyProductOverride(original,settings.products[id]):null;}
function teamField(product){
 const selected=settings.products[product.id]?.team||'';
 const inferred=product.brazilClub?BRAZIL_TEAMS.find(([id])=>id===product.brazilClub)?.[1]:product.europeClub?window.STREETBALL_EUROPE?.leagues.flatMap(([,,,teams])=>teams).concat(window.STREETBALL_EUROPE.otherClubs).find(([id])=>id===product.europeClub)?.[1]:'';
 const option=(value,label)=>'<option value="'+esc(value)+'"'+(selected===value?' selected':'')+'>'+esc(label)+'</option>';
 const brazil='<optgroup label="Brasileirão">'+BRAZIL_TEAMS.map(([id,name])=>option('brasileirao:'+id,name)).join('')+option('brasileirao:outros','Outros times brasileiros')+'</optgroup>';
 const euro=window.STREETBALL_EUROPE;
 const europe=euro?euro.leagues.map(([league,label,,teams])=>'<optgroup label="'+esc(label)+'">'+teams.map(([id,name])=>option('europa:'+id,name)).join('')+'</optgroup>').join('')+'<optgroup label="Demais clubes europeus">'+euro.otherClubs.map(([id,name])=>option('europa:'+id,name)).join('')+option('europa:outros','Outras equipes europeias')+'</optgroup>':'';
 return '<label class="field"><span>Time / Onde aparece na loja</span><select id="productTeam">'+option('',inferred?'Automático · '+inferred:'Automático · identificar pelo nome')+brazil+europe+'</select></label><p class="panel-description">Escolha um time para mover esta peça de clube. A seleção prevalece sobre o nome do fornecedor, inclusive nos produtos retrô.</p>';
}
function suggestedPrice(kind){return RETAIL_PRICES_BRL[kind]}
function setSuggestedPrice(kind){
 const price=suggestedPrice(kind),field=$('productPrice');if(!field||!Number.isFinite(price))return;
 field.value=price.toFixed(2).replace('.',',');
 field.readOnly=['jacket','coat','blouse'].includes(kind);
 const hint=$('priceSuggestion');if(hint)hint.textContent=field.readOnly?'Jaquetas, blusas e casacos usam o mesmo preço: '+money(price)+'.':'Preço atualizado pelo tipo de peça: '+money(price)+'. Você pode alterar manualmente.';
 const cover=$('properties').querySelector('.product-cover strong');if(cover)cover.textContent=money(price);
}
function renderProductForm(id){
 const product=currentProduct(id);if(!product)return '<div class="empty-state">Catálogo ainda não carregado.</div>';
 const priceMode=apparelPriceMode(product);
 return '<button id="backProducts" class="text-button back-button">← Todos os produtos</button><section class="panel-section"><h2 class="panel-title">Editar produto '+(settings.products[id]?'<span class="edited-badge">CORRIGIDO</span>':'')+'</h2><div class="product-cover">'+productImage(product.image)+'<div><small>REFERÊNCIA<br>'+esc(product.id)+'</small><strong>'+money(product.price)+'</strong></div></div><form id="productForm"><label class="field"><span>Nome na loja</span><textarea id="productTitle" maxlength="200" required>'+esc(product.title)+'</textarea></label><label class="field"><span>Categoria</span><select id="productCategory">'+options(CATEGORIES,product.category)+'</select></label><label class="field"><span>Tipo de peça (camisa, blusa, casaco…)</span><select id="productKind">'+options(KINDS,product.kind)+'</select></label><label class="field price-field"><span>Preço base em reais</span><input id="productPrice" inputmode="decimal" type="text" value="'+esc(product.price.toFixed(2).replace('.',','))+'" '+(priceMode==='shared'?'readonly ':'')+'required autocomplete="off"></label><p class="panel-description" id="priceSuggestion">'+(priceMode==='shared'?'Jaquetas, blusas e casacos usam o preço comum de '+money(product.price)+'.':priceMode==='highest'?'Tipo ainda em revisão: aplicado o maior preço entre as possibilidades. Escolha o tipo correto para resolver a dúvida.':'Ao trocar o tipo de peça, o valor é atualizado automaticamente conforme a tabela de preços da loja. Você pode alterá-lo antes de salvar.')+'</p>'+teamField(product)+'<label class="check-row"><input type="checkbox" id="productHidden" '+(product.hidden?'checked':'')+'> Ocultar este produto da loja</label><div class="product-actions"><button type="submit" class="button button-primary full-width">Aplicar na prévia</button><button type="button" id="resetProduct" class="text-button">Usar os dados originais deste produto</button></div></form></section><p class="panel-description">O time, a categoria e o preço escolhidos por você continuam salvos mesmo após a atualização do catálogo. Tamanhos extras, patch e personalização são acrescentados à parte.</p>';
}
function filteredProducts(){
 const term=normalizeText(query);
 return catalog.map(p=>currentProduct(p.id)).filter(p=>p&&(!category||p.category===category)&&(!onlyEdited||settings.products[p.id])&&(!onlyUnassigned||((p.category==='brasileirao'&&!p.brazilClub&&!settings.products[p.id]?.team)||(p.category==='europa'&&!p.europeClub&&!settings.products[p.id]?.team)))&&(!term||normalizeText(p.title+' '+p.id+' '+(CATEGORIES[p.category]||'')).includes(term)));
}
function renderProductResults(){
 const target=$('productResults');if(!target)return;
 const products=filteredProducts();
 target.innerHTML=products.slice(0,resultLimit).map(p=>'<button class="product-result" data-product="'+esc(p.id)+'">'+productImage(p.image)+'<span><strong>'+esc(p.title)+'</strong><small>'+money(p.price)+(p.hidden?' · Oculto':'')+(settings.products[p.id]?' · <i>Corrigido</i>':'')+'</small></span></button>').join('')||'<div class="empty-state">'+(catalog.length?'Nenhum produto encontrado. Tente outro nome ou referência.':'Carregando o catálogo completo da loja…')+'</div>';
 $('resultCaption').textContent='Exibindo '+Math.min(resultLimit,products.length)+' de '+products.length+' produtos';
 $('moreResults').hidden=products.length<=resultLimit;
}
function renderProducts(){
 if(selection?.kind==='product')return renderProductForm(selection.value);
 return '<section class="panel-section"><h2 class="panel-title">Catálogo completo <span class="edited-badge">'+catalog.length+'</span></h2><p class="panel-description">Busque pelo nome ou clique no produto na prévia.</p><input id="productSearch" class="search-input product-search" type="search" placeholder="Time, modelo ou referência…" value="'+esc(query)+'"><div class="product-filters"><select id="productCategoryFilter" aria-label="Filtrar categoria">'+options(CATEGORIES,category,'Todas as categorias')+'</select></div><label class="check-row"><input id="onlyEdited" type="checkbox" '+(onlyEdited?'checked':'')+'> Apenas produtos corrigidos</label><label class="check-row"><input id="onlyUnassigned" type="checkbox" '+(onlyUnassigned?'checked':'')+'> Revisar produtos sem time identificado</label><div class="product-results" id="productResults"></div><p class="result-caption" id="resultCaption"></p><button id="moreResults" class="button button-light load-results">Mostrar mais</button></section>';
}
function dateLabel(value){try{return new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});}catch{return value;}}
function renderHistory(){return '<section class="panel-section"><h2 class="panel-title">Versões publicadas</h2><p class="panel-description">Uma versão anterior abre como rascunho. Confira na prévia e publique quando quiser restaurá-la.</p>'+versions.map(v=>'<button class="history-item" data-version="'+v.revision+'"><span><strong>Versão '+v.revision+(v.revision===revision?' · Atual':'')+'</strong><small>'+esc(dateLabel(v.published_at))+'</small></span><span>Revisar →</span></button>').join('')+'<button class="history-item" data-version="0"><span><strong>Layout e catálogo originais</strong><small>Sem correções manuais</small></span><span>Revisar →</span></button></section>';}
function renderPanel(){
 $('properties').innerHTML=tab==='layout'?renderLayout():tab==='products'?renderProducts():renderHistory();
 if(tab==='products'&&selection?.kind!=='product')renderProductResults();
}
function resizePreview(){
 if($('workspace').hidden)return;
 const stage=$('previewStage'),padding=innerWidth<=1150?14:22,width=device==='mobile'?390:1440;
 const scale=Math.min(1,(stage.clientWidth-padding*2)/width);
 if(scale<=0)return;
 const shell=$('previewShell');shell.style.width=width+'px';shell.style.height=Math.max(250,(stage.clientHeight-padding*2)/scale)+'px';shell.style.transform='scale('+scale+')';shell.style.left=Math.max(padding,(stage.clientWidth-width*scale)/2)+'px';
 $('previewSize').textContent=width+' px · '+Math.round(scale*100)+'%';
}
function setMode(value){select=value;send('mode',{select});for(const [id,active] of [['selectMode',select],['browseMode',!select]]){$(id).classList.toggle('active',active);$(id).setAttribute('aria-pressed',String(active));}$('previewTip').textContent=select?'Clique em um produto ou texto para editar.':'Navegue pelas categorias, abra produtos e confira os detalhes. Pedidos estão desativados na prévia.';}
function inspectProduct(id,scroll=false){
 if(!byId.has(id)){toast('Aguarde o catálogo terminar de carregar.',true);return;}
 setSelection('product',id);if(scroll)send('select-product',{id});
}
function parsePrice(value){
 let text=value.trim().replace(/^R\$\s*/i,'').replace(/\s/g,'');
 if(text.includes(','))text=text.replace(/\./g,'').replace(',','.');
 if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw Error('Informe um preço como 149,90.');
 return Math.round(Number(text)*100)/100;
}
async function connect(event){
 event.preventDefault();token=$('adminKey').value.trim();$('loginError').textContent='';$('connect').disabled=true;
 try{
  const data=await api();revision=data.revision;settings=normalizeSettings(data.settings);published=clone(settings);versions=data.versions||[];undo=[];redo=[];
  $('adminKey').value='';$('loginScreen').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;
  document.title='Editor visual | Streetball Store';$('previewAddress').textContent=location.host;
  try{recovery=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');}catch{recovery=null;}
  if(recovery?.settings){$('draftRecovery').hidden=false;if(recovery.baseRevision!==revision){$('draftRecovery').querySelector('span').textContent='Há um rascunho de uma versão anterior. Confira as mudanças ao recuperar.';}}
  renderPanel();updateStatus();$('storePreview').src='/?editor=visual';resizePreview();
 }catch(e){token='';$('loginError').textContent=e.message;}
 finally{$('connect').disabled=false;}
}
async function publish(){
 if(!dirty()||busy)return;busy=true;updateStatus();$('properties').inert=true;$('publish').textContent='Publicando…';
 try{
  const result=await api('POST',{expectedRevision:revision,settings});revision=result.revision;published=normalizeSettings(result.settings);settings=clone(published);undo=[];redo=[];
  versions=[{revision,published_at:result.publishedAt},...versions].slice(0,20);saveDraft();renderPanel();sendPreview();toast('Versão '+revision+' publicada. As alterações já valem para a loja e o checkout.');
 }catch(e){toast(e.message,true);}
 finally{busy=false;$('properties').inert=false;$('publish').textContent='Publicar alterações';updateStatus();}
}
function downloadDraft(){
 let content={format:'streetball-visual-editor-v1',baseRevision:revision,settings,savedAt:new Date().toISOString()};
 if(recovery?.settings&&recovery.baseRevision!==revision&&!dirty())content=recovery;
 const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download='streetball-edicao-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('loginForm').addEventListener('submit',connect);$('publish').addEventListener('click',publish);$('undo').addEventListener('click',goUndo);$('redo').addEventListener('click',goRedo);
$('selectMode').addEventListener('click',()=>setMode(true));$('browseMode').addEventListener('click',()=>setMode(false));
$('export').addEventListener('click',downloadDraft);
$('resetDraft').addEventListener('click',()=>{commitDraft(published);toast('Última versão publicada carregada na prévia. Você pode desfazer.');});
$('recoverDraft').addEventListener('click',()=>{if(recovery?.settings)commitDraft(recovery.settings);$('draftRecovery').hidden=true;recovery=null;});
$('discardDraft').addEventListener('click',()=>{recovery=null;$('draftRecovery').hidden=true;try{localStorage.removeItem(DRAFT_KEY);}catch{}});
$('import').addEventListener('change',async event=>{
 const file=event.target.files?.[0];if(!file)return;
 try{if(file.size>1600000)throw Error('Arquivo muito grande.');const data=JSON.parse(await file.text());commitDraft(data.settings||data);toast('Arquivo aberto como rascunho. Confira a prévia antes de publicar.');}catch(e){toast(e.message,true);}finally{event.target.value='';}
});
$('logout').addEventListener('click',()=>{saveDraft();token='';$('storePreview').src='about:blank';$('workspace').hidden=true;$('loginScreen').hidden=false;$('logout').hidden=true;$('publish').disabled=true;$('publicationStatus').textContent='Editor visual';$('saveStatus').textContent='Entre para começar';catalog=[];byId.clear();});
document.addEventListener('click',async event=>{
 const target=event.target.closest('button');if(!target)return;
 if(target.dataset.tab){selection=null;setTab(target.dataset.tab);}
 if(target.dataset.device){device=target.dataset.device;document.querySelectorAll('[data-device]').forEach(b=>{b.classList.toggle('active',b.dataset.device===device);b.setAttribute('aria-pressed',String(b.dataset.device===device));});resizePreview();}
 if(target.dataset.product)inspectProduct(target.dataset.product,true);
 if(target.id==='backProducts'){selection=null;renderPanel();}
 if(target.id==='moreResults'){resultLimit+=30;renderProductResults();}
 if(target.id==='resetProduct'&&selection?.kind==='product'){const next=clone(settings);delete next.products[selection.value];commitDraft(next);}
 if(target.id==='resetLayout'){const next=clone(settings);next.design=clone(DEFAULT_DESIGN);commitDraft(next);}
 if(target.dataset.move){const next=clone(settings),order=next.design.sectionOrder,index=order.indexOf(target.dataset.move),other=index+Number(target.dataset.direction);if(other>=0&&other<order.length){[order[index],order[other]]=[order[other],order[index]];commitDraft(next);}}
 if(target.dataset.version!==undefined){try{const previous=await api('GET',null,'?revision='+target.dataset.version);commitDraft(previous.settings);toast('Versão '+previous.revision+' aberta como rascunho.');}catch(e){toast(e.message,true);}}
});
$('properties').addEventListener('change',event=>{
 const input=event.target;
 if(input.dataset.design){const next=clone(settings);next.design[input.dataset.design]=input.type==='range'?Number(input.value):input.value;commitDraft(next);}
 if(input.dataset.textKey){const next=clone(settings);if(input.value.trim())next.design.texts[input.dataset.textKey]=input.value.trim();else delete next.design.texts[input.dataset.textKey];commitDraft(next);}
 if(input.dataset.sectionVisible){const next=clone(settings),hidden=new Set(next.design.hiddenSections);input.checked?hidden.delete(input.dataset.sectionVisible):hidden.add(input.dataset.sectionVisible);next.design.hiddenSections=[...hidden];commitDraft(next);}
 if(input.id==='productCategoryFilter'){category=input.value;resultLimit=30;renderProductResults();}
 if(input.id==='onlyEdited'){onlyEdited=input.checked;resultLimit=30;renderProductResults();}
 if(input.id==='onlyUnassigned'){onlyUnassigned=input.checked;resultLimit=30;renderProductResults();}
 if(input.id==='productKind'){
  if(['jacket','coat','blouse'].includes(input.value))$('productCategory').value='treino';
  setSuggestedPrice(input.value);
 }
 if(input.id==='productCategory'){
  const mapping={retro:'retro',infantil:'kids',feminino:'female'};
  if(mapping[input.value]&&['fan','retro','kids','female'].includes($('productKind').value)){$('productKind').value=mapping[input.value];setSuggestedPrice(mapping[input.value]);}
 }
 if(input.id==='productTeam'&&input.value){
  const target=input.value.split(':')[0],cat=$('productCategory');
  if(['outras','brasileirao','europa'].includes(cat.value))cat.value=target;
 }
});
$('properties').addEventListener('input',event=>{
 const input=event.target;if(input.id==='productSearch'){query=input.value;resultLimit=30;renderProductResults();}
 if(input.type==='range'&&input.dataset.design){const output=input.closest('label')?.querySelector('output');if(output)output.textContent=input.value;}
});
$('properties').addEventListener('submit',event=>{
 if(event.target.id!=='productForm')return;event.preventDefault();if(selection?.kind!=='product')return;
 try{
  const original=byId.get(selection.value),next=clone(settings),patch={...next.products[selection.value]};
  const values={title:$('productTitle').value.trim(),price:parsePrice($('productPrice').value),category:$('productCategory').value,kind:$('productKind').value,hidden:$('productHidden').checked};
  const chosenTeam=$('productTeam').value;if(chosenTeam)values.team=chosenTeam;else delete patch.team;
  for(const [key,value] of Object.entries(values)){if(key==='kind'&&original.apparelPriceReviewRequired)patch.kind=value;else if(value===(original[key]??(key==='hidden'?false:undefined)))delete patch[key];else patch[key]=value;}
  if(Object.keys(patch).length)next.products[selection.value]=patch;else delete next.products[selection.value];
  // Validate before announcing success; invalid input leaves the inspector untouched.
  const valid=normalizeSettings(next);commitDraft(valid);toast('Produto atualizado na prévia. Publique para aplicar à loja.');
 }catch(e){toast(e.message,true);}
});
window.addEventListener('message',event=>{
 if(!token||event.origin!==location.origin||event.source!==frame()||event.data?.source!=='streetball-store-preview')return;
 const data=event.data;
 if(data.type==='ready'){textDefaults=data.textDefaults||{};sendPreview();setMode(select);send('catalog-request');$('previewLoading').hidden=true;if(tab==='layout')renderPanel();}
 if(data.type==='catalog'&&Array.isArray(data.products)){
  catalog=data.products.filter(p=>p&&typeof p.id==='string');byId=new Map(catalog.map(p=>[p.id,p]));$('catalogCount').textContent=catalog.length.toLocaleString('pt-BR')+' produtos';$('previewLoading').hidden=true;if(tab==='products')renderPanel();sendPreview();
 }
 if(data.type==='select-product')inspectProduct(data.id);
 if(data.type==='select-text'&&Object.hasOwn(TEXTS,data.key))setSelection('text',data.key);
 if(data.type==='select-section'&&Object.hasOwn(SECTIONS,data.key))setSelection('section',data.key);
 if(data.type==='notice'||data.type==='error')toast(String(data.message||'Confira a prévia.'),data.type==='error');
});
$('storePreview').addEventListener('load',()=>{if(token){sendPreview();setMode(select);send('catalog-request');resizePreview();}});
window.addEventListener('resize',resizePreview);new ResizeObserver(resizePreview).observe($('previewStage'));
window.addEventListener('beforeunload',event=>{if(token&&dirty()){event.preventDefault();event.returnValue='';}});
document.addEventListener('keydown',event=>{
 if(!token||busy||/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName))return;
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?goRedo():goUndo();}
});
