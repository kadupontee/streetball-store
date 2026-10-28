const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=value=>{try{return new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});}catch{return '';}};
const validId=id=>/^[a-f0-9-]{36}$/i.test(id||'');
const onIPhone=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const supported=()=>window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const selected=()=>{const id=new URL(location.href).searchParams.get('orderId');return validId(id)?id:null;};
let loggedIn=false,busy=false,settingsOpen=false,pushConfig=null,lastData=null,lastUpdated=null,registration=null,lastPushResult=null;
const registered='serviceWorker' in navigator?navigator.serviceWorker.register('/ops/sw.js',{scope:'/ops/'}).then(()=>navigator.serviceWorker.ready).then(r=>{registration=r;return r;}).catch(()=>null):Promise.resolve(null);
async function api(action,{body,token}={}){
 const response=await fetch('/api/admin/sales/'+action,{method:body!==undefined?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},body:body!==undefined?JSON.stringify(body):undefined});
 const data=await response.json();
 if(response.status===401&&!token)showLogin();
 if(!response.ok){const error=Error(data.error||'Não foi possível consultar a loja.');Object.assign(error,{code:data.code,phase:data.phase,providerStatus:data.providerStatus,providerReason:data.providerReason,attemptId:data.attemptId});throw error;}
 return data;
}
function showLogin(){loggedIn=false;$('login').hidden=false;$('app').hidden=true;$('nav').hidden=true;$('starting').hidden=true;}
function showApp(){loggedIn=true;$('login').hidden=true;$('app').hidden=false;$('nav').hidden=false;$('starting').hidden=true;}
function showConnection(error){
 const element=$('connection');element.classList.toggle('error',!!error);
 element.textContent=error?(lastUpdated?'Não foi possível atualizar. Exibindo dados de '+date(lastUpdated)+'. '+error:error):'Atualizado em '+date(lastUpdated)+' · Atualiza a cada 20 segundos enquanto você acompanha.';
}
const orderLabels={awaiting_payment:'Aguardando pagamento',paid_supplier_pending:'Pagamento recebido',supplier_preparing:'Fornecedor preparando',payment_setup_failed:'Cobrança não gerada',payment_refunded:'Pagamento reembolsado',payment_disputed:'Pagamento em contestação'};
const jobLabels={requires_supplier_routing:'Aguardando fornecedor',supplier_contacted:'Consultando fornecedor',supplier_confirmed:'Fornecedor confirmou',supplier_payment_pending:'Pagamento ao fornecedor pendente',supplier_paid:'Pagamento ao fornecedor registrado',manual_review:'Precisa de atenção',supplier_attention:'Precisa de atenção',overdue_24h:'Resposta atrasada',queued_local:'Na fila do WhatsApp'};
function renderOrders(data){
 $('pageTitle').textContent='Suas vendas';
 const rows=data.orders||[];
 $('content').innerHTML=rows.length?rows.map(o=>`<button class="sale" data-order="${esc(o.id)}"><div class="row"><strong>Pedido #${esc(o.id.slice(0,8))}</strong><span class="amount">${money(o.total)}</span></div><p>${esc(o.name)} · ${date(o.created_at)}</p><p><span class="pill">${esc(['payment_refunded','payment_disputed'].includes(o.status)?orderLabels[o.status]:jobLabels[o.supplier_status]||orderLabels[o.status]||'Consultar pedido')}</span></p></button>`).join(''):'<div class="empty"><h3>Suas vendas aparecerão aqui.</h3><p>Ative os avisos para receber uma notificação após cada pagamento confirmado.</p><button class="primary" data-settings>Configurar avisos no iPhone</button></div>';
}
function renderOrder(data){
 const o=data.order;$('pageTitle').textContent='Acompanhar venda';
 $('content').innerHTML=`<button class="text-button back" data-back>← Todas as vendas</button><section class="panel order-heading"><p class="eyebrow">PEDIDO #${esc(o.id.slice(0,8))}</p><div class="summary-row"><h2>${esc(data.summary)}</h2><span class="amount">${money(o.total)}</span></div><p>${esc(o.customerName)} · ${esc(o.city)} / ${esc(o.state)}</p><p>Criado em ${date(o.createdAt)}</p></section>
 ${data.attention.length?'<div class="alert">'+data.attention.map(a=>'<p>'+esc(a)+'</p>').join('')+'</div>':''}
 <div class="stages">${data.stages.map(s=>`<section class="stage ${esc(s.state)}"><h3>${esc(s.label)}</h3><p>${esc(s.detail)}</p>${s.at?'<time>'+date(s.at)+'</time>':''}</section>`).join('')}</div>
 <section class="panel"><h3>O que já aconteceu</h3><p class="fine" style="margin:0 0 24px">Cada etapa abaixo usa um registro da loja, do envio pelo WhatsApp ou da confirmação bancária.</p>${data.activities.map(a=>`<div class="activity"><b>${esc(a.title)}</b><p>${date(a.at)} · ${esc(a.source)}</p></div>`).join('')}
 ${data.supplierPayment.receiptUrl?`<a class="receipt" href="${esc(data.supplierPayment.receiptUrl)}" target="_blank" rel="noopener noreferrer">Ver comprovante no Asaas ↗</a>`:''}</section>
 <section class="panel"><h3>Itens deste pedido</h3>${o.items.map(i=>`<div class="item"><b>${esc(i.qty)} × ${esc(i.title)}</b><br>Tamanho ${esc(i.size)}${i.personalize?' · Personalização: '+esc(i.customName)+' '+esc(i.customNumber):''}</div>`).join('')}</section>
 ${data.suppliers.length?'<section class="panel"><h3>Consultas aos fornecedores</h3>'+data.suppliers.map(s=>`<div class="item"><b>${esc(s.name)}</b><br>${esc(s.label)}<br><span class="muted">${date(s.updatedAt)}</span></div>`).join('')+'</section>':''}`;
}
async function refresh(){
 if(!loggedIn||busy||document.hidden)return;
 busy=true;$('refresh').disabled=true;
 const id=selected();
 try{
  const data=await api(id?'order?orderId='+encodeURIComponent(id):'orders');
  // Ignore a response if the user has opened a different order in the meantime.
  if(selected()!==id)return;
  lastData=data;lastUpdated=data.observedAt||new Date().toISOString();
  id?renderOrder(data):renderOrders(data);showConnection();
 }catch(error){if(selected()===id)showConnection(error.message||'Confira sua conexão.');}
 finally{busy=false;$('refresh').disabled=false;if(loggedIn&&selected()!==id)queueMicrotask(refresh);}
}
function navigate(id){
 history.pushState(null,'',id?'/ops/?orderId='+encodeURIComponent(id):'/ops/');lastData=null;lastUpdated=null;$('content').innerHTML='<div class="empty">Consultando o pedido…</div>';openSettings(false);refresh();
}
async function openSettings(open){settingsOpen=open;$('notificationSettings').hidden=!open;$('home').classList.toggle('nav-current',!open);$('settings').classList.toggle('nav-current',open);if(open)await updatePushStatus();}
async function updatePushStatus(){
 $('installHelp').hidden=!onIPhone||standalone();
 $('enablePush').disabled=true;$('testPush').hidden=true;$('disablePush').hidden=true;
 try{
  pushConfig=await api('notifications');
  if(pushConfig.lastAttempt)showPushResult(pushConfig.lastAttempt);
  if(onIPhone&&!standalone()){$('pushStatus').textContent='No iPhone, abra pelo ícone da Tela de Início para permitir os avisos.';return;}
  if(!supported()){$('pushStatus').textContent='Este navegador não oferece notificações. No iPhone, use o Safari e adicione à Tela de Início (iOS 16.4 ou posterior).';return;}
  const reg=await registered;if(!reg)throw Error('Não foi possível preparar os avisos. Atualize esta página.');
  const subscription=await reg.pushManager.getSubscription();
  const active=!!subscription&&Notification.permission==='granted'&&pushConfig.active;
  $('pushStatus').textContent=active?'Notificações ativadas neste aparelho. Envie um teste para conferir.':Notification.permission==='denied'?'Os avisos estão bloqueados. Permita as notificações da Streetball nos Ajustes do iPhone.':'Toque em Ativar notificações e escolha Permitir.';
  $('enablePush').disabled=Notification.permission==='denied';$('enablePush').hidden=active;$('testPush').hidden=!active;$('disablePush').hidden=!active;
  $('reconnectPush').hidden=!subscription||Notification.permission!=='granted';
 }catch(error){$('pushStatus').textContent=error.message;}
}
function decodeKey(key){return Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(key.length/4)*4,'=')),c=>c.charCodeAt(0));}
function showPushResult(result){
 lastPushResult={version:pushConfig?.version||'iphone-sales-v2',permission:'Notification' in window?Notification.permission:'unsupported',installed:standalone(),...result};
 $('pushDiagnostic').hidden=false;$('copyPushResult').hidden=false;
 $('pushDiagnostic').textContent=result.state==='accepted'?'O serviço de notificações aceitou o último envio.':'Resultado do teste: '+(result.code||'PUSH_TEST_FAILED')+(result.providerStatus?' · HTTP '+result.providerStatus:'')+(result.providerReason?' · '+result.providerReason:'');
}
async function activatePush(renew=false){
 if(!supported()||onIPhone&&!standalone()||!pushConfig?.publicKey)return;
 // Keep the permission prompt in the user's click, before any network await.
 const permissionPromise=Notification.requestPermission();
 $('enablePush').disabled=true;$('reconnectPush').disabled=true;
 try{
  if(await permissionPromise!=='granted')throw Error('Você precisa permitir os avisos para receber as vendas.');
  const reg=await registered;if(!reg)throw Error('Atualize o painel e tente outra vez.');
  let subscription=await reg.pushManager.getSubscription();
  if(subscription&&(renew||!pushConfig.active)){
   await api('notifications/unsubscribe',{body:{}});await subscription.unsubscribe();subscription=null;
  }
  if(!subscription)subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(pushConfig.publicKey)});
  await api('notifications/subscribe',{body:{subscription:subscription.toJSON()}});
  await updatePushStatus();
 }catch(error){$('pushStatus').textContent=error.message;$('enablePush').disabled=false;}finally{$('reconnectPush').disabled=false;}
}
$('enablePush').addEventListener('click',()=>activatePush(false));
$('reconnectPush').addEventListener('click',()=>activatePush(true));
$('testPush').addEventListener('click',async()=>{
 $('testPush').disabled=true;
 try{const result=await api('notifications/test',{body:{}});showPushResult({state:'accepted',id:result.attemptId,attemptedAt:new Date().toISOString()});$('pushStatus').textContent='Teste aceito pelo serviço de notificações. Confira o aviso no iPhone e toque para abrir este painel.';}
 catch(error){
  showPushResult({state:'failed',code:error.code||'PUSH_BROWSER_CONNECTION_FAILED',phase:error.phase||'browser',providerStatus:error.providerStatus,providerReason:error.providerReason,id:error.attemptId,attemptedAt:new Date().toISOString()});
  $('pushStatus').textContent=error.message;
  if(['PUSH_SUBSCRIPTION_EXPIRED','PUSH_SUBSCRIPTION_INVALID'].includes(error.code)){$('reconnectPush').hidden=false;pushConfig.active=false;}
 }finally{$('testPush').disabled=false;}
});
$('copyPushResult').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(JSON.stringify(lastPushResult,null,2));$('copyPushResult').textContent='Resultado copiado';}
 catch{$('pushStatus').textContent='Não foi possível copiar. Informe a mensagem e o código exibidos acima.';}
});
$('disablePush').addEventListener('click',async()=>{
 try{await api('notifications/unsubscribe',{body:{}});const sub=await registration?.pushManager.getSubscription();await sub?.unsubscribe();$('enablePush').hidden=false;await updatePushStatus();}
 catch(error){$('pushStatus').textContent=error.message;}
});
$('loginForm').addEventListener('submit',async event=>{
 event.preventDefault();const key=$('adminKey').value.trim(),button=event.target.querySelector('button');button.disabled=true;$('loginMessage').textContent='Conferindo seu acesso…';
 try{await api('session',{body:{},token:key});$('adminKey').value='';showApp();await refresh();await openSettings(true);}
 catch(error){$('loginMessage').textContent=error.message;}finally{button.disabled=false;}
});
$('home').addEventListener('click',()=>navigate(null));
$('settings').addEventListener('click',()=>openSettings(!settingsOpen));
$('refresh').addEventListener('click',refresh);
$('logout').addEventListener('click',async()=>{
 try{await api('logout',{body:{}});const sub=await registration?.pushManager.getSubscription();await sub?.unsubscribe();$('content').innerHTML='';lastData=null;lastUpdated=null;showLogin();}
 catch(error){showConnection(error.message);}
});
$('content').addEventListener('click',event=>{const order=event.target.closest('[data-order]');if(order&&validId(order.dataset.order))navigate(order.dataset.order);if(event.target.closest('[data-back]'))navigate(null);if(event.target.closest('[data-settings]'))openSettings(true);});
addEventListener('popstate',()=>refresh());
addEventListener('online',()=>refresh());
addEventListener('offline',()=>showConnection('O aparelho está sem internet.'));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
setInterval(refresh,20000);
(async()=>{try{await api('session');showApp();await refresh();const config=await api('notifications');if(!config.active)await openSettings(true);}catch{showLogin();}})();
