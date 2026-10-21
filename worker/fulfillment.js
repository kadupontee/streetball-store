/** Fluxo seguro de fulfillment: fotos, WhatsApp oficial, fallback de 12h e prazo total de 72h.
 * Sem credenciais/consentimento não envia mensagens. Pix para fornecedor exige aprovação humana.
 */
const digits=v=>String(v||'').replace(/\D/g,'');
export const normalizeWaPhone=v=>{const p=digits(v);return /^[1-9]\d{7,14}$/.test(p)?p:'';};
const now=()=>new Date().toISOString();
export const PER_SUPPLIER_TIMEOUT_MS=12*60*60*1000;
export const ORDER_SEARCH_DEADLINE_MS=72*60*60*1000;
export const isSearchExpired=(startedAt,at=Date.now())=>!!startedAt&&Number.isFinite(Date.parse(startedAt))&&at-Date.parse(startedAt)>=ORDER_SEARCH_DEADLINE_MS;
const jsonBody=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const trim=(s,n=350)=>String(s??'').trim().slice(0,n);
function suppliers(env){
 let list=[];
 try{list=JSON.parse(env.SUPPLIERS_JSON||'[]')}catch{return []}
 if(!Array.isArray(list))return [];
 return list.slice(0,5).filter(p=>p&&/^[a-z0-9_-]{2,40}$/i.test(p.id)&&!!normalizeWaPhone(p.phone)&&/^[a-z0-9_]{2,100}$/i.test(p.template||env.SUPPLIER_WA_TEMPLATE||'')).map(p=>({...p,phone:digits(p.phone),template:p.template||env.SUPPLIER_WA_TEMPLATE}));
}
/**
 * A fila cadastrada no D1 tem prioridade sobre a lista legada em secrets.
 * Só contatos explicitamente autorizados são elegíveis para o WhatsApp.
 * Nenhum número é devolvido ao navegador; prévia fornece apenas 4 dígitos.
 */
export async function loadSupplierCandidates(env){
 if(env.DB){
  try{
   let data;
   try{
     data=await env.DB.prepare(
       'SELECT d.id,c.phone_e164,c.authorized FROM supplier_directory d LEFT JOIN supplier_contacts c ON c.supplier_id=d.id LEFT JOIN supplier_priority p ON p.supplier_id=d.id ORDER BY CASE WHEN p.rank IS NULL THEN 1 ELSE 0 END,p.rank,d.created_at,d.id'
     ).all();
   }catch(error){
     if(!/no such table:\s*supplier_priority/i.test(String(error?.message||'')))throw error;
     data=await env.DB.prepare(
       'SELECT d.id,c.phone_e164,c.authorized FROM supplier_directory d LEFT JOIN supplier_contacts c ON c.supplier_id=d.id ORDER BY d.created_at,d.id'
     ).all();
   }
   const rows=data.results||[];
   if(rows.length)return rows.filter(r=>r.authorized===1&&normalizeWaPhone(r.phone_e164)).map(r=>({
     id:r.id,phone:normalizeWaPhone(r.phone_e164),
     template:env.SUPPLIER_WA_TEMPLATE||'',
     mediaTemplate:env.SUPPLIER_WA_TEMPLATE_MEDIA||''
   }));
  }catch(err){
   // Nunca escolher um fornecedor legado por engano se o cadastro D1 estiver indisponível.
   console.error('Unable to load registered supplier contacts',err?.message);
   return [];
  }
 }
 return suppliers(env);
}
function phoneBR(raw){
 let p=digits(raw);
 if(p.length===10||p.length===11)p='55'+p;
 return /^55\d{10,11}$/.test(p)?p:'';
}
function imageLink(raw,env){
 const value=String(raw||'');
 if(/^\/images\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(value)&&!value.includes('..')&&/^https:\/\//.test(env.STORE_PUBLIC_URL||'')){
   return String(env.STORE_PUBLIC_URL).replace(/\/+$/,'')+value;
 }
 if(/^https:\/\/photo\.yupoo\.com\/james66jersey\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(value))return value;
 return '';
}
/**
 * Prévia administrativa de encaminhamento. Não gera mensagens, gravações ou chamadas de rede.
 * Nenhum dado de endereço/CPF do comprador é incluído aqui.
 */
