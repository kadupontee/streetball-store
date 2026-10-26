import {supplierPhotoRequest} from './supplier-order-format.js';
import {classifyStockReply} from './supplier-replies.js';

const now=()=>new Date().toISOString();
const plus=ms=>new Date(Date.now()+ms).toISOString();
const phone=value=>/^\d{8,15}$/.test(String(value||''))?String(value):'';
const jobId=value=>typeof value==='string'&&/^lo_[a-f0-9]{32}_\d{1,2}$/.test(value);
const messageId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{4,180}$/.test(value);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
export const usesLocalWhatsApp=env=>env.WA_TRANSPORT==='local';
export function localOrdersReady(env){
 return !!(env.DB&&env.WA_LOCAL_BRIDGE_TOKEN&&usesLocalWhatsApp(env)&&env.WA_LOCAL_ORDERS_ENABLED==='true'&&
  env.WA_AUTOMATION_ENABLED==='true'&&env.ASAAS_SANDBOX==='false'&&env.PAYMENTS_PRODUCTION_ENABLED==='true'&&
  env.SALES_ENABLED==='true'&&env.CUSTOMER_PAYS_IMPORT_TAXES==='true'&&env.IMPORT_TAX_DISCLOSURE_APPROVED==='true'&&env.IMPORT_COMPLIANCE_APPROVED==='true');
}
export async function recordPaymentEnvironment(env,orderId){
 await env.DB.prepare('INSERT OR IGNORE INTO order_payment_environments(order_id,environment,recorded_at) VALUES(?,?,?)')
  .bind(orderId,env.ASAAS_SANDBOX==='true'?'sandbox':'production',now()).run();
}
export async function recordPaymentReceipt(env,orderId,paymentId){
 await env.DB.prepare('UPDATE order_payment_environments SET payment_id=?,received_at=? WHERE order_id=? AND environment=?')
  .bind(paymentId,now(),orderId,env.ASAAS_SANDBOX==='true'?'sandbox':'production').run();
}
export async function hasProductionReceipt(env,orderId){
 const row=await env.DB.prepare('SELECT p.environment,p.payment_id,p.received_at,o.payment_id AS order_payment_id FROM order_payment_environments p JOIN orders o ON o.id=p.order_id WHERE p.order_id=?').bind(orderId).first();
 return !!(row?.environment==='production'&&row.received_at&&row.payment_id&&row.payment_id===row.order_payment_id);
}
export function imageLink(raw,env){
 const value=String(raw||'');
 if(/^\/images\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(value)&&!value.includes('..')&&/^https:\/\//.test(env.STORE_PUBLIC_URL||''))return String(env.STORE_PUBLIC_URL).replace(/\/+$/,'')+value;
 if(/^https:\/\/photo\.yupoo\.com\/james66jersey\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(value)&&!value.includes('..'))return value;
 return '';
}
function payloadValid(payload,env){
 if(payload?.type==='text')return typeof payload.text?.body==='string'&&payload.text.body.length>0&&payload.text.body.length<=3900;
 if(payload?.type==='image'){
  const link=String(payload.image?.link||'');
  const origin=String(env.STORE_PUBLIC_URL||'').replace(/\/+$/,'');
  const relative=origin&&link.startsWith(origin+'/images/')?link.slice(origin.length):link;
  return !!imageLink(relative,env)&&typeof payload.image?.caption==='string'&&payload.image.caption.length<=3900;
 }
 return false;
}
async function eligible(env,group){
 if(group.preview===1)return true;
 if(!localOrdersReady(env)||!group.order_id)return false;
 const order=await env.DB.prepare('SELECT id,status,phone FROM orders WHERE id=?').bind(group.order_id).first();
 if(!order||!['paid_supplier_pending','supplier_preparing'].includes(order.status))return false;
 if(!await hasProductionReceipt(env,order.id))return false;
 if(['buyer_update','buyer_delay'].includes(group.purpose)){
  const p=String(order.phone||'').replace(/\D/g,'');
  const normalized=(p.length===10||p.length===11)?'55'+p:p;
  if(group.recipient_jid!==normalized+'@s.whatsapp.net')return false;
  const consent=await env.DB.prepare('SELECT order_id FROM buyer_message_optin WHERE order_id=?').bind(order.id).first();
  return !!consent&&(group.purpose==='buyer_update'?order.status==='supplier_preparing':order.status==='paid_supplier_pending');
 }
 if(order.status!=='paid_supplier_pending')return false;
 const d=await env.DB.prepare('SELECT supplier_id,supplier_phone,state,message_id FROM supplier_dispatch WHERE order_id=?').bind(order.id).first();
 if(!d||d.supplier_phone+'@s.whatsapp.net'!==group.recipient_jid)return false;
 const c=await env.DB.prepare('SELECT phone_e164,authorized FROM supplier_contacts WHERE supplier_id=?').bind(d.supplier_id).first();
 if(c?.authorized!==1||c.phone_e164!==d.supplier_phone)return false;
 const states={stock_query:['sending','queued_local'],order_details:['awaiting_reply','overdue_24h','details_queued_local'],stock_details:['awaiting_reply','overdue_24h','details_sent']};
 return (states[group.purpose]||[]).includes(d.state);
}

/** Queue and business tracking commit together; no message is marked sent before acknowledgement. */
export async function enqueueLocalGroup(env,to,messages,{orderId,purpose,preview=false,dedupeKey}={}){
 if(!env.DB||(!preview&&!localOrdersReady(env)))throw Error('Envio local de pedidos ainda não liberado');
 const recipient=preview?String(to):phone(to)+'@s.whatsapp.net';
 if(!/^\d+(?:@s\.whatsapp\.net|@lid)$/.test(recipient)||(!preview&&!phone(to)))throw Error('Destinatário inválido');
 if(!Array.isArray(messages)||!messages.length||messages.length>36||!messages.every(m=>payloadValid(m,env)))throw Error('Mensagem ou foto inválida');
 const group={order_id:orderId||null,purpose,recipient_jid:recipient,preview:preview?1:0};
 if(!preview&&!await eligible(env,group))throw Error('Pedido ou contato não elegível');
 const key=dedupeKey||[orderId,purpose,recipient].join(':');
 const groupId='lg_'+(await hash(key)).slice(0,32),bodyHash=await hash(JSON.stringify(messages));
 const first='lo_'+groupId.slice(3)+'_0',t=now();
 const existing=await env.DB.prepare('SELECT payload_hash FROM wa_local_groups WHERE id=?').bind(groupId).first();
 if(existing&&existing.payload_hash!==bodyHash)throw Error('A consulta já existe com outros dados; requer revisão');
 const statements=[env.DB.prepare('INSERT OR IGNORE INTO wa_local_groups(id,dedupe_key,payload_hash,order_id,purpose,recipient_jid,preview,created_at) VALUES(?,?,?,?,?,?,?,?)')
  .bind(groupId,key,bodyHash,group.order_id,purpose,recipient,group.preview,t)];
 messages.forEach((payload,index)=>statements.push(env.DB.prepare("INSERT OR IGNORE INTO wa_local_outbox(id,group_id,position,payload_json,state,created_at,updated_at) SELECT ?,id,?,?,'queued',?,? FROM wa_local_groups WHERE id=? AND payload_hash=?")
  .bind('lo_'+groupId.slice(3)+'_'+index,index,JSON.stringify(payload),t,t,groupId,bodyHash)));
 if(!preview){
  const hasQueued="EXISTS(SELECT 1 FROM wa_local_outbox WHERE group_id=? AND state='queued')";
  if(purpose==='stock_query'){
   statements.push(env.DB.prepare("UPDATE supplier_dispatch SET state='queued_local',message_id=?,sent_at=NULL,details_sent_at=NULL,responded_at=NULL,updated_at=? WHERE order_id=? AND state='sending' AND "+hasQueued).bind(first,t,orderId,groupId));
   statements.push(env.DB.prepare("INSERT INTO supplier_attempts(order_id,supplier_id,state,message_id,created_at,updated_at) SELECT order_id,supplier_id,'queued_local',?,?,? FROM supplier_dispatch WHERE order_id=? AND state='queued_local' ON CONFLICT(order_id,supplier_id) DO UPDATE SET state=excluded.state,message_id=excluded.message_id,updated_at=excluded.updated_at").bind(first,t,t,orderId));
   statements.push(env.DB.prepare("UPDATE supplier_jobs SET status='queued_local',updated_at=? WHERE order_id=? AND "+hasQueued).bind(t,orderId,groupId));
  }else if(purpose==='order_details'){
   statements.push(env.DB.prepare("UPDATE supplier_dispatch SET state='details_queued_local',responded_at=?,updated_at=? WHERE order_id=? AND state IN ('awaiting_reply','overdue_24h') AND "+hasQueued).bind(t,t,orderId,groupId));
  }else if(['buyer_update','buyer_delay'].includes(purpose)){
   const table=purpose==='buyer_update'?'buyer_notifications':'buyer_delay_notifications';
   statements.push(env.DB.prepare("UPDATE "+table+" SET state='queued_local',message_id=?,updated_at=? WHERE order_id=? AND state='sending' AND "+hasQueued).bind(first,t,orderId,groupId));
  }
 }
 await env.DB.batch(statements);
 const saved=await env.DB.prepare('SELECT payload_hash FROM wa_local_groups WHERE id=?').bind(groupId).first();
 if(saved?.payload_hash!==bodyHash)throw Error('Outra versão da consulta requer revisão');
 return {id:first,groupId};
}

async function reviewGroup(env,group,state){
 if(group.preview===1)return;
 const t=now();
 if(['buyer_update','buyer_delay'].includes(group.purpose)){
  const table=group.purpose==='buyer_update'?'buyer_notifications':'buyer_delay_notifications';
  await env.DB.prepare('UPDATE '+table+" SET state='needs_manual_contact',error=?,updated_at=? WHERE order_id=? AND state IN ('queued_local','sending')").bind('Envio local '+state,t,group.order_id).run();
 }else{
  await env.DB.prepare("UPDATE supplier_dispatch SET state='needs_review',last_error=?,updated_at=? WHERE order_id=? AND supplier_phone=? AND state IN ('queued_local','details_queued_local','awaiting_reply','overdue_24h')")
   .bind('Envio local '+state,t,group.order_id,group.recipient_jid.split('@')[0]).run();
  await env.DB.prepare("UPDATE supplier_jobs SET status='manual_review',updated_at=? WHERE order_id=?").bind(t,group.order_id).run();
 }
}
async function acknowledged(env,group){
 if(group.preview===1)return;
 const left=await env.DB.prepare("SELECT COUNT(*) AS count FROM wa_local_outbox WHERE group_id=? AND state!='sent'").bind(group.id).first();
 if(left?.count!==0)return;
 const first='lo_'+group.id.slice(3)+'_0',t=now(),phone=group.recipient_jid.split('@')[0];
 if(group.purpose==='stock_query'){
  await env.DB.batch([
   env.DB.prepare("UPDATE supplier_dispatch SET state='awaiting_reply',sent_at=?,updated_at=? WHERE order_id=? AND message_id=? AND state='queued_local'").bind(t,t,group.order_id,first),
   env.DB.prepare("UPDATE supplier_attempts SET state='awaiting_reply',updated_at=? WHERE order_id=? AND message_id=? AND state='queued_local'").bind(t,group.order_id,first),
   env.DB.prepare("UPDATE supplier_jobs SET status='supplier_contacted',updated_at=? WHERE order_id=? AND status='queued_local'").bind(t,group.order_id)
  ]);
 }else if(group.purpose==='order_details'){
  await env.DB.prepare("UPDATE supplier_dispatch SET state='details_sent',details_sent_at=?,updated_at=? WHERE order_id=? AND supplier_phone=? AND state='details_queued_local'").bind(t,t,group.order_id,phone).run();
 }else if(['buyer_update','buyer_delay'].includes(group.purpose)){
  const table=group.purpose==='buyer_update'?'buyer_notifications':'buyer_delay_notifications';
  await env.DB.prepare('UPDATE '+table+" SET state='sent',updated_at=? WHERE order_id=? AND message_id=? AND state='queued_local'").bind(t,group.order_id,first).run();
 }
}

export async function orderBridgeStatus(env){
 const rows=await env.DB.prepare('SELECT state,COUNT(*) AS count FROM wa_local_outbox GROUP BY state').all();
 const latest=await env.DB.prepare("SELECT g.id,o.state,o.updated_at FROM wa_local_groups g JOIN wa_local_outbox o ON o.group_id=g.id WHERE g.preview=1 ORDER BY g.created_at DESC,o.position DESC LIMIT 1").first();
 const response=latest?await env.DB.prepare('SELECT kind,created_at FROM wa_local_preview_replies WHERE group_id=? ORDER BY created_at DESC LIMIT 1').bind(latest.id).first():null;
 return {enabled:localOrdersReady(env),mode:localOrdersReady(env)?'live_orders':'preview_only',queue:rows.results||[],latestPreview:latest?{...latest,reply:response||null}:null};
}

async function preview(env,own){
 const recent=await env.DB.prepare('SELECT id FROM wa_local_groups WHERE preview=1 AND recipient_jid=? AND created_at>=? ORDER BY created_at DESC LIMIT 1').bind(own,new Date(Date.now()-30000).toISOString()).first();
 if(recent)return json({ok:true,mode:'preview_only',groupId:recent.id,reused:true});
 // A small public fixture avoids parsing the full 11,000-product catalog just to test transport.
 const response=await env.ASSETS.fetch(new Request(new URL('/whatsapp-preview.json',env.STORE_PUBLIC_URL)));
 if(!response.ok)throw Error('Foto de teste indisponível');
 const product=await response.json();
 if(!product?.title||!imageLink(product.image,env))throw Error('Produto com foto não encontrado');
 const fake={city:'São Paulo',items_json:JSON.stringify([{title:product.title,qty:1,size:'P',personalize:false,patch:false}])};
 const request=supplierPhotoRequest(fake);
 if(!request)throw Error('Prévia inválida');
 const queued=await enqueueLocalGroup(env,own,[{type:'image',image:{link:imageLink(product.image,env),caption:'TESTE DE PEDIDO — SEM COMPRA REAL\n\n'+request.text+'\n\nPara testar a resposta, use Responder nesta foto e escreva sim.'}}],
  {purpose:'preview',preview:true,dedupeKey:'preview:'+crypto.randomUUID()});
 return json({ok:true,mode:'preview_only',groupId:queued.groupId});
}

async function inbound(env,body,own,onInbound){
 if(!messageId(body.messageId)||typeof body.text!=='string'||!body.text.trim()||body.text.length>400)return json({error:'Resposta inválida.'},400);
 const from=String(body.fromJid||'');
 if(!/^\d+@(s\.whatsapp\.net|lid)$/.test(from))return json({error:'Remetente inválido.'},400);
 const context=messageId(body.contextId)?body.contextId:'';
 const match=context?await env.DB.prepare("SELECT g.*,o.id AS job_id FROM wa_local_outbox o JOIN wa_local_groups g ON g.id=o.group_id WHERE o.remote_message_id=? AND g.recipient_jid=? AND o.state='sent' LIMIT 1").bind(context,from).first():null;
 if(match?.preview===1){
  if(from!==own)return json({error:'Remetente de prévia inválido.'},403);
  const result=classifyStockReply(body.text,match.job_id);
  if(result)await env.DB.prepare('INSERT OR IGNORE INTO wa_local_preview_replies(id,group_id,kind,created_at) VALUES(?,?,?,?)').bind(body.messageId,match.id,result.kind,now()).run();
  return json({ok:true,preview:true,kind:result?.kind||'unrecognized'});
 }
 if(!localOrdersReady(env)||!onInbound)return json({ok:true,ignored:true});
 const sourcePhone=from.endsWith('@s.whatsapp.net')?from.split('@')[0]:'';
 if(!sourcePhone||from===own)return json({ok:true,ignored:true});
 const contact=await env.DB.prepare('SELECT supplier_id FROM supplier_contacts WHERE phone_e164=? AND authorized=1 LIMIT 1').bind(sourcePhone).first();
 if(!contact)return json({ok:true,ignored:true});
 let linked='';
 if(match?.order_id){
  const d=await env.DB.prepare('SELECT message_id FROM supplier_dispatch WHERE order_id=? AND supplier_phone=?').bind(match.order_id,sourcePhone).first();
  linked=d?.message_id||'';
 }else if(context){
  // The outbound acknowledgement may still be on its way. Keep the local reply pending.
  return json({error:'A mensagem citada ainda não foi confirmada.'},409);
 }
 const id='local:'+sourcePhone+':'+body.messageId;
 const prior=await env.DB.prepare('SELECT state,received_at FROM wa_local_reply_receipts WHERE id=?').bind(id).first();
 if(prior?.state==='done')return json({ok:true,duplicate:true});
 if(prior?.state==='processing'){
  if(Date.now()-Date.parse(prior.received_at)<30000)return json({error:'Resposta em processamento.'},409);
  const logged=await env.DB.prepare('SELECT id,order_id FROM wa_message_events WHERE id=?').bind(id).first();
  if(logged){
   const interruptedOrder=match?.order_id||logged.order_id;
   if(interruptedOrder){
    await env.DB.prepare("UPDATE supplier_dispatch SET state='needs_review',last_error='Revisar resposta interrompida',updated_at=? WHERE order_id=? AND state='awaiting_reply' AND updated_at<=?").bind(now(),interruptedOrder,prior.received_at).run();
    await env.DB.prepare("UPDATE supplier_jobs SET status='manual_review',updated_at=? WHERE order_id=? AND EXISTS(SELECT 1 FROM supplier_dispatch WHERE order_id=? AND state='needs_review')").bind(now(),interruptedOrder,interruptedOrder).run();
   }
   await env.DB.prepare("UPDATE wa_local_reply_receipts SET state='done' WHERE id=?").bind(id).run();
   return json({ok:true,reviewRequired:true});
  }
  const acquired=await env.DB.prepare("UPDATE wa_local_reply_receipts SET received_at=? WHERE id=? AND state='processing' AND received_at=? RETURNING id").bind(now(),id,prior.received_at).first();
  if(!acquired)return json({error:'Resposta em processamento.'},409);
 }else{
  const acquired=await env.DB.prepare("INSERT OR IGNORE INTO wa_local_reply_receipts(id,state,order_id,received_at) VALUES(?,'processing',?,?)").bind(id,match?.order_id||null,now()).run();
  if(!acquired.meta?.changes)return json({error:'Resposta em processamento.'},409);
 }
 const m={id,from:sourcePhone,type:'text',text:{body:body.text},...(linked?{context:{id:linked}}:{})};
 await onInbound(m);
 await env.DB.prepare("UPDATE wa_local_reply_receipts SET state='done' WHERE id=?").bind(id).run();
 return json({ok:true});
}

/** Called only after the existing bridge token and bound account have been verified. */
export async function handleOrderBridgeAction(action,env,body,own,{onInbound}={}){
 if(action==='orders-status')return json({ok:true,...await orderBridgeStatus(env)});
 if(action==='orders-preview')return await preview(env,own);
 if(action==='orders-inbound')return await inbound(env,body,own,onInbound);
 if(action==='orders-claim'){
  const t=now();
  await env.DB.prepare("UPDATE wa_local_outbox SET state='queued',lease_token=NULL,lease_until=NULL,updated_at=? WHERE state='claimed' AND lease_until<?").bind(t,t).run();
  const expired=await env.DB.prepare("SELECT DISTINCT g.* FROM wa_local_groups g JOIN wa_local_outbox o ON o.group_id=g.id WHERE o.state='sending' AND o.lease_until<?").bind(t).all();
  for(const g of expired.results||[]){await env.DB.prepare("UPDATE wa_local_outbox SET state='uncertain',updated_at=? WHERE group_id=? AND state='sending' AND lease_until<?").bind(t,g.id,t).run();await reviewGroup(env,g,'uncertain');}
  for(let tries=0;tries<10;tries++){
   const lease=crypto.randomUUID();
   const job=await env.DB.prepare("UPDATE wa_local_outbox SET state='claimed',lease_token=?,lease_until=?,updated_at=? WHERE id=(SELECT q.id FROM wa_local_outbox q JOIN wa_local_groups g ON g.id=q.group_id WHERE q.state='queued' AND (g.preview=1 OR ?=1) AND NOT EXISTS(SELECT 1 FROM wa_local_outbox p WHERE p.group_id=q.group_id AND p.position<q.position AND p.state!='sent') AND NOT EXISTS(SELECT 1 FROM wa_local_outbox a JOIN wa_local_groups b ON b.id=a.group_id WHERE b.order_id=g.order_id AND a.state IN ('claimed','sending','uncertain','failed')) ORDER BY q.created_at,q.position LIMIT 1) AND state='queued' RETURNING *").bind(lease,plus(120000),t,body.allowLive===true?1:0).first();
   if(!job)return json({ok:true,job:null});
   const group=await env.DB.prepare('SELECT * FROM wa_local_groups WHERE id=?').bind(job.group_id).first();
   if((group.preview===1&&group.recipient_jid!==own)||!await eligible(env,group)){
    await env.DB.prepare("UPDATE wa_local_outbox SET state='cancelled',updated_at=? WHERE group_id=? AND state IN ('queued','claimed')").bind(now(),group.id).run();
    if(group.preview!==1)await reviewGroup(env,group,'cancelled');
    continue;
   }
   return json({ok:true,job:{id:job.id,lease,kind:'order_message_v1',accountJid:own,recipientJid:group.recipient_jid,
    preview:group.preview===1,groupId:group.id,payload:JSON.parse(job.payload_json)}});
  }
  return json({ok:true,job:null});
 }
 if(!['orders-sending','orders-ack','orders-uncertain','orders-failed'].includes(action))return json({error:'Endpoint não encontrado.'},404);
 if(!jobId(body.jobId)||typeof body.lease!=='string'||!/^[a-f0-9-]{36}$/i.test(body.lease))return json({error:'Identificação inválida.'},400);
 const job=await env.DB.prepare('SELECT * FROM wa_local_outbox WHERE id=?').bind(body.jobId).first();
 if(!job||job.lease_token!==body.lease)return json({error:'Reserva inválida.'},409);
 const group=await env.DB.prepare('SELECT * FROM wa_local_groups WHERE id=?').bind(job.group_id).first();
 if(group.preview===1&&group.recipient_jid!==own)return json({error:'Conta inválida.'},403);
 if(action==='orders-sending'){
  if(!await eligible(env,group))return json({error:'Pedido ou contato não elegível.'},409);
  if(job.state==='sending')return json({ok:true});
  const moved=await env.DB.prepare("UPDATE wa_local_outbox SET state='sending',updated_at=? WHERE id=? AND lease_token=? AND state='claimed' AND lease_until>=? RETURNING id").bind(now(),job.id,body.lease,now()).first();
  return moved?json({ok:true}):json({error:'Reserva expirada.'},409);
 }
 if(action==='orders-ack'){
  if(!messageId(body.messageId))return json({error:'Confirmação inválida.'},400);
  if(job.state==='sent'){
   if(job.remote_message_id!==body.messageId)return json({error:'Mensagem já confirmada.'},409);
   await acknowledged(env,group);return json({ok:true});
  }
  const moved=await env.DB.prepare("UPDATE wa_local_outbox SET state='sent',remote_message_id=?,updated_at=? WHERE id=? AND lease_token=? AND state IN ('sending','uncertain') RETURNING id").bind(body.messageId,now(),job.id,body.lease).first();
  if(!moved)return json({error:'Envio não iniciado.'},409);
  await acknowledged(env,group);return json({ok:true});
 }
 const state=action==='orders-failed'?'failed':'uncertain';
 await env.DB.prepare("UPDATE wa_local_outbox SET state=?,updated_at=? WHERE id=? AND lease_token=? AND state IN ('claimed','sending')").bind(state,now(),job.id,body.lease).run();
 await reviewGroup(env,group,state);return json({ok:true});
}
