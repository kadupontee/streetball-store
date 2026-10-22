const $=id=>document.getElementById(id);
const msg=text=>{$('accountMessage').textContent=text;};
async function call(path,method='GET',data=null){
 const options={method,credentials:'same-origin',headers:{'accept':'application/json'}};
 if(data!==null){options.headers['content-type']='application/json';options.body=JSON.stringify(data);}
 const response=await fetch('/api/account/'+path,options);
 const json=await response.json().catch(()=>({}));
 if(response.status===404)throw Error('Serviço de contas ainda não publicado. Atualize a página ou avise a Streetball Store.');
 if(!response.ok)throw Error(json.error||'Serviço de contas indisponível.');
 return json;
}
function switchTab(which){
 $('loginForm').hidden=which!=='login';$('registerForm').hidden=which!=='register';
 $('loginTab').setAttribute('aria-selected',String(which==='login'));
 $('registerTab').setAttribute('aria-selected',String(which==='register'));
 msg('');
}
$('loginTab').addEventListener('click',()=>switchTab('login'));
$('registerTab').addEventListener('click',()=>switchTab('register'));
function showLoggedOut(){
 $('authPane').hidden=false;$('profilePane').hidden=true;$('logout').hidden=true;$('menuGoogle').hidden=true;
 if(googleReady)renderGoogleButtons();
}
async function showLoggedIn(user){
 $('authPane').hidden=true;$('profilePane').hidden=false;$('logout').hidden=false;$('menuGoogle').hidden=!googleReady;
 $('accountGreeting').textContent='OLÁ, '+user.displayName.split(' ')[0].toLocaleUpperCase('pt-BR')+'.';
 $('accountEmail').textContent=user.email;
 const saved=localStorage.getItem('streetball_tracking_link');
 $('claimSaved').hidden=!saved;
 if(googleReady)renderGoogleButtons();
 await loadOrders();
 if(location.hash==='#pedidos')$('pedidos').scrollIntoView({block:'start'});
}
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const shortDate=s=>{const d=new Date(s);return Number.isFinite(d.getTime())?d.toLocaleDateString('pt-BR'):'Data a confirmar'};
const labels={
 awaiting_payment:'Aguardando pagamento',paid_supplier_pending:'Verificando fornecedor',
 supplier_preparing:'Em preparação',payment_setup_failed:'Falha na cobrança',
 payment_refunded:'Reembolsado',payment_disputed:'Em análise'
};
async function loadOrders(){
 const area=$('ordersList');
 try{
  const {orders}=await call('orders');
  area.replaceChildren();
  if(!orders.length){const p=document.createElement('p');p.className='muted';p.textContent='Nenhum pedido vinculado a esta conta. Se já comprou, use o link de acompanhamento para vincular a compra.';area.append(p);return;}
  for(const o of orders){
   const box=document.createElement('article');box.className='order-entry';
   const header=document.createElement('header'),name=document.createElement('h3'),state=document.createElement('small');
   name.textContent='Pedido #'+o.id;state.textContent=labels[o.status]||'Em acompanhamento';
   header.append(name,state);
   const line=document.createElement('p');
   line.textContent=shortDate(o.createdAt)+' · '+money(o.total);
   const product=document.createElement('p');product.className='muted';
   product.textContent=o.items.map(it=>(it.qty||1)+'x '+it.title+' ('+it.size+')').join(' · ').slice(0,500);
   box.append(header,line,product);
   if(o.trackingCode){const tracking=document.createElement('p');tracking.textContent='Código de rastreamento: '+o.trackingCode;box.append(tracking);}
   if(o.trackingUrl){
    const link=document.createElement('a');link.href=o.trackingUrl;link.textContent='ACOMPANHAR PEDIDO →';link.rel='noreferrer';box.append(link);
   }else{const text=document.createElement('small');text.textContent='O rastreamento privado estará disponível após a configuração da loja.';box.append(text);}
   area.append(box);
  }
 }catch(err){area.replaceChildren();const p=document.createElement('p');p.textContent=err.message;area.append(p)}
}
for(const [formId,action] of [['registerForm','register'],['loginForm','login']]){
 $(formId).addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form).entries());
  const button=form.querySelector('button[type=submit]');button.disabled=true;msg('Processando com segurança...');
  try{
   const result=await call(action,'POST',data);
   form.reset();msg('Conta acessada com sucesso.');
   await showLoggedIn(result.user);
  }catch(err){msg(err.message)}finally{button.disabled=false}
 });
}
$('logout').addEventListener('click',async()=>{
 try{await call('logout','POST',{});showLoggedOut();msg('Você saiu da sua conta.');if(googleReady)await initGoogle()}catch(err){msg(err.message)}
});
function parseTrackingLink(value){
 try{
  const url=new URL(value.trim(),location.origin);
  if(url.origin!==location.origin||url.pathname!=='/track.html')return null;
  const m=url.hash.slice(1).match(/^([a-f0-9-]{36})\.([a-f0-9]{64})$/i);
  return m?{orderId:m[1],access:m[2]}:null;
 }catch{return null;}
}
$('claimForm').addEventListener('submit',async event=>{
 event.preventDefault();const data=parseTrackingLink($('claimLink').value);
 if(!data){msg('Cole um link privado de acompanhamento válido da Streetball Store.');return;}
 try{await call('claim','POST',data);msg('Pedido vinculado com sucesso.');$('claimForm').reset();await loadOrders();}catch(err){msg(err.message)}
});
$('claimSaved').addEventListener('click',()=>{
 const saved=localStorage.getItem('streetball_tracking_link');
 if(saved){$('claimLink').value=saved;location.hash='vincular';msg('Link preenchido. Clique em VINCULAR PEDIDO para confirmar.')}
});
$('menuOrders').addEventListener('click',()=>{if($('profilePane').hidden){switchTab('login');msg('Entre ou crie sua conta para ver seus pedidos.')}});
$('menuClaim').addEventListener('click',()=>{if($('profilePane').hidden){switchTab('register');msg('Crie sua conta antes de vincular o pedido.')}});
async function init(){
 try{
  const me=await call('me');
  if(me.authenticated)await showLoggedIn(me.user);
  else{showLoggedOut();if(location.hash==='#criar-conta')switchTab('register');}
 }catch(err){showLoggedOut();msg('Não foi possível carregar a área de conta. Verifique se a migração do banco foi aplicada.')}
}

