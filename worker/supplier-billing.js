import {normalizeSupplierBilling,isSupplierBilling,billingOrderReferences,billingRequestText,BILLING_FORMAT_VERSION,BILLING_TEXT_LIMIT} from './supplier-billing-format.js';
import {sharedSupplierCostStatus} from './supplier-cost-reference.js';

const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const now=()=>new Date().toISOString();
const issueText={ambiguous_total:'Informe a moeda e o total sem ambiguidade.',message_too_long:'A mensagem excede o tamanho aceito.',
 invalid_pix:'O Pix está incompleto ou inválido.',multiple_pix:'Há mais de um código Pix na cobrança.',
 conflicting_brl_totals:'Há totais em reais diferentes na mensagem.',conflicting_usd_totals:'Há totais em dólares diferentes na mensagem.',missing_brl_total:'Falta o total final em reais.',
 attachment_needs_text:'Solicitado orçamento e Pix Copia e Cola por texto.',missing_pix_copy_paste:'Falta o Pix Copia e Cola completo.',
 pix_quote_mismatch:'O valor do Pix difere do orçamento.',order_reference_conflict:'A referência indica outro pedido.',
 missing_order_reference:'Falta vincular a cobrança à mensagem ou ao código exato do pedido.',
 multiple_eligible_orders:'Há vários pedidos possíveis. A cobrança aguarda uma referência exata.',
 conflicting_exchange_rates:'A mensagem contém cotações de câmbio diferentes.',invalid_exchange_rate:'O câmbio declarado é inválido.'};

export async function supplierBillingAvailable(env){
 if(!env.DB)return false;
 return !!await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='supplier_billing_messages'").first();
}

const baseQuery="SELECT o.id,o.status,d.supplier_id,d.supplier_phone,d.state AS dispatch_state,d.message_id,d.details_sent_at FROM orders o JOIN supplier_dispatch d ON d.order_id=o.id JOIN supplier_contacts c ON c.supplier_id=d.supplier_id WHERE d.supplier_phone=? AND c.phone_e164=d.supplier_phone AND c.authorized=1 AND o.status IN ('paid_supplier_pending','supplier_preparing') AND d.state IN ('details_sent','confirmed') AND d.details_sent_at IS NOT NULL";

/**
 * Exact reply/reference required to capture a payable bill. A single unquoted conversation
 * can receive a reference request, but its contents never become payment evidence.
 * No supplier URL is fetched and no provider or bank action is performed here.
 */
export async function collectSupplierBilling(env,message,{enqueue,productionReceipt}={}){
 const mediaType=['image','document','audio','video'].includes(message?.type)?message.type:'';
 const text=message?.type==='text'?message.text?.body:message?.[mediaType]?.caption||'';
 if(typeof text!=='string'||text.length>BILLING_TEXT_LIMIT||!isSupplierBilling(text,mediaType))return false;
 if(!env.DB||env.WA_TRANSPORT!=='local'||!enqueue||!productionReceipt||!await supplierBillingAvailable(env))return false;
 const from=String(message.from||'');if(!/^[1-9]\d{7,14}$/.test(from)||typeof message.id!=='string')return false;
 const references=billingOrderReferences(text),context=message.context?.id||'';
 let matches,linked=false;
 if(context){
  matches=(await env.DB.prepare(baseQuery+' AND d.message_id=? LIMIT 2').bind(from,context).all()).results||[];
  linked=true;
 }else if(references.length===1){
  matches=(await env.DB.prepare(baseQuery+' AND o.id LIKE ? LIMIT 2').bind(from,references[0]+'%').all()).results||[];
  linked=true;
 }else matches=(await env.DB.prepare(baseQuery+' LIMIT 2').bind(from).all()).results||[];
 if(matches.length>1||references.length>1){
  let hasReceipt=false;for(const match of matches)if(await productionReceipt(env,match.id)){hasReceipt=true;break;}
  if(!hasReceipt)return false;
  const envelope=normalizeSupplierBilling(text,mediaType);
  envelope.issues.push('multiple_eligible_orders');envelope.readyForCheck=false;
  const t=now(),id='sb_'+(await hash(message.id)).slice(0,32);
  await env.DB.prepare("INSERT OR IGNORE INTO supplier_billing_messages(id,inbound_message_id,order_id,supplier_id,supplier_phone,fingerprint,linked,format_json,state,created_at,updated_at) VALUES(?,?,NULL,NULL,?,?,0,?,'needs_reference',?,?)")
   .bind(id,message.id,from,await hash(JSON.stringify(envelope)),JSON.stringify(envelope),t,t).run();
  return true; // Preserve for review; do not assign a bill or send on behalf of an arbitrary order.
 }
 if(matches.length!==1)return false;
 const order=matches[0];
 if(!await productionReceipt(env,order.id))return false;
 const envelope=normalizeSupplierBilling(text,mediaType);
 if(references.some(ref=>!order.id.toLowerCase().startsWith(ref)))envelope.issues.push('order_reference_conflict');
 if(!linked)envelope.issues.push('missing_order_reference');
 envelope.readyForCheck=linked&&envelope.issues.length===0;
 const id='sb_'+(await hash(message.id)).slice(0,32),fingerprint=await hash(JSON.stringify(envelope));
 const existing=await env.DB.prepare('SELECT fingerprint,state FROM supplier_billing_messages WHERE id=?').bind(id).first();
 if(existing&&existing.fingerprint!==fingerprint)return true; // Same transport ID cannot replace evidence.
 if(existing?.state!=='collecting'&&existing)return true;
 const state=envelope.readyForCheck?'ready_for_check':linked?'needs_details':'needs_reference';
 const t=now();
 await env.DB.prepare("INSERT OR IGNORE INTO supplier_billing_messages(id,inbound_message_id,order_id,supplier_id,supplier_phone,fingerprint,linked,format_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'collecting',?,?)")
  .bind(id,message.id,order.id,order.supplier_id,from,fingerprint,linked?1:0,JSON.stringify(envelope),t,t).run();
 if(!envelope.readyForCheck&&!envelope.issues.includes('order_reference_conflict')){
  const kind=linked?'details':'reference';
  await enqueue(env,from,[{type:'text',text:{body:billingRequestText(order.id,kind)}}],{
   orderId:order.id,purpose:'billing_request',dedupeKey:'billing_request:'+order.id+':'+order.supplier_id+':'+kind
  });
 }
 await env.DB.prepare('UPDATE supplier_billing_messages SET state=?,updated_at=? WHERE id=? AND state=?')
  .bind(state,now(),id,'collecting').run();
 await env.DB.prepare("UPDATE supplier_jobs SET status=?,updated_at=? WHERE order_id=? AND status!='supplier_paid'")
  .bind(envelope.readyForCheck?'supplier_payment_pending':'supplier_attention',now(),order.id).run();
 // Never mark stock, production, payment or receipt confirmed by invoice content.
 return true;
}

