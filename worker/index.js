import {routePaidOrder,handleSupplierInbound,monitorSupplierSLA,retryPendingRoutes,previewSupplierOrder,loadSupplierCandidates} from './fulfillment.js';
import {supplierIdValid} from './supplier-mapping.js';
/** Streetball Store - Cloudflare Worker + D1 + Asaas sandbox/production
 * Nunca armazene tokens ou chaves na pasta public/.
 * IMPORTANTE: pagamento ao fornecedor NÃO é automatizado neste MVP.
 */
const json=(data,status=200,more={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...more}});
const cors={ 'access-control-allow-origin':'https://streetballstore.com.br', 'access-control-allow-headers':'content-type', 'access-control-allow-methods':'GET, POST, OPTIONS'};
const unaccent=s=>String(s||'').replace(/\D/g,'');
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const safeText=(s,len=100)=>String(s??'').trim().slice(0,len);
const clientError=(message,status=400)=>json({error:message},status);
function cpfValid(cpf){const s=unaccent(cpf);if(!/^\d{11}$/.test(s)||/^(\d)\1+$/.test(s))return false;for(let n=9;n<=10;n++){let sum=0;for(let i=0;i<n;i++)sum+=Number(s[i])*(n+1-i);let d=(sum*10)%11;if(d===10)d=0;if(d!==Number(s[n]))return false;}return true}
async function catalogFor(request,env){let r=await env.ASSETS.fetch(new Request(new URL('/catalog.json',request.url)));if(!r.ok)throw Error('CATALOG_UNAVAILABLE');return r.json()}
const fail=(msg)=>{throw new Error(msg)};
function validateItems(raw,products){if(!Array.isArray(raw)||!raw.length||raw.length>35)fail('Sua sacola precisa conter entre 1 e 35 itens.');let subtotal=0,count=0;const clean=[];for(const i of raw){const p=products.find(x=>x.id===i.id);if(!p)fail('Produto indisponível: '+safeText(i.id,30));if(!p.sizes.includes(i.size))fail('Tamanho inválido para '+safeText(p.title));const qty=Number(i.qty);if(!Number.isInteger(qty)||qty<1||qty>10)fail('Quantidade inválida.');const patch=i.patch===true,personalize=i.personalize===true;let customName=safeText(i.customName,14),customNumber=safeText(i.customNumber,3);if(!personalize){customName='';customNumber=''}if(personalize&&!customName&&!customNumber)fail('Personalização incompleta.');if(customName&&!/^[\p{L}0-9 .'-]+$/u.test(customName))fail('Nome de personalização inválido.');if(customNumber&&!/^\d{1,3}$/.test(customNumber))fail('Número de personalização inválido.');const sizeExtra=({XXL:5,'3XL':10,'4XL':15})[i.size]||0;const unit=round(Number(p.price)+sizeExtra+(patch?8:0)+(personalize?20:0));if(!(unit>=0&&unit<10000))fail('Preço inválido.');subtotal+=unit*qty;count+=qty;clean.push({id:p.id,title:p.title,qty,size:i.size,patch,personalize,customName,customNumber,unitPrice:unit,image:p.image||null,sourceUrl:p.sourceUrl||null,supplierId:safeText(p.supplierId||'',40)})}if(count>50)fail('Quantidade total excedida.');return {items:clean,subtotal:round(subtotal)}}
async function asaas(endpoint,env,body){const api=env.ASAAS_SANDBOX==='true'?'https://api-sandbox.asaas.com/v3':'https://api.asaas.com/v3';const r=await fetch(api+endpoint,{method:'POST',headers:{'content-type':'application/json','access_token':env.ASAAS_API_KEY,'user-agent':'StreetballStore/1.0'},body:JSON.stringify(body)});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error('Erro no provedor de pagamento: '+(data.errors?.[0]?.description||r.status));return data}
function checkoutReady(env){
 const shipping=Number(env.SHIPPING_FLAT_BRL);
 return !!(env.DB&&env.ASSETS&&env.ASAAS_API_KEY&&env.SHIPPING_FLAT_BRL!==undefined&&Number.isFinite(shipping)&&shipping>=0&&shipping<=500&&env.SALES_ENABLED==='true'&&(env.ASAAS_SANDBOX==='true'||env.PAYMENTS_PRODUCTION_ENABLED==='true'));
}
function checkoutConfig(env){
 return json({enabled:checkoutReady(env),sandbox:env.ASAAS_SANDBOX==='true',shipping:checkoutReady(env)?Number(env.SHIPPING_FLAT_BRL):null,methods:['PIX','CREDIT_CARD'],supplierPaymentAutomated:false});
}
async function createOrder(req,env){if(!env.DB||!env.ASSETS)return clientError('Banco e catálogo não configurados.',503);if(!checkoutReady(env))return clientError('Checkout ainda não liberado: configure cobrança, frete e ambiente autorizado.',503);if(Number(req.headers.get('content-length')||0)>22000)return clientError('Requisição muito grande.',413);const body=await req.json().catch(()=>null);if(!body)return clientError('Requisição inválida.');const whatsappOptIn=body.whatsappOptIn===true;const billingType=['PIX','CREDIT_CARD'].includes(body.paymentMethod)?body.paymentMethod:null;if(!billingType)return clientError('Escolha Pix ou cartão de crédito.');const c=body.customer||{};const name=safeText(c.name,110),email=safeText(c.email,180).toLowerCase(),phone=unaccent(c.phone),cpf=unaccent(c.cpf),zip=unaccent(c.zip),address=safeText(c.address,180),city=safeText(c.city,90),state=safeText(c.state,2).toUpperCase();if(name.length<3||!/^\S+@\S+\.\S+$/.test(email)||!(phone.length===10||phone.length===11)||!cpfValid(cpf)||zip.length!==8||!address||!city||!(/^[A-Z]{2}$/.test(state)))return clientError('Confira seus dados, CPF, telefone e endereço.');let cart;try{cart=validateItems(body.items,await catalogFor(req,env))}catch(e){return clientError(e.message)}const shipping=Number(env.SHIPPING_FLAT_BRL);if(!Number.isFinite(shipping)||shipping<0||shipping>500)return clientError('Configuração de entrega inválida.',503);const total=round(cart.subtotal+shipping);if(total<=0)return clientError('Valor de pedido inválido.');
const requestKey=safeText(req.headers.get('Idempotency-Key'),60);
if(!/^[a-f0-9-]{36}$/i.test(requestKey))return clientError('Identificador de checkout ausente. Atualize o site e tente novamente.',400);
const canonical=JSON.stringify({customer:{name,email,phone,cpf,zip,address,city,state},items:cart.items,total,billingType,whatsappOptIn});
const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));
const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
const id=crypto.randomUUID();const now=new Date().toISOString();
const attempt=await env.DB.prepare('INSERT OR IGNORE INTO checkout_attempts(request_key,payload_hash,order_id,created_at) VALUES(?,?,?,?)').bind(requestKey,hash,id,now).run();
if(!attempt.meta?.changes){
 const prior=await env.DB.prepare('SELECT request_key,payload_hash,order_id FROM checkout_attempts WHERE request_key=?').bind(requestKey).first();
 if(!prior||prior.payload_hash!==hash)return clientError('Essa tentativa de checkout já está vinculada a outros dados. Atualize o checkout.',409);
 const saved=await env.DB.prepare('SELECT id,status,total,shipping,payment_url FROM orders WHERE id=?').bind(prior.order_id).first();
 if(saved?.payment_url&&saved.status==='awaiting_payment')return json({orderId:saved.id,paymentUrl:saved.payment_url,total:saved.total,shipping:saved.shipping,method:billingType,sandbox:env.ASAAS_SANDBOX==='true',reused:true});
 return clientError('Sua cobrança ainda está em processamento ou precisa ser conferida. Consulte o pedido antes de tentar outra compra.',409);
}
await env.DB.prepare('INSERT INTO orders(id,created_at,updated_at,status,name,email,phone,cpf,zip,address,city,state,items_json,subtotal,shipping,total) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,now,now,'awaiting_payment',name,email,phone,cpf,zip,address,city,state,JSON.stringify(cart.items),cart.subtotal,shipping,total).run();if(whatsappOptIn)await env.DB.prepare('INSERT OR IGNORE INTO buyer_message_optin(order_id,consented_at) VALUES(?,?)').bind(id,now).run();
try{const customer=await asaas('/customers',env,{name,email,cpfCnpj:cpf,mobilePhone:phone,postalCode:zip,addressNumber:(address.match(/\b\d{1,5}\b/)||[])[0]||'S/N',externalReference:id,notificationDisabled:true});const due=new Date(Date.now()+48*3600*1000).toISOString().slice(0,10);const charge=await asaas('/payments',env,{customer:customer.id,billingType,value:total,dueDate:due,description:`Streetball Store pedido ${id.slice(0,8)}`,externalReference:id});if(!charge.id||!charge.invoiceUrl)throw Error('Cobrança não retornou link seguro.');await env.DB.prepare('UPDATE orders SET payment_id=?,payment_url=?,updated_at=? WHERE id=?').bind(charge.id,charge.invoiceUrl,new Date().toISOString(),id).run();return json({orderId:id,paymentUrl:charge.invoiceUrl,total,subtotal:cart.subtotal,shipping,method:billingType,sandbox:env.ASAAS_SANDBOX==='true'});}catch(e){await env.DB.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?').bind('payment_setup_failed',new Date().toISOString(),id).run();return clientError('Não foi possível gerar a cobrança. Tente novamente mais tarde.',502)}}
async function paymentWebhook(req,env,ctx){
 if(!env.ASAAS_WEBHOOK_TOKEN||req.headers.get('asaas-access-token')!==env.ASAAS_WEBHOOK_TOKEN)return clientError('Não autorizado.',401);
 if(!env.DB)return clientError('Banco não disponível.',503);
 const event=await req.json().catch(()=>null);
 if(!event?.id||!event?.event||!event?.payment?.id)return clientError('Evento inválido.');
 const seen=await env.DB.prepare('SELECT id FROM webhook_events WHERE id=?').bind(event.id).first();
 if(seen)return json({ok:true,duplicate:true});
 // Nunca permitir que a descrição ou um ID de pedido isolado "prove" pagamento.
 let order=await env.DB.prepare('SELECT id,status,total,payment_id FROM orders WHERE payment_id=?').bind(event.payment.id).first();
 if(!order&&event.payment.externalReference){
   order=await env.DB.prepare('SELECT id,status,total,payment_id FROM orders WHERE id=? AND (payment_id IS NULL OR payment_id=?)').bind(event.payment.externalReference,event.payment.id).first();
 }
 if(!order)return json({ok:true,unmatched:true});
 if(event.payment.externalReference&&event.payment.externalReference!==order.id)return clientError('Cobrança inconsistente.',409);
 if(Math.abs(Number(event.payment.value)-Number(order.total))>0.009||!Number.isFinite(Number(event.payment.value)))return clientError('Valor da cobrança divergente.',409);
 if(order.payment_id&&order.payment_id!==event.payment.id)return clientError('ID da cobrança divergente.',409);
 await env.DB.prepare('INSERT OR IGNORE INTO webhook_events(id,received_at,event_name) VALUES(?,?,?)').bind(event.id,new Date().toISOString(),event.event).run();
 if(!order.payment_id)await env.DB.prepare('UPDATE orders SET payment_id=?,updated_at=? WHERE id=? AND payment_id IS NULL').bind(event.payment.id,new Date().toISOString(),order.id).run();
 // PAYMENT_CONFIRMED pode não significar saldo disponível; só liberar fornecedor quando RECEIVED.
 if(event.event==='PAYMENT_RECEIVED'){
   const changed=await env.DB.prepare("UPDATE orders SET status='paid_supplier_pending',updated_at=? WHERE id=? AND status='awaiting_payment'").bind(new Date().toISOString(),order.id).run();
   if(changed.meta?.changes){
     await env.DB.prepare("INSERT OR IGNORE INTO supplier_jobs(id,order_id,status,created_at,updated_at) VALUES(?,?,?,?,?)")
       .bind(crypto.randomUUID(),order.id,'requires_supplier_routing',new Date().toISOString(),new Date().toISOString()).run();
     const task=routePaidOrder(env,order.id);
     if(ctx?.waitUntil)ctx.waitUntil(task);else await task;
   }
 }else if(['PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE'].includes(event.event)){
   const state=event.event==='PAYMENT_REFUNDED'?'payment_refunded':'payment_disputed';
   await env.DB.prepare("UPDATE orders SET status=?,updated_at=? WHERE id=? AND status IN ('awaiting_payment','paid_supplier_pending','supplier_preparing')").bind(state,new Date().toISOString(),order.id).run();
   await env.DB.prepare("UPDATE supplier_jobs SET status='manual_review',updated_at=? WHERE order_id=?").bind(new Date().toISOString(),order.id).run();
 }
 return json({ok:true});
}
// Painel administrativo protegido por token, nunca público.
async function adminApi(request,env,ctx){
 if(!env.ADMIN_TOKEN||request.headers.get('authorization')!=='Bearer '+env.ADMIN_TOKEN)return clientError('Não autorizado.',401);
 if(!env.DB)return clientError('Banco não configurado.',503);
 const url=new URL(request.url);
 if(url.pathname==='/api/admin/supplier-directory'&&request.method==='GET'){
   // A migração da prioridade é aditiva. Se ainda não foi aplicada,
   // liste os fornecedores existentes em vez de aparentar que foram apagados.
   let suppliers;
   try{
     suppliers=await env.DB.prepare(
       'SELECT d.id,d.display_name,c.phone_e164,c.authorized,p.rank FROM supplier_directory d LEFT JOIN supplier_contacts c ON c.supplier_id=d.id LEFT JOIN supplier_priority p ON p.supplier_id=d.id ORDER BY CASE WHEN p.rank IS NULL THEN 1 ELSE 0 END,p.rank,d.created_at,d.id'
     ).all();
   }catch(error){
     if(!/no such table:\s*supplier_priority/i.test(String(error?.message||'')))throw error;
     suppliers=await env.DB.prepare(
       'SELECT d.id,d.display_name,c.phone_e164,c.authorized,NULL AS rank FROM supplier_directory d LEFT JOIN supplier_contacts c ON c.supplier_id=d.id ORDER BY d.created_at,d.id'
     ).all();
   }
   return json({suppliers:(suppliers.results||[]).map(s=>({
     id:s.id,display_name:s.display_name,
     phoneConfigured:!!s.phone_e164,
     phoneEnding:s.phone_e164?String(s.phone_e164).slice(-4):'',
     authorized:s.authorized===1,
     priority:s.rank??null
   }))});
 }
 if(url.pathname==='/api/admin/supplier-directory'&&request.method==='POST'){
   if(Number(request.headers.get('content-length')||0)>2000)return clientError('Requisição muito grande.',413);
   const body=await request.json().catch(()=>null);
   const id=String(body?.id||'').trim().toLowerCase();
   const displayName=String(body?.displayName||'').trim();
   if(!supplierIdValid(id)||displayName.length<2||displayName.length>75)return clientError('Identificador ou nome inválido.');
   const existing=await env.DB.prepare('SELECT id FROM supplier_directory WHERE id=?').bind(id).first();
   if(existing)return clientError('Identificador já cadastrado. Use um novo identificador.',409);
   const quantity=await env.DB.prepare('SELECT COUNT(*) AS total FROM supplier_directory').first();
   if(Number(quantity?.total||0)>=5)return clientError('Máximo de cinco fornecedores.',409);
   const now=new Date().toISOString();
   await env.DB.prepare('INSERT INTO supplier_directory (id,display_name,created_at,updated_at) VALUES (?,?,?,?)').bind(id,displayName,now,now).run();
   return json({ok:true,id,displayName},201);
 }
 if(url.pathname==='/api/admin/supplier-update'&&request.method==='POST'){
   if(Number(request.headers.get('content-length')||0)>1500)return clientError('Requisição muito grande.',413);
   const body=await request.json().catch(()=>null);
   const id=String(body?.id||'').trim().toLowerCase();
   const displayName=String(body?.displayName||'').trim();
   const rawPhone=typeof body?.phone==='string'?body.phone.trim():'';
   const phone=rawPhone.replace(/\D/g,'');
   if(!supplierIdValid(id)||displayName.length<2||displayName.length>75)
     return clientError('Nome ou identificador inválido.');
   if(rawPhone&&!/^[1-9]\d{7,14}$/.test(phone))
     return clientError('Informe um WhatsApp com DDI (8 a 15 dígitos) ou deixe o campo vazio para manter o atual.');
   if(typeof body.authorized!=='boolean')return clientError('Informe se o fornecedor autorizou as consultas.');
   const current=await env.DB.prepare(
     'SELECT d.id,c.phone_e164 FROM supplier_directory d LEFT JOIN supplier_contacts c ON c.supplier_id=d.id WHERE d.id=?'
   ).bind(id).first();
   if(!current)return clientError('Fornecedor não encontrado. Atualize a página.',404);
   if(body.authorized&&!phone&&!current.phone_e164)
     return clientError('Cadastre um número antes de autorizar consultas.');
   const t=new Date().toISOString(),actions=[
     env.DB.prepare('UPDATE supplier_directory SET display_name=?,updated_at=? WHERE id=?').bind(displayName,t,id)
   ];
   if(rawPhone){
     actions.push(env.DB.prepare(
       'INSERT INTO supplier_contacts(supplier_id,phone_e164,authorized,updated_at) VALUES(?,?,?,?) ON CONFLICT(supplier_id) DO UPDATE SET phone_e164=excluded.phone_e164,authorized=excluded.authorized,updated_at=excluded.updated_at'
     ).bind(id,phone,body.authorized?1:0,t));
   }else if(current.phone_e164){
     actions.push(env.DB.prepare('UPDATE supplier_contacts SET authorized=?,updated_at=? WHERE supplier_id=?')
       .bind(body.authorized?1:0,t,id));
   }
   await env.DB.batch(actions);
   return json({ok:true,id,displayName,phoneConfigured:!!(phone||current.phone_e164),
     phoneEnding:String(phone||current.phone_e164||'').slice(-4),authorized:body.authorized});
 }
 if(url.pathname==='/api/admin/supplier-delete'&&request.method==='POST'){
   if(Number(request.headers.get('content-length')||0)>900)return clientError('Requisição muito grande.',413);
   const body=await request.json().catch(()=>null);
   const id=String(body?.id||'').trim().toLowerCase();
   if(!supplierIdValid(id)||body?.confirmId!==id)return clientError('Confirme o ID exato antes de excluir.');
   const supplier=await env.DB.prepare('SELECT id,display_name FROM supplier_directory WHERE id=?').bind(id).first();
   if(!supplier)return clientError('Fornecedor não encontrado. Atualize a página.',404);
   const active=await env.DB.prepare(
     "SELECT COUNT(*) AS total FROM supplier_dispatch d JOIN orders o ON o.id=d.order_id WHERE d.supplier_id=? AND o.status IN ('paid_supplier_pending','supplier_preparing') AND d.state NOT IN ('supplier_unavailable','all_unavailable')"
   ).bind(id).first();
   if(Number(active?.total||0)>0)
     return clientError('Este fornecedor possui um pedido em andamento. Finalize ou revise o pedido antes de excluí-lo.',409);
   // Exclua somente cadastro e vínculos de configuração. Pedidos, tentativas e histórico não são apagados.
   await env.DB.batch([
     env.DB.prepare('DELETE FROM supplier_product_map WHERE supplier_id=?').bind(id),
     env.DB.prepare('DELETE FROM supplier_priority WHERE supplier_id=?').bind(id),
     env.DB.prepare('DELETE FROM supplier_contacts WHERE supplier_id=?').bind(id),
     env.DB.prepare('DELETE FROM supplier_directory WHERE id=?').bind(id)
   ]);
   return json({ok:true,deletedId:id});
 }
 if(url.pathname==='/api/admin/supplier-priority'&&request.method==='POST'){
   if(Number(request.headers.get('content-length')||0)>1200)return clientError('Requisição muito grande.',413);
   const body=await request.json().catch(()=>null);
   const ids=body?.ids;
   if(!Array.isArray(ids)||ids.length<1||ids.length>5||ids.some(id=>!supplierIdValid(id))||new Set(ids).size!==ids.length)
     return clientError('Lista de prioridade inválida.');
   const current=await env.DB.prepare('SELECT id FROM supplier_directory ORDER BY created_at,id').all();
   const existing=(current.results||[]).map(x=>x.id);
   if(existing.length!==ids.length||existing.some(id=>!ids.includes(id)))return clientError('A lista deve incluir exatamente os fornecedores cadastrados.',409);
   const now=new Date().toISOString();
   await env.DB.batch(ids.map((id,i)=>env.DB.prepare(
     'INSERT INTO supplier_priority(supplier_id,rank,updated_at) VALUES(?,?,?) ON CONFLICT(supplier_id) DO UPDATE SET rank=excluded.rank,updated_at=excluded.updated_at'
   ).bind(id,i+1,now)));
   return json({ok:true,ids});
 }
 if(url.pathname==='/api/admin/supplier-contact'&&request.method==='POST'){
   if(Number(request.headers.get('content-length')||0)>1200)return clientError('Requisição muito grande.',413);
   const body=await request.json().catch(()=>null);
   const id=String(body?.id||'').trim().toLowerCase();
   const phone=String(body?.phone||'').replace(/\D/g,'');
   if(!supplierIdValid(id)||!(/^[1-9]\d{7,14}$/.test(phone)))
     return clientError('Informe ID e número de WhatsApp com DDI, de 8 a 15 dígitos.');
   const exists=await env.DB.prepare('SELECT id FROM supplier_directory WHERE id=?').bind(id).first();
   if(!exists)return clientError('Cadastre primeiro o nome do fornecedor.',404);
   const authorized=body.authorized===true?1:0;
   await env.DB.prepare(
     'INSERT INTO supplier_contacts(supplier_id,phone_e164,authorized,updated_at) VALUES(?,?,?,?) ON CONFLICT(supplier_id) DO UPDATE SET phone_e164=excluded.phone_e164,authorized=excluded.authorized,updated_at=excluded.updated_at'
   ).bind(id,phone,authorized,new Date().toISOString()).run();
   return json({ok:true,id,phoneEnding:phone.slice(-4),phoneConfigured:true,authorized:authorized===1});
 }
 if(request.method==='GET'&&url.pathname==='/api/admin/supplier-preview'){
  const orderId=url.searchParams.get('orderId')||'';
  if(!/^[a-f0-9-]{36}$/i.test(orderId))return clientError('ID do pedido inválido.');
  const order=await env.DB.prepare('SELECT id,status,items_json FROM orders WHERE id=?').bind(orderId).first();
  if(!order)return clientError('Pedido não encontrado.',404);
  const candidates=await loadSupplierCandidates(env);
  const preview=previewSupplierOrder(env,order,candidates);
  let directory;
  try{
    directory=await env.DB.prepare('SELECT d.id,d.display_name FROM supplier_directory d LEFT JOIN supplier_priority p ON p.supplier_id=d.id ORDER BY CASE WHEN p.rank IS NULL THEN 1 ELSE 0 END,p.rank,d.created_at,d.id').all();
  }catch(error){
    if(!/no such table:\s*supplier_priority/i.test(String(error?.message||'')))throw error;
    directory=await env.DB.prepare('SELECT id,display_name FROM supplier_directory ORDER BY created_at,id').all();
  }
  const attempts=await env.DB.prepare('SELECT supplier_id,state,updated_at FROM supplier_attempts WHERE order_id=? ORDER BY created_at').bind(order.id).all();
  const blocked=new Set((attempts.results||[]).filter(a=>a.state==='unavailable').map(a=>a.supplier_id));
  return json({...preview,sharedCatalog:true,registeredSuppliers:directory.results||[],stockAttempts:attempts.results||[],nextSupplierId:preview.supplierCandidates.find(s=>!blocked.has(s.id))?.id||null});
 }
 if(request.method==='GET'&&url.pathname==='/api/admin/orders'){
  const data=await env.DB.prepare('SELECT o.id,o.created_at,o.status,o.name,o.email,o.phone,o.city,o.state,o.items_json,o.subtotal,o.shipping,o.total,j.status AS supplier_status,j.updated_at AS supplier_updated_at,d.supplier_id,d.state AS dispatch_state,d.sent_at AS sent_to_supplier_at,d.responded_at AS supplier_replied_at,d.last_error AS supplier_error,n.state AS buyer_notification_status FROM orders o LEFT JOIN supplier_jobs j ON j.order_id=o.id LEFT JOIN supplier_dispatch d ON d.order_id=o.id LEFT JOIN buyer_notifications n ON n.order_id=o.id ORDER BY o.created_at DESC LIMIT 75').all();
  return json({orders:data.results||[]});
 }
 if(request.method==='POST'&&url.pathname==='/api/admin/supplier-status'){
  const body=await request.json().catch(()=>null);
  const allowed=['requires_supplier_routing','supplier_contacted','supplier_confirmed','supplier_payment_pending','supplier_paid','manual_review','overdue_24h'];
  if(!body||!allowed.includes(body.status)||typeof body.orderId!=='string')return clientError('Ação inválida.');
  const order=await env.DB.prepare('SELECT id,status,phone FROM orders WHERE id=?').bind(body.orderId).first();
  if(!order||!['paid_supplier_pending','supplier_preparing'].includes(order.status))return clientError('Pedido não elegível.',409);
  await env.DB.prepare('UPDATE supplier_jobs SET status=?,updated_at=? WHERE order_id=?').bind(body.status,new Date().toISOString(),order.id).run();
  if(body.status==='supplier_confirmed'&&order.status==='paid_supplier_pending'){
    await env.DB.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?').bind('supplier_preparing',new Date().toISOString(),order.id).run();
    if(ctx&&env.WA_AUTOMATION_ENABLED==='true'&&env.ASAAS_SANDBOX!=='true'&&env.BUYER_WA_TEMPLATE)ctx.waitUntil(sendApprovedTemplate(env,'55'+unaccent(order.phone),env.BUYER_WA_TEMPLATE,[order.id.slice(0,8)]).catch(()=>{}));
  }
  return json({ok:true});
 }
 return clientError('Endpoint administrativo não encontrado.',404);
}
// Optional WhatsApp Cloud API - approved templates only for conversation initiation.
async function sendApprovedTemplate(env,to,template,args=[]){if(!env.WA_TOKEN||!env.WA_PHONE_NUMBER_ID)return false;const components=args.length?[{type:'body',parameters:args.map(text=>({type:'text',text:String(text)}))}]:[];const data={messaging_product:'whatsapp',to,type:'template',template:{name:template,language:{code:'pt_BR'},components}};const r=await fetch(`https://graph.facebook.com/v22.0/${env.WA_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{authorization:'Bearer '+env.WA_TOKEN,'content-type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw Error('WhatsApp failed');return true}
async function validateMetaSignature(req,env,raw){if(!env.WA_APP_SECRET)return false;const signature=req.headers.get('x-hub-signature-256');if(!signature?.startsWith('sha256='))return false;const cryptoKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.WA_APP_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const result=await crypto.subtle.sign('HMAC',cryptoKey,new TextEncoder().encode(raw));const computed='sha256='+[...new Uint8Array(result)].map(b=>b.toString(16).padStart(2,'0')).join('');if(signature.length!==computed.length)return false;let difference=0;for(let i=0;i<signature.length;i++)difference|=signature.charCodeAt(i)^computed.charCodeAt(i);return difference===0}
async function whatsappInbound(req,env,ctx){
 const raw=await req.text();
 if(!(await validateMetaSignature(req,env,raw)))return clientError('Assinatura inválida.',403);
 const payload=JSON.parse(raw);
 const messages=payload.entry?.flatMap(e=>e.changes||[]).flatMap(c=>c.value?.messages||[])||[];
 for(const m of messages)await handleSupplierInbound(env,m,ctx);
 return json({ok:true});
}
export default {async fetch(request,env,ctx){const url=new URL(request.url);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});try{
 if(url.pathname.startsWith('/api/admin/'))return await adminApi(request,env,ctx);
 if(url.pathname==='/api/checkout/config'&&request.method==='GET')return checkoutConfig(env);
 if(url.pathname==='/api/orders'&&request.method==='POST')return await createOrder(request,env);
 if(url.pathname==='/api/webhooks/asaas'&&request.method==='POST')return await paymentWebhook(request,env,ctx);
 if(url.pathname==='/api/webhooks/whatsapp'&&request.method==='GET'){const q=url.searchParams;if(q.get('hub.mode')==='subscribe'&&q.get('hub.verify_token')===env.WA_VERIFY_TOKEN)return new Response(q.get('hub.challenge')||'');return clientError('Token inválido.',403)}
 if(url.pathname==='/api/webhooks/whatsapp'&&request.method==='POST')return whatsappInbound(request,env,ctx);
 if(url.pathname==='/api/health')return json({ok:true,service:'streetball-store',checkoutReady:checkoutReady(env),sandbox:env.ASAAS_SANDBOX==='true',supplierPaymentAutomated:false});
 if(url.pathname.startsWith('/api/'))return clientError('Endpoint não encontrado.',404);
 if(env.ASSETS)return env.ASSETS.fetch(request);return new Response('Assets não configurados.',{status:503});
}catch(err){return clientError('Serviço indisponível. Tente novamente.',500)}} ,
 async scheduled(event,env){if(!env.DB)return;await monitorSupplierSLA(env);await retryPendingRoutes(env);}
};