let googleReady=false,googleClientId=null;
const googleScript=()=>new Promise((resolve,reject)=>{
 if(window.google?.accounts?.id){resolve();return;}
 const tag=document.createElement('script');
 tag.src='https://accounts.google.com/gsi/client';
 tag.async=true;
 tag.onload=()=>window.google?.accounts?.id?resolve():reject(new Error('Biblioteca Google indisponível'));
 tag.onerror=()=>reject(new Error('Não foi possível carregar o Google'));
 document.head.append(tag);
});
function renderGoogleButtons(){
 if(!googleReady||!window.google?.accounts?.id)return;
 const targets=[$('googleSignInButton'),$('googleConnectButton')];
 targets.forEach(el=>el.replaceChildren());
 const target=$('profilePane').hidden?targets[0]:targets[1];
 window.google.accounts.id.renderButton(target,{
  type:'standard',theme:'outline',size:'large',shape:'rectangular',text:'continue_with',
  logo_alignment:'left',width:Math.min(340,Math.max(240,target.parentElement.clientWidth-30))
 });
}
async function googleCredentialReceived(response){
 if(typeof response?.credential!=='string'){msg('O Google não retornou uma credencial válida.');return;}
 const isLinking=!$('profilePane').hidden;
 try{
  msg(isLinking?'Conectando sua Conta do Google...':'Confirmando sua identidade com o Google...');
  const data=await call(isLinking?'google/connect':'google/login','POST',{credential:response.credential});
  if(isLinking)msg('Conta do Google conectada com sucesso. Agora você também pode usá-la para entrar.');
  else{await showLoggedIn(data.user);msg('Você entrou com sua Conta do Google.');}
 }catch(error){
  msg(error.message);
  // O nonce anterior pode estar vencido; tente novamente após atualizar a página.
 }
}
async function initGoogle(){
 let config;
 try{config=await call('google/config')}catch{return;}
 if(!config.enabled||!config.clientId)return; // Não expor botão quebrado sem Google Cloud configurado.
 try{
  const {nonce}=await call('google/nonce');
  await googleScript();
  window.google.accounts.id.initialize({
   client_id:config.clientId,nonce,
   callback:googleCredentialReceived,auto_select:false,
   cancel_on_tap_outside:true,ux_mode:'popup'
  });
  googleClientId=config.clientId;
  googleReady=true;
  $('googleAuthBox').hidden=false;
  $('googleConnectBox').hidden=false;
  $('menuGoogle').hidden=$('profilePane').hidden;
  renderGoogleButtons();
 }catch(error){msg('O login Google não está disponível. Use seu e-mail e senha por enquanto.');}
}

init().then(initGoogle);
