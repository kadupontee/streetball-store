/** Fluxo seguro de fulfillment: fotos, WhatsApp oficial, confirmação e SLA de 24h.
 * Sem credenciais/consentimento não envia mensagens. Pix para fornecedor exige aprovação humana.
 */
const digits=v=>String(v||'').replace(/\D/g,'');
export const normalizeWaPhone=v=>{const p=digits(v);return /^[1-9]\d{7,14}$/.test(p)?p:'';};
const now=()=>new Date().toISOString();
const jsonBody=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const trim=(s,n=350)=>String(s??'').trim().slice(0,n);
function suppliers(env){
 let list=[];
 try{list=JSON.parse(env.SUPPLIERS_JSON||'[]')}catch{return []}
 if(!Array.isArray(list))return [];
 return list.slice(0,5).filter(p=>p&&/^[a-z0-9_-]{2,40}$/i.test(p.id)&&!!normalizeWaPhone(p.phone)&&/^[a-z0-9_]{2,100}$/i.test(p.template||env.SUPPLIER_WA_TEMPLATE||'')).map(p=>({...p,phone:digits(p.phone),template:p.template||env.SUPPLIER_WA_TEMPLATE}));
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
export function previewSupplierOrder(env,order){
 const items=JSON.parse(order.items_json||'[]');
 const supplier=getSupplier(env,items);
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
     checks.waPhoneIdConfigured&&!checks.whatsappAutomationDisabled
 };
}
async function sendWa(env,to,message){
 if(env.WA_AUTOMATION_ENABLED!=='true'||!env.WA_TOKEN||!env.WA_PHONE_NUMBER_ID)throw Error('WhatsApp não habilitado ou sem credenciais');
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
function getSupplier(env,items){
 // Catálogo com múltiplas origens: nunca inventar fornecedor para item sem identificação.
 const desired=new Set(items.map(i=>trim(i.supplierId,40)));
 if(desired.size!==1||desired.has(''))return null;
 return suppliers(env).find(s=>s.id===[...desired][0])||null;
}
function messageSummary(items){
 return trim(items.map(i=>trim(i.title,58)+' '+trim(i.size,12)+' x'+i.qty+(i.personalize?' (personalizado)':'')).join(' | '),330);
}
export async function routePaidOrder(env,orderId){
 if(!env.DB)return false;
 const order=await env.DB.prepare("SELECT id,status,items_json FROM orders WHERE id=?").bind(orderId).first();
 if(!order||order.status!=='paid_supplier_pending')return false;
 const items=JSON.parse(order.items_json||'[]');
 const supplier=getSupplier(env,items);
 const firstPhoto=imageLink(items[0]?.image,env);
 const t=now();
 // Rastrear a preparação mesmo quando não for possível automatizar o WhatsApp.
 await env.DB.prepare("INSERT OR IGNORE INTO supplier_dispatch(order_id,supplier_id,supplier_phone,state,created_at,updated_at) VALUES(?,?,?,?,?,?)")
 .bind(order.id,supplier?.id||'',supplier?.phone||'','pending',t,t).run();
 if(!supplier||!env.STORE_PUBLIC_URL||!firstPhoto||env.WA_AUTOMATION_ENABLED!=='true'){
   await env.DB.prepare("UPDATE supplier_dispatch SET state='needs_configuration',updated_at=? WHERE order_id=? AND state='pending'").bind(now(),order.id).run();
   await env.DB.prepare("UPDATE supplier_jobs SET status='manual_review',updated_at=? WHERE order_id=? AND status='requires_supplier_routing'").bind(now(),order.id).run();
   return false;
 }
 // O cabeçalho com foto exige template de mídia aprovado; sem ele, não fingir que a foto foi entregue.
 const photoTemplate=env.SUPPLIER_WA_TEMPLATE_MEDIA||supplier.mediaTemplate;
 if(!photoTemplate){
   await env.DB.prepare("UPDATE supplier_dispatch SET state='needs_configuration',last_error='Template com foto não configurado',updated_at=? WHERE order_id=? AND state='pending'").bind(now(),order.id).run();
   return false;
 }
 await env.DB.prepare("UPDATE supplier_dispatch SET state='pending',supplier_id=?,supplier_phone=?,updated_at=?,last_error=NULL WHERE order_id=? AND state='needs_configuration'")
   .bind(supplier.id,supplier.phone,now(),order.id).run();
 const lock=await env.DB.prepare("UPDATE supplier_dispatch SET state='sending',attempts=attempts+1,updated_at=? WHERE order_id=? AND state='pending'").bind(now(),order.id).run();
 if(!lock.meta?.changes)return false;
 try{
   const id=await sendTemplate(env,supplier.phone,photoTemplate,[order.id.slice(0,8),messageSummary(items)],firstPhoto);
   await env.DB.prepare("UPDATE supplier_dispatch SET state='awaiting_reply',message_id=?,sent_at=?,updated_at=?,last_error=NULL WHERE order_id=?").bind(id,now(),now(),order.id).run();
   await env.DB.prepare("UPDATE supplier_jobs SET status='supplier_contacted',updated_at=? WHERE order_id=?").bind(now(),order.id).run();
   return true;
 }catch(err){
   // Em falha de rede, não reenviar automaticamente: uma mensagem anterior pode ter sido entregue.
   await env.DB.prepare("UPDATE supplier_dispatch SET state='needs_review',last_error=?,updated_at=? WHERE order_id=?").bind(trim(err?.message,250),now(),order.id).run();
   await env.DB.prepare("UPDATE supplier_jobs SET status='manual_review',updated_at=? WHERE order_id=?").bind(now(),order.id).run();
   return false;
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
 if(!env.BUYER_WA_TEMPLATE||env.WA_AUTOMATION_ENABLED!=='true')return;
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
export async function handleSupplierInbound(env,message,ctx){
 if(!env.DB||!message?.id)return;
 const from=normalizeWaPhone(message.from),text=trim(message.text?.body,400);
 const match=text.match(/^(DETALHES|PREPARANDO|CONFIRMAR)\s+([a-f0-9]{8})\s*$/i);
 if(!from||!match)return;
 const duplicate=await env.DB.prepare("SELECT id FROM wa_message_events WHERE id=?").bind(message.id).first();
 if(duplicate)return;
 const results=await env.DB.prepare("SELECT o.*,d.supplier_phone,d.state AS dispatch_state,d.details_sent_at FROM orders o JOIN supplier_dispatch d ON d.order_id=o.id WHERE d.supplier_phone=? AND o.id LIKE ? LIMIT 2").bind(from,match[2]+'%').all();
 if(results.results?.length!==1)return;
 const order=results.results[0],op=match[1].toUpperCase();
 await env.DB.prepare("INSERT OR IGNORE INTO wa_message_events(id,order_id,received_at) VALUES(?,?,?)").bind(message.id,order.id,now()).run();
 if(!['awaiting_reply','details_sent','confirmed','overdue_24h'].includes(order.dispatch_state))return;
 if(op==='DETALHES'&&!order.details_sent_at){
   try{
     await sendOrderDetails(env,order,{supplier_phone:from});
     await env.DB.prepare("UPDATE supplier_dispatch SET state='details_sent',responded_at=?,updated_at=? WHERE order_id=?").bind(now(),now(),order.id).run();
   }catch(err){
     await env.DB.prepare("UPDATE supplier_dispatch SET state='needs_review',last_error=?,updated_at=? WHERE order_id=?").bind(trim(err?.message,250),now(),order.id).run();
   }
 }
 if((op==='PREPARANDO'||op==='CONFIRMAR')&&['awaiting_reply','details_sent','overdue_24h'].includes(order.dispatch_state)){
   // Mesmo em pedidos de uma peça, o fornecedor só pode confirmar depois
   // de receber endereço, variantes e fotos do pedido.
   if(!order.details_sent_at){
     await sendWa(env,from,{type:'text',text:{body:'Antes de confirmar, responda DETALHES '+order.id.slice(0,8)+' para receber a lista completa e as fotos.'}}).catch(()=>{});
     return;
   }
   const update=await env.DB.prepare("UPDATE supplier_dispatch SET state='confirmed',responded_at=?,updated_at=? WHERE order_id=? AND state IN ('awaiting_reply','details_sent','overdue_24h')").bind(now(),now(),order.id).run();
   if(!update.meta?.changes)return;
   await env.DB.prepare("UPDATE supplier_jobs SET status='supplier_confirmed',updated_at=? WHERE order_id=?").bind(now(),order.id).run();
   await env.DB.prepare("UPDATE orders SET status='supplier_preparing',updated_at=? WHERE id=? AND status='paid_supplier_pending'").bind(now(),now(),order.id).run();
   const send=sendBuyerUpdate(env,order);
   if(ctx?.waitUntil)ctx.waitUntil(send);else await send;
 }
}
export async function monitorSupplierSLA(env){
 if(!env.DB)return;
 const cutoff=new Date(Date.now()-24*3600*1000).toISOString();
 const rows=await env.DB.prepare("SELECT order_id FROM supplier_dispatch WHERE state='awaiting_reply' AND sent_at<? LIMIT 100").bind(cutoff).all();
 for(const row of rows.results||[]){
   const change=await env.DB.prepare("UPDATE supplier_dispatch SET state='overdue_24h',updated_at=? WHERE order_id=? AND state='awaiting_reply'").bind(now(),row.order_id).run();
   if(change.meta?.changes){
    await env.DB.prepare("UPDATE supplier_jobs SET status='overdue_24h',updated_at=? WHERE order_id=?").bind(now(),row.order_id).run();
    if(env.OWNER_WA_PHONE&&env.OWNER_WA_TEMPLATE&&env.WA_AUTOMATION_ENABLED==='true'){
      await sendTemplate(env,env.OWNER_WA_PHONE,env.OWNER_WA_TEMPLATE,[row.order_id.slice(0,8)]).catch(()=>{});
    }
   }
 }
}
export async function retryPendingRoutes(env){
 if(!env.DB)return;
 const pending=await env.DB.prepare("SELECT id FROM orders WHERE status='paid_supplier_pending' AND id NOT IN (SELECT order_id FROM supplier_dispatch WHERE state IN ('sending','awaiting_reply','details_sent','confirmed','overdue_24h','needs_review')) ORDER BY updated_at ASC LIMIT 20").all();
 for(const row of pending.results||[])await routePaidOrder(env,row.id);
}
