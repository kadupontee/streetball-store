(()=>{
'use strict';
const $=id=>document.getElementById(id),panel=$('sellersPanel'),button=$('sellersToggle');
let sellers=[],orders=[],selected='',includeDeleted=false,search='',open=false,draft=null,notice='',error=false,highlight='',saving=false,requestId=0;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>(Number(c||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'Data não informada'};
const paymentStatus=o=>['payment_refunded','payment_disputed'].includes(o.status)?'Estornado / contestado':o.received?'Pagamento recebido':'Aguardando pagamento';
const metric=(label,value,extra='')=>`<article class="team-metric ${extra}"><span>${label}</span><strong>${value}</strong></article>`;
async function api(action,body){
 const response=await fetch('/api/admin/sales/'+action,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000),headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw Error(data?.error||'Não foi possível consultar os vendedores.');
 if(!data)throw Error('A loja retornou uma resposta incompleta. Atualize para tentar novamente.');
 return data;
}
function showNotice(message,isError=false){notice=message;error=isError;const el=$('sellerNotice');if(el){el.textContent=message;el.className='team-notice'+(isError?' is-error':'');el.hidden=!message;el.setAttribute('role',isError?'alert':'status');}}
function card(s,index){
 const state=s.deleted_at?'Excluído':s.active?'Ativo':'Inativo';
 return `<article class="seller-card${highlight===s.id?' just-saved':''}" data-seller-card="${esc(s.id)}" tabindex="-1">
 <div class="seller-card-head"><span class="seller-rank">${String(index+1).padStart(2,'0')}</span><div class="seller-identity"><h3>${esc(s.nickname)}</h3><p>${esc(s.email)}</p></div><span class="team-badge ${s.deleted_at?'is-removed':s.active?'is-active':''}">${state}</span></div>
 <div class="seller-terms"><span>Cupom <b>${esc(s.coupon)}</b></span><span>Comissão <b>${s.commission_bps/100}%</b></span></div>
 <div class="seller-numbers">${metric('Vendas pagas',s.sales)}${metric('Faturamento para a loja',money(s.revenueCents))}${metric('Comissão a pagar',money(s.dueCents),'accent')}</div>
 <div class="seller-balances"><span>Acumulada <b>${money(s.earnedCents)}</b></span><span>Já paga <b>${money(s.paidCents)}</b></span>${s.sales?'':'<span class="seller-zero">Ainda sem vendas</span>'}</div>
 <div class="seller-card-actions"><button class="secondary" data-view="${esc(s.id)}">Ver pedidos</button><button class="text-button" data-edit="${esc(s.id)}">${s.deleted_at?'Restaurar / editar':'Editar cadastro'}</button>${s.deleted_at?'':`<button class="text-button danger" data-delete="${esc(s.id)}">Excluir</button>`}</div></article>`;
}
function editor(){
 if(!draft)return '';
 return `<section class="team-editor" id="sellerEditor"><div class="team-section-head"><div><p class="eyebrow">${draft.sellerId?'EDITAR CADASTRO':'NOVA PARCERIA'}</p><h2>${draft.sellerId?'Dados do vendedor':'Cadastrar vendedor'}</h2></div><button class="text-button" type="button" data-cancel>Fechar</button></div>
 <p class="muted">O vendedor entra com sua própria conta Streetball. Informe o mesmo e-mail usado por ele na loja.</p>
 <form id="sellerEdit" method="post" action="/api/admin/sales/sellers/save"><input name="sellerId" type="hidden">
 <div class="team-form-grid"><label>Apelido do vendedor<input name="nickname" autocomplete="off" minlength="2" maxlength="60" placeholder="Como ele será identificado" required></label><label>E-mail da conta<input name="email" type="email" autocomplete="off" maxlength="180" placeholder="vendedor@exemplo.com" required></label><label>Cupom exclusivo<input name="coupon" pattern="(?:[A-Za-z0-9_]|-){2,32}" minlength="2" maxlength="32" placeholder="APELIDO10" autocapitalize="characters" spellcheck="false" required><small>Letras, números, hífen ou sublinhado.</small></label><label>Comissão por venda (%)<input name="commissionPercent" type="number" min="0" max="25" step="0.01" required><small>Defina um percentual de até 25%.</small></label></div>
 <label class="seller-check"><input type="checkbox" name="active"> Vendedor ativo: liberar cupom e painel individual</label><p class="team-form-note">O cupom oferece 5% de desconto ao cliente. A comissão incide nos produtos após o desconto, sem frete. Novos percentuais valem para pedidos futuros.</p>
 <div class="buttons"><button type="submit" class="primary" ${saving?'disabled':''}>${saving?'Salvando…':'Salvar vendedor'}</button><button class="secondary" type="button" data-cancel>Cancelar</button></div><p id="sellerSaveStatus" class="team-notice" role="status" hidden></p></form></section>`;
}
function orderCard(o){
 const seller=sellers.find(s=>s.id===o.seller_id),available=o.received&&!['payment_refunded','payment_disputed'].includes(o.status);
 return `<article class="team-order"><div class="team-order-head"><div><b>Pedido #${esc(o.order_id.slice(0,8))}</b><p>${esc(seller?.nickname||o.coupon)} · ${esc(o.coupon)} · ${esc(date(o.created_at))}</p></div><span class="team-badge">${paymentStatus(o)}</span></div><div class="team-order-values"><span>Faturamento <b>${money(o.net_cents)}</b></span><span>Comissão registrada <b>${o.commission_bps/100}% · ${money(o.commission_cents)}</b></span><span>Baixa <b>${o.paid_cents?'Paga · '+money(o.paid_cents):'Não paga'}</b></span></div>${!o.paid_cents&&available?`<button class="secondary" data-settle="${esc(o.order_id)}">Registrar comissão paga</button>`:''}</article>`;
}
function renderList(){
 const term=search.trim().toLocaleLowerCase('pt-BR');
 const visible=sellers.filter(s=>(includeDeleted||!s.deleted_at)&&(!term||[s.nickname,s.email,s.coupon].some(v=>String(v).toLocaleLowerCase('pt-BR').includes(term))));
 $('sellerList').innerHTML=visible.length?visible.map(s=>card(s,sellers.filter(x=>includeDeleted||!x.deleted_at).indexOf(s))).join(''):`<div class="team-empty"><h3>${term?'Nenhum resultado para esta busca.':'Sua equipe começa aqui.'}</h3><p>${term?'Busque por apelido, e-mail ou cupom.':'Cadastre um vendedor para acompanhar seu cupom e suas comissões, mesmo antes da primeira venda.'}</p>${term?'':'<button class="primary" data-new>Cadastrar primeiro vendedor</button>'}</div>`;
 $('sellerCount').textContent=`${visible.length} ${visible.length===1?'vendedor':'vendedores'} na lista`;
}
function render(){
 const chosen=sellers.find(s=>s.id===selected),filtered=orders.filter(o=>!selected||o.seller_id===selected);
 const sum=key=>sellers.reduce((total,s)=>total+Number(s[key]||0),0);
 panel.innerHTML=`<section class="team-hero"><div><p class="eyebrow">STREETBALL / SUA EQUIPE</p><h2>Quem vende,<br><em>cresce junto.</em></h2><p>Gerencie vendedores, cupons e comissões em um só lugar.</p></div><div class="team-hero-actions"><button class="primary" data-new>+ Novo vendedor</button><a href="/vendedor.html" class="team-access" target="_blank" rel="noopener">Painel individual do vendedor ↗</a></div></section>
 <div class="team-summary">${metric('Vendedores cadastrados',sellers.filter(s=>!s.deleted_at).length)}${metric('Faturamento confirmado',money(sum('revenueCents')))}${metric('Comissões a pagar',money(sum('dueCents')),'accent')}</div>
 <p class="team-summary-note">Totais financeiros incluem o histórico de vendedores excluídos. Faturamento após desconto, sem frete.</p>
 <p id="sellerNotice" class="team-notice" role="status" hidden></p>${editor()}
 <section class="team-ranking"><div class="team-section-head"><div><p class="eyebrow">RANKING DA EQUIPE</p><h2>Seus vendedores</h2><p>Ordenados por faturamento pago. Quem ainda não vendeu também aparece.</p></div><button class="secondary" data-reload>Atualizar lista</button></div>
 <div class="team-filters"><label class="team-search">Buscar vendedor<input id="sellerSearch" type="search" placeholder="Apelido, e-mail ou cupom" autocomplete="off"></label><label class="seller-check"><input id="showArchived" type="checkbox" ${includeDeleted?'checked':''}> Incluir excluídos</label><span id="sellerCount" class="muted"></span></div><div id="sellerList" class="seller-list"></div></section>
 <section class="team-orders" id="sellerOrders"><div class="team-section-head"><div><p class="eyebrow">VENDA POR VENDA</p><h2>Comissões por pedido${chosen?' · '+esc(chosen.nickname):''}</h2></div>${chosen?'<button class="text-button" data-all>Ver toda a equipe</button>':''}</div>${chosen?`<p class="team-selected">Comissão atual: <b>${chosen.commission_bps/100}%</b> · Faturamento pago: <b>${money(chosen.revenueCents)}</b> · A pagar: <b>${money(chosen.dueCents)}</b></p>`:''}${filtered.length?filtered.map(orderCard).join(''):`<div class="team-empty"><h3>${chosen?'Este vendedor ainda não tem pedidos.':'As comissões começam na primeira venda.'}</h3><p>${chosen?'O cadastro está disponível. Faturamento e comissões seguem em R$ 0,00 até a primeira venda paga.':'Pedidos com cupom aparecerão aqui. O pagamento confirmado libera o valor para comissão.'}</p></div>`}</section>`;
 $('sellerSearch').value=search;
 if(draft){const f=$('sellerEdit');for(const key of ['sellerId','nickname','email','coupon','commissionPercent'])f.elements.namedItem(key).value=draft[key];f.elements.namedItem('active').checked=draft.active;}
 renderList();showNotice(notice,error);
}
async function load(){
 const id=++requestId,data=await api('sellers');
 if(id!==requestId||!open)return false;
 if(!Array.isArray(data.sellers)||!Array.isArray(data.orders))throw Error('Não foi possível ler a lista de vendedores. Tente atualizar.');
 sellers=data.sellers;orders=data.orders;render();return true;
}
function setTabUrl(visible){const url=new URL(location.href);if(visible){url.searchParams.set('tab','vendedores');url.searchParams.delete('orderId')}else url.searchParams.delete('tab');history.replaceState(null,'',url.pathname+url.search+url.hash);}
async function show(){
 open=true;panel.hidden=false;button.setAttribute('aria-expanded','true');button.classList.add('nav-current');$('content').hidden=true;$('notificationSettings').hidden=true;$('home').classList.remove('nav-current');$('settings').classList.remove('nav-current');$('pageTitle').textContent='Sua equipe de vendedores';setTabUrl(true);
 document.dispatchEvent(new Event('streetball:ops-sellers'));
 panel.innerHTML='<div class="team-empty" role="status"><h2>Carregando sua equipe…</h2><p>Consultando os cadastros da loja.</p></div>';
 try{await load()}catch(e){if(!open)return;panel.innerHTML='<div class="team-empty"><h2>Não foi possível carregar a equipe.</h2><p id="sellerLoadError" role="alert"></p><button class="primary" data-reload>Tentar novamente</button></div>';$('sellerLoadError').textContent=e.message;}
}
function close(){open=false;++requestId;panel.hidden=true;panel.replaceChildren();sellers=[];orders=[];button.setAttribute('aria-expanded','false');button.classList.remove('nav-current');$('content').hidden=false;setTabUrl(false);}
function readForm(f){const value=name=>f.elements.namedItem(name).value;return {sellerId:value('sellerId'),nickname:value('nickname'),email:value('email'),coupon:value('coupon'),commissionPercent:value('commissionPercent'),active:f.elements.namedItem('active').checked};}
function edit(id){
 const seller=sellers.find(s=>s.id===id);draft=seller?{sellerId:seller.id,nickname:seller.nickname,email:seller.email,coupon:seller.coupon,commissionPercent:seller.commission_bps/100,active:seller.deleted_at?true:!!seller.active}:{sellerId:'',nickname:'',email:'',coupon:'',commissionPercent:20,active:true};
 notice='';render();$('sellerEditor').scrollIntoView({behavior:'smooth',block:'start'});$('sellerEdit').elements.namedItem('nickname').focus({preventScroll:true});
}
button.addEventListener('click',()=>open?$('home').click():show());
for(const id of ['home','settings','logout'])$(id).addEventListener('click',close);
document.addEventListener('streetball:ops-ready',()=>{if(new URL(location.href).searchParams.get('tab')==='vendedores')show()});
document.addEventListener('streetball:ops-locked',()=>{draft=null;notice='';close()});
$('refresh').addEventListener('click',()=>{if(open)load().catch(e=>showNotice(e.message,true))});
panel.addEventListener('input',e=>{if(e.target.getAttribute('id')==='sellerSearch'){search=e.target.value;renderList();return}const f=e.target.closest('form#sellerEdit');if(f)draft=readForm(f)});
panel.addEventListener('change',e=>{if(e.target.getAttribute('id')==='showArchived'){includeDeleted=e.target.checked;renderList()}const f=e.target.closest('form#sellerEdit');if(f)draft=readForm(f)});
panel.addEventListener('click',async e=>{
 const target=e.target.closest('button');if(!target)return;
 if(target.hasAttribute('data-new')||target.dataset.edit){edit(target.dataset.edit);return;}
 if(target.hasAttribute('data-cancel')){draft=null;render();return;}
 if(target.dataset.view||target.hasAttribute('data-all')){selected=target.dataset.view||'';render();$('sellerOrders').scrollIntoView({behavior:'smooth',block:'start'});return;}
 try{
  if(target.hasAttribute('data-reload')){await load();return;}
  if(target.dataset.delete){const s=sellers.find(s=>s.id===target.dataset.delete);if(!confirm('Excluir '+s.nickname+'? O cupom e o acesso serão desativados. Pedidos e comissões serão preservados.'))return;target.disabled=true;await api('sellers/delete',{id:s.id});draft=null;showNotice('Vendedor excluído. Consulte o histórico em “Incluir excluídos”.');await load();}
  if(target.dataset.settle&&confirm('Confirmar que você já pagou esta comissão? Esta ação registra a baixa, sem transferir dinheiro.')){target.disabled=true;await api('sellers/settle',{orderId:target.dataset.settle});showNotice('Pagamento de comissão registrado.');await load();}
 }catch(error){showNotice(error.message,true)}finally{target.disabled=false}
});
panel.addEventListener('submit',async e=>{
 // Read the attribute through a selector: named controls can shadow form.id in browsers.
 const form=e.target.closest('form#sellerEdit');if(!form)return;e.preventDefault();if(saving)return;
 draft=readForm(form);const {sellerId,...fields}=draft,submit=form.querySelector('[type="submit"]');saving=true;submit.disabled=true;submit.textContent='Salvando…';const status=$('sellerSaveStatus');status.hidden=false;status.textContent='Salvando o cadastro na loja…';let persisted=false;
 try{
  const saved=await api('sellers/save',{id:sellerId,...fields});if(!saved.ok||!saved.id)throw Error('A loja não confirmou o cadastro. Tente novamente.');persisted=true;
  draft=null;search='';includeDeleted=false;selected='';highlight=saved.id;notice='Vendedor salvo e disponível na lista. Acesso pelo e-mail cadastrado e senha da própria conta.';error=false;
  const loaded=await load();if(loaded&&!sellers.some(s=>s.id===saved.id))throw Error('O vendedor foi salvo, mas não apareceu na consulta. Atualize a lista para conferir.');
  if(loaded){const card=[...panel.querySelectorAll('[data-seller-card]')].find(el=>el.dataset.sellerCard===saved.id);card?.scrollIntoView({behavior:'smooth',block:'center'});card?.focus({preventScroll:true});}
 }catch(e){
  if(persisted&&open)render();
  const message=persisted?'Cadastro salvo. Não foi possível atualizar a lista agora: '+e.message:e.message;showNotice(message,true);
  if($('sellerSaveStatus')){$('sellerSaveStatus').hidden=false;$('sellerSaveStatus').textContent=message;}
 }finally{saving=false;if(submit.isConnected){submit.disabled=false;submit.textContent='Salvar vendedor';}}
});
})();