export async function supplierBillingStatus(env){
 const available=await supplierBillingAvailable(env);
 const report={available,version:BILLING_FORMAT_VERSION,pagamentoAutomaticoHabilitado:false,pagamentoIniciado:false,
  limitePorPedido:null,limitePorDia:null,costTable:await sharedSupplierCostStatus(env)};
 if(!available)return {...report,queue:[],latest:null};
 const rows=await env.DB.prepare('SELECT state,COUNT(*) AS count FROM supplier_billing_messages GROUP BY state').all();
 const last=await env.DB.prepare('SELECT id,order_id,state,format_json,created_at FROM supplier_billing_messages ORDER BY seq DESC LIMIT 1').first();
 let latest=null;
 if(last){
  let details;try{details=JSON.parse(last.format_json);}catch{details={};}
  latest={id:last.id,orderId:last.order_id,state:last.state,formats:details.formats||[],
   quotedTotalBrl:details.quotedTotalBrl??null,pixRegistrado:!!details.pixPayload,
   pendencias:(details.issues||[]).map(issue=>issueText[issue]||'A cobrança precisa ser conferida.'),createdAt:last.created_at};
 }
 return {...report,queue:rows.results||[],latest};
}

/** Immutable, current bill evidence for the existing financial audit. No cost is trusted from chat. */
export async function loadSupplierBillingForAudit(env,input){
 if(!/^sb_[a-f0-9]{32}$/.test(input?.billingId||'')||!/^[a-f0-9-]{36}$/i.test(input?.orderId||'')||!await supplierBillingAvailable(env))return null;
 const record=await env.DB.prepare('SELECT * FROM supplier_billing_messages WHERE id=? AND order_id=?').bind(input.billingId,input.orderId).first();
 const age=record?Date.now()-Date.parse(record.created_at):NaN;
 if(!record||record.linked!==1||record.state!=='ready_for_check'||!Number.isFinite(age)||age<0||age>86400000)return null;
 const current=await env.DB.prepare('SELECT id FROM supplier_billing_messages WHERE order_id=? AND supplier_id=? ORDER BY seq DESC LIMIT 1').bind(record.order_id,record.supplier_id).first();
 const supplier=await env.DB.prepare("SELECT d.supplier_id,d.supplier_phone,c.phone_e164,c.authorized FROM supplier_dispatch d JOIN supplier_contacts c ON c.supplier_id=d.supplier_id WHERE d.order_id=? AND d.state IN ('details_sent','confirmed')").bind(record.order_id).first();
 if(current?.id!==record.id||supplier?.supplier_id!==record.supplier_id||supplier.supplier_phone!==record.supplier_phone||
  supplier.authorized!==1||supplier.phone_e164!==record.supplier_phone)return null;
 let envelope;try{envelope=JSON.parse(record.format_json);}catch{return null;}
 if(envelope.version!==BILLING_FORMAT_VERSION||!envelope.readyForCheck||envelope.issues?.length||!envelope.pixPayload||!envelope.quotedTotalBrl)return null;
 // Clients cannot substitute any part of the recorded bill while retaining its ID.
 if(('pixPayload'in input&&input.pixPayload!==envelope.pixPayload)||
  ('quotedTotalBrl'in input&&input.quotedTotalBrl!==envelope.quotedTotalBrl))return null;
 return {...input,pixPayload:envelope.pixPayload,quotedTotalBrl:envelope.quotedTotalBrl,quotedTotalUsd:envelope.quotedTotalUsd??null,quotedExchangeRateBrlPerUsd:envelope.quotedExchangeRateBrlPerUsd??null};
}