export function previewSupplierOrder(env,order,candidateOverride=null){
 const items=JSON.parse(order.items_json||'[]');
 const candidates=candidateOverride||suppliers(env);
 const supplier=candidates[0]||null;
 const firstPhoto=imageLink(items[0]?.image,env);
 const photoTemplate=env.SUPPLIER_WA_TEMPLATE_MEDIA||supplier?.mediaTemplate||'';
 const checks={
   sandbox:env.ASAAS_SANDBOX==='true',
   whatsappAutomationDisabled:env.WA_AUTOMATION_ENABLED!=='true',
   supplierConfigured:!!supplier,
   firstPhotoAvailable:!!firstPhoto,
   photoTemplateConfigured:!!photoTemplate,
   waTokenConfigured:!!env.WA_TOKEN,
   waPhoneIdConfigured:!!env.WA_PHONE_NUMBER_ID
 };
 return {
   orderId:order.id,
   status:order.status,
   sharedCatalog:true,
   supplierCandidates:candidates.map((p,i)=>({id:p.id,priority:i+1,phoneEnding:p.phone.slice(-4)})),
   supplier:supplier?{id:supplier.id,phoneEnding:supplier.phone.slice(-4)}:null,
   firstPhotoUrl:firstPhoto||null,
   photoTemplate:photoTemplate||null,
   messageSummary:messageSummary(items),
   items:items.map(it=>({
     title:trim(it.title,100),size:trim(it.size,15),qty:Number(it.qty)||0,
     patch:it.patch===true,personalize:it.personalize===true,
     customName:trim(it.customName,14),customNumber:trim(it.customNumber,3)
   })),
   checks,
   readyForAutomaticSending:checks.supplierConfigured&&checks.firstPhotoAvailable&&
     checks.photoTemplateConfigured&&checks.waTokenConfigured&&
     checks.waPhoneIdConfigured&&!checks.whatsappAutomationDisabled&&!checks.sandbox
 };
}
async function sendWa(env,to,message){
 if(env.ASAAS_SANDBOX==='true'||env.WA_AUTOMATION_ENABLED!=='true'||!env.WA_TOKEN||!env.WA_PHONE_NUMBER_ID)throw Error('WhatsApp não habilitado ou sem credenciais');
 if(!normalizeWaPhone(to))throw Error('Número WhatsApp inválido');
 const version=/^v\d+\.\d+$/.test(env.WA_GRAPH_VERSION||'')?env.WA_GRAPH_VERSION:'v22.0';
 const res=await fetch('https://graph.facebook.com/'+version+'/'+env.WA_PHONE_NUMBER_ID+'/messages',{
   method:'POST',headers:{'authorization':'Bearer '+env.WA_TOKEN,'content-type':'application/json'},
   body:JSON.stringify({messaging_product:'whatsapp',to:normalizeWaPhone(to),...message})
 });
 const body=await res.json().catch(()=>({}));
 if(!res.ok||!body.messages?.[0]?.id)throw Error('WhatsApp API HTTP '+res.status+': '+trim(body.error?.message||'falha de envio',100));
 return body.messages[0].id;
}
function sendTemplate(env,to,name,args,headerImage){
 if(!/^[a-z0-9_]{2,100}$/i.test(String(name||'')))throw Error('Template WhatsApp não configurado');
 const components=[{type:'body',parameters:args.map(t=>({type:'text',text:trim(t,350)}))}];
 if(headerImage)components.unshift({type:'header',parameters:[{type:'image',image:{link:headerImage}}]});
 return sendWa(env,to,{type:'template',template:{name,language:{code:'pt_BR'},components}});
}
function getSupplier(env){
 // Os cinco fornecedores compartilham o catálogo. A prioridade segue a lista de contatos.
 return suppliers(env)[0]||null;
}
export function classifyStockReply(body,contextId=''){
 const raw=trim(body,400).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
 const command=raw.match(/^(SEM[_ -]?ESTOQUE|INDISPONIVEL|ESGOTADO|DISPONIVEL|TEMOS|CONFIRMAR|PREPARANDO|DETALHES)\s+([A-F0-9]{8})$/);
 if(command){
  const word=command[1].replace(/[_ -]/g,'');
  return {kind:['SEMESTOQUE','INDISPONIVEL','ESGOTADO'].includes(word)?'unavailable':(['DISPONIVEL','TEMOS'].includes(word)?'available':word.toLowerCase()),orderShort:command[2].toLowerCase(),byContext:false};
 }
 // Respostas ambíguas só acionam fallback quando o WhatsApp vincula a resposta
 // à mensagem exata da consulta do pedido. Sem contexto, nenhuma ação é tomada.
 if(contextId){
  if(/^(?:SEM ESTOQUE|NAO TENHO|NAO TEMOS|NAO TEM|ESGOTADO|ESGOTOU|INDISPONIVEL|ESTA EM FALTA)[.! ]*$/.test(raw))return {kind:'unavailable',orderShort:null,byContext:true};
  if(/^(?:DISPONIVEL|TENHO EM ESTOQUE|TEMOS EM ESTOQUE|TEMOS DISPONIVEL|TEMOS|DISPONIVEL SIM)[.! ]*$/.test(raw))return {kind:'available',orderShort:null,byContext:true};
  if(raw&&/^[\p{L}\p{N}\s.,!?;:()\/_-]{1,400}$/u.test(raw))return {kind:'ambiguous',orderShort:null,byContext:true};
 }
 return null;
}
function messageSummary(items){
 return trim(items.map(i=>trim(i.title,58)+' '+trim(i.size,12)+' x'+i.qty+(i.personalize?' (personalizado)':'')).join(' | '),330);
}
export async function routePaidOrder(env,orderId){
 if(!env.DB)return false;
 const order=await env.DB.prepare("SELECT id,status,items_json FROM orders WHERE id=?").bind(orderId).first();
 if(!order||order.status!=='paid_supplier_pending')return false;
 const items=JSON.parse(order.items_json||'[]');
 const candidates=await loadSupplierCandidates(env);
 const excluded=await env.DB.prepare("SELECT supplier_id FROM supplier_attempts WHERE order_id=? AND state IN ('unavailable','ambiguous','timed_out')").bind(order.id).all();
 const exhausted=new Set((excluded.results||[]).map(x=>x.supplier_id));
 const supplier=candidates.find(c=>!exhausted.has(c.id))||null;
 const firstPhoto=imageLink(items[0]?.image,env);
 const t=now();
 await env.DB.prepare("INSERT OR IGNORE INTO supplier_dispatch(order_id,supplier_id,supplier_phone,state,created_at,updated_at) VALUES(?,?,?,?,?,?)")
 .bind(order.id,'','','pending',t,t).run();
 const started=await env.DB.prepare('SELECT created_at FROM supplier_dispatch WHERE order_id=?').bind(order.id).first();
 if(isSearchExpired(started?.created_at))return false; // Processamento e desculpas são tratados pelo agendador.
 if(!supplier){
  const state=candidates.length?'waiting_deadline':'needs_configuration';
  await env.DB.prepare("UPDATE supplier_dispatch SET state=?,supplier_id='',supplier_phone='',updated_at=? WHERE order_id=? AND state IN ('pending','needs_configuration')")
    .bind(state,now(),order.id).run();
  await env.DB.prepare("UPDATE supplier_jobs SET status=?,updated_at=? WHERE order_id=?").bind(candidates.length?'awaiting_stock_deadline':'manual_review',now(),order.id).run();
  return false;
 }
 const photoTemplate=env.SUPPLIER_WA_TEMPLATE_MEDIA||supplier.mediaTemplate;
 // Sandbox nunca envia automaticamente a fornecedores reais, mesmo se alguém ativar WA_AUTOMATION_ENABLED.
 if(!env.STORE_PUBLIC_URL||!firstPhoto||!photoTemplate||
    env.WA_AUTOMATION_ENABLED!=='true'||env.ASAAS_SANDBOX==='true'){
  await env.DB.prepare("UPDATE supplier_dispatch SET state='needs_configuration',supplier_id=?,supplier_phone=?,updated_at=? WHERE order_id=? AND state IN ('pending','needs_configuration')")
    .bind(supplier.id,supplier.phone,now(),order.id).run();
  await env.DB.prepare("UPDATE supplier_jobs SET status='manual_review',updated_at=? WHERE order_id=? AND status='requires_supplier_routing'").bind(now(),order.id).run();
  return false;
 }
 const lock=await env.DB.prepare("UPDATE supplier_dispatch SET state='sending',supplier_id=?,supplier_phone=?,attempts=attempts+1,updated_at=?,last_error=NULL WHERE order_id=? AND state IN ('pending','needs_configuration')")
  .bind(supplier.id,supplier.phone,now(),order.id).run();
 if(!lock.meta?.changes)return false;
 try{
  const messageId=await sendTemplate(env,supplier.phone,photoTemplate,[order.id.slice(0,8),messageSummary(items)],firstPhoto);
  await env.DB.prepare("INSERT INTO supplier_attempts(order_id,supplier_id,state,message_id,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(order_id,supplier_id) DO UPDATE SET state=excluded.state,message_id=excluded.message_id,updated_at=excluded.updated_at")
   .bind(order.id,supplier.id,'awaiting_reply',messageId,now(),now()).run();
  await env.DB.prepare("UPDATE supplier_dispatch SET state='awaiting_reply',message_id=?,sent_at=?,details_sent_at=NULL,responded_at=NULL,updated_at=? WHERE order_id=? AND state='sending'")
   .bind(messageId,now(),now(),order.id).run();
  await env.DB.prepare("UPDATE supplier_jobs SET status='supplier_contacted',updated_at=? WHERE order_id=?").bind(now(),order.id).run();
  return true;
 }catch(err){
  await env.DB.prepare("UPDATE supplier_dispatch SET state='needs_review',last_error=?,updated_at=? WHERE order_id=?")
   .bind(trim(err?.message,250),now(),order.id).run();
  await env.DB.prepare("UPDATE supplier_jobs SET status='manual_review',updated_at=? WHERE order_id=?").bind(now(),order.id).run();
  return false;
 }
}
async function sendStockDetails(env,order,to){
 // Não compartilhar nome, endereço ou telefone do comprador antes da confirmação de estoque.
 const items=JSON.parse(order.items_json||'[]');
 const lines=items.map((it,i)=>(i+1)+'. '+trim(it.title,100)+' | '+trim(it.size,12)+' | '+it.qty+' un'+(it.personalize?' | personalizado':'')+(it.patch?' | patch':'')).join('\n');
 await sendWa(env,to,{type:'text',text:{body:trim('Consulta de disponibilidade '+order.id.slice(0,8)+'\n'+lines,3900)}});
 for(const it of items){
  const photo=imageLink(it.image,env);
  if(!photo)throw Error('Foto não disponível na consulta '+trim(it.id,35));
  await sendWa(env,to,{type:'image',image:{link:photo,caption:trim(it.title,130)+' / '+trim(it.size,12)+' x'+it.qty}});
 }
}
async function sendOrderDetails(env,order,dispatch){
 const items=JSON.parse(order.items_json||'[]');
 const header='Pedido '+order.id.slice(0,8)+' - '+trim(order.name,80)+'\nEntrega: '+trim(order.address,130)+', '+trim(order.city,80)+'/'+trim(order.state,2)+' - CEP '+digits(order.zip)+'\nContato do destinatário: '+phoneBR(order.phone);
 const descriptions=items.map((it,i)=>(i+1)+'. '+trim(it.title,100)+' | '+trim(it.size,12)+' | '+it.qty+' un'+(it.personalize?' | nome '+trim(it.customName,14)+' | nº '+trim(it.customNumber,3):'')+(it.patch?' | patch':'')).join('\n');
 await sendWa(env,dispatch.supplier_phone,{type:'text',text:{body:trim(header+'\n'+descriptions,3900)}});
 for(const item of items){
   const link=imageLink(item.image,env);
   if(!link)throw Error('Foto original indisponível no pedido '+trim(item.id,35));
   await sendWa(env,dispatch.supplier_phone,{type:'image',image:{link,caption:trim(item.title,130)+' / '+trim(item.size,12)+' x'+item.qty}});
 }
 await env.DB.prepare("UPDATE supplier_dispatch SET details_sent_at=?,updated_at=? WHERE order_id=?").bind(now(),now(),order.id).run();
}
async function sendBuyerUpdate(env,order){
 if(!env.BUYER_WA_TEMPLATE||env.WA_AUTOMATION_ENABLED!=='true'||env.ASAAS_SANDBOX==='true')return;
 await env.DB.prepare("INSERT OR IGNORE INTO buyer_notifications(order_id,state,created_at,updated_at) VALUES(?,?,?,?)").bind(order.id,'pending',now(),now()).run();
 const claim=await env.DB.prepare("UPDATE buyer_notifications SET state='sending',updated_at=? WHERE order_id=? AND state='pending'").bind(now(),order.id).run();
 if(!claim.meta?.changes)return;
 try{
   const msg=await sendTemplate(env,phoneBR(order.phone),env.BUYER_WA_TEMPLATE,[order.id.slice(0,8)]);
   await env.DB.prepare("UPDATE buyer_notifications SET state='sent',message_id=?,updated_at=? WHERE order_id=?").bind(msg,now(),order.id).run();
 }catch(err){
   await env.DB.prepare("UPDATE buyer_notifications SET state='needs_review',error=?,updated_at=? WHERE order_id=?").bind(trim(err?.message,200),now(),order.id).run();
 }
}
// Marca uma tentativa como inconclusiva ou indisponível, liberando o próximo contato.
async function advanceSupplier(env,order,from,state,responseText){
 const moved=await env.DB.prepare(
  "UPDATE supplier_dispatch SET state='supplier_skipped',responded_at=?,updated_at=?,last_error=? WHERE order_id=? AND supplier_phone=? AND state IN ('awaiting_reply','overdue_24h')"
 ).bind(now(),now(),state,order.id,from).run();
 if(!moved.meta?.changes)return false;
 await env.DB.prepare(
  "INSERT INTO supplier_attempts(order_id,supplier_id,state,last_response,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(order_id,supplier_id) DO UPDATE SET state=excluded.state,last_response=excluded.last_response,updated_at=excluded.updated_at"
 ).bind(order.id,order.supplier_id,state,trim(responseText,160),now(),now()).run();
 await env.DB.prepare("UPDATE supplier_jobs SET status='requires_supplier_routing',updated_at=? WHERE order_id=?").bind(now(),order.id).run();
 await env.DB.prepare("UPDATE supplier_dispatch SET state='pending',supplier_id='',supplier_phone='',message_id=NULL,sent_at=NULL,responded_at=NULL,details_sent_at=NULL,updated_at=? WHERE order_id=? AND state='supplier_skipped'")
  .bind(now(),order.id).run();
 await routePaidOrder(env,order.id);
 return true;
}
export async function handleSupplierInbound(env,message,ctx){
 if(!env.DB||!message?.id||env.WA_AUTOMATION_ENABLED!=='true'||env.ASAAS_SANDBOX==='true')return;
 const from=normalizeWaPhone(message.from);
 const response=classifyStockReply(message.text?.body,message.context?.id);
 if(!from||!response)return;
 const duplicate=await env.DB.prepare("SELECT id FROM wa_message_events WHERE id=?").bind(message.id).first();
 if(duplicate)return;
 const query=response.byContext
   ?"SELECT o.*,d.supplier_phone,d.supplier_id,d.state AS dispatch_state,d.details_sent_at FROM orders o JOIN supplier_dispatch d ON d.order_id=o.id WHERE d.supplier_phone=? AND d.message_id=? LIMIT 2"
   :"SELECT o.*,d.supplier_phone,d.supplier_id,d.state AS dispatch_state,d.details_sent_at FROM orders o JOIN supplier_dispatch d ON d.order_id=o.id WHERE d.supplier_phone=? AND o.id LIKE ? LIMIT 2";
 const arg=response.byContext?message.context.id:response.orderShort+'%';
 const results=await env.DB.prepare(query).bind(from,arg).all();
 if(results.results?.length!==1)return;
 const order=results.results[0];
 if(order.status!=='paid_supplier_pending'||!['awaiting_reply','details_sent','overdue_24h'].includes(order.dispatch_state))return;
 await env.DB.prepare("INSERT OR IGNORE INTO wa_message_events(id,order_id,received_at) VALUES(?,?,?)").bind(message.id,order.id,now()).run();
 if(response.kind==='unavailable'||response.kind==='ambiguous'){
  const next=advanceSupplier(env,order,from,response.kind, message.text?.body||'');
  if(ctx?.waitUntil)ctx.waitUntil(next);else await next;
  return;
 }
 if(response.kind==='detalhes'){
  try{await sendStockDetails(env,order,from);}
  catch(err){
   await env.DB.prepare("UPDATE supplier_dispatch SET state='needs_review',last_error=?,updated_at=? WHERE order_id=?")
    .bind(trim(err?.message,250),now(),order.id).run();
  }
  return;
 }
 if(response.kind==='available'&&!order.details_sent_at){
  try{
   await sendOrderDetails(env,order,{supplier_phone:from});
   await env.DB.prepare("UPDATE supplier_dispatch SET state='details_sent',responded_at=?,updated_at=? WHERE order_id=? AND state IN ('awaiting_reply','overdue_24h','details_sent')")
    .bind(now(),now(),order.id).run();
   await env.DB.prepare("UPDATE supplier_attempts SET state='available',updated_at=? WHERE order_id=? AND supplier_id=?").bind(now(),order.id,order.supplier_id).run();
  }catch(err){
   await env.DB.prepare("UPDATE supplier_dispatch SET state='needs_review',last_error=?,updated_at=? WHERE order_id=?")
    .bind(trim(err?.message,250),now(),order.id).run();
  }
  return;
 }
 if((response.kind==='preparando'||response.kind==='confirmar')&&order.details_sent_at){
  const updated=await env.DB.prepare("UPDATE supplier_dispatch SET state='confirmed',responded_at=?,updated_at=? WHERE order_id=? AND state IN ('awaiting_reply','details_sent','overdue_24h')")
    .bind(now(),now(),order.id).run();
  if(!updated.meta?.changes)return;
  await env.DB.prepare("UPDATE supplier_attempts SET state='confirmed',updated_at=? WHERE order_id=? AND supplier_id=?").bind(now(),order.id,order.supplier_id).run();
  await env.DB.prepare("UPDATE supplier_jobs SET status='supplier_confirmed',updated_at=? WHERE order_id=?").bind(now(),order.id).run();
  await env.DB.prepare("UPDATE orders SET status='supplier_preparing',updated_at=? WHERE id=? AND status='paid_supplier_pending'")
    .bind(now(),order.id).run();
  const send=sendBuyerUpdate(env,order);
  if(ctx?.waitUntil)ctx.waitUntil(send);else await send;
 }
}
const apologyDraft=id=>'Pedimos desculpas pela demora na confirmação de disponibilidade do pedido '+id.slice(0,8)+'. Nossa equipe está verificando as opções e entrará em contato com uma atualização. Agradecemos a compreensão.';
export {apologyDraft};
async function registerBuyerDelay(env,order){
 const t=now();
 if(!env.BUYER_DELAY_WA_TEMPLATE){
  await env.DB.prepare("INSERT OR IGNORE INTO buyer_delay_notifications(order_id,state,error,created_at,updated_at) VALUES(?,?,?,?,?)")
   .bind(order.id,'needs_manual_contact','Template de desculpas não configurado',t,t).run();
  return;
 }
 const optin=await env.DB.prepare('SELECT order_id FROM buyer_message_optin WHERE order_id=?').bind(order.id).first();
 if(!optin){
  await env.DB.prepare("INSERT OR IGNORE INTO buyer_delay_notifications(order_id,state,error,created_at,updated_at) VALUES(?,?,?,?,?)")
   .bind(order.id,'needs_manual_contact','Cliente não autorizou mensagens via WhatsApp',t,t).run();
  return;
 }
 await env.DB.prepare("INSERT OR IGNORE INTO buyer_delay_notifications(order_id,state,created_at,updated_at) VALUES(?,?,?,?)")
  .bind(order.id,'pending',t,t).run();
 const lock=await env.DB.prepare("UPDATE buyer_delay_notifications SET state='sending',updated_at=? WHERE order_id=? AND state='pending'").bind(now(),order.id).run();
 if(!lock.meta?.changes)return;
 try{
  const id=await sendTemplate(env,phoneBR(order.phone),env.BUYER_DELAY_WA_TEMPLATE,[order.id.slice(0,8)]);
  await env.DB.prepare("UPDATE buyer_delay_notifications SET state='sent',message_id=?,updated_at=? WHERE order_id=? AND state='sending'")
   .bind(id,now(),order.id).run();
 }catch(error){
  // Não tentar reenviar automaticamente quando a primeira tentativa puder ter chegado.
  await env.DB.prepare("UPDATE buyer_delay_notifications SET state='needs_manual_contact',error=?,updated_at=? WHERE order_id=? AND state='sending'")
   .bind(trim(error?.message,200),now(),order.id).run();
 }
}
export async function monitorSupplierSLA(env){
 // Nenhum evento simulado aciona busca real ou comunicação com compradores.
 if(!env.DB||env.WA_AUTOMATION_ENABLED!=='true'||env.ASAAS_SANDBOX==='true')return;
 const t=Date.now();
 const deadline=new Date(t-ORDER_SEARCH_DEADLINE_MS).toISOString();
 const perSupplier=new Date(t-PER_SUPPLIER_TIMEOUT_MS).toISOString();
 // Prazo global: 72 horas da abertura da busca, mesmo se a fila se esgotar antes.
 const overdue=await env.DB.prepare(
  "SELECT d.order_id,o.phone FROM supplier_dispatch d JOIN orders o ON o.id=d.order_id WHERE o.status='paid_supplier_pending' AND d.created_at<=? AND d.state NOT IN ('confirmed','deadline_review','needs_configuration','needs_review') ORDER BY d.created_at LIMIT 100"
 ).bind(deadline).all();
 for(const record of overdue.results||[]){
  const claim=await env.DB.prepare(
   "UPDATE supplier_dispatch SET state='deadline_review',updated_at=?,last_error='72 horas sem confirmação de fornecedor' WHERE order_id=? AND created_at<=? AND state NOT IN ('confirmed','deadline_review','needs_configuration','needs_review')"
  ).bind(now(),record.order_id,deadline).run();
  if(!claim.meta?.changes)continue;
  await env.DB.prepare("UPDATE supplier_jobs SET status='manual_review',updated_at=? WHERE order_id=?").bind(now(),record.order_id).run();
  await registerBuyerDelay(env,{id:record.order_id,phone:record.phone});
 }
 // Prazo individual de 12 horas, para dar chance aos cinco fornecedores em até 72 horas.
 const pending=await env.DB.prepare(
  "SELECT d.order_id,d.supplier_id,d.supplier_phone,d.sent_at FROM supplier_dispatch d JOIN orders o ON o.id=d.order_id WHERE o.status='paid_supplier_pending' AND d.state='awaiting_reply' AND d.sent_at<=? AND d.created_at>? ORDER BY d.sent_at LIMIT 100"
 ).bind(perSupplier,deadline).all();
 for(const record of pending.results||[]){
  const order={id:record.order_id,supplier_id:record.supplier_id};
  await advanceSupplier(env,order,record.supplier_phone,'timed_out','Sem resposta por 12 horas');
 }
}
export async function retryPendingRoutes(env){
 if(!env.DB)return;
 const pending=await env.DB.prepare("SELECT id FROM orders WHERE status='paid_supplier_pending' AND id NOT IN (SELECT order_id FROM supplier_dispatch WHERE state IN ('sending','awaiting_reply','details_sent','confirmed','overdue_24h','needs_review','waiting_deadline','deadline_review')) ORDER BY updated_at ASC LIMIT 20").all();
 for(const row of pending.results||[])await routePaidOrder(env,row.id);
}
