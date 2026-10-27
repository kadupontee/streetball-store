import {asaasConfig} from './asaas.js';
import {auditSupplierPayment} from './supplier-payment-audit.js';
import {loadSupplierBillingForAudit} from './supplier-billing.js';
import {loadSharedSupplierCosts,SUPPLIER_COST_VERSION,sharedSupplierCostStatus} from './supplier-cost-reference.js';
import {localOrdersReady} from './fulfillment-readiness.js';
import {productionReadiness} from './production-readiness.js';

export const PAYOUT_VERSION='supplier-pix-v1';
const instant=()=>new Date().toISOString();
const plus=ms=>new Date(Date.now()+ms).toISOString();
const doc=value=>String(value??'').replace(/[.\s/-]/g,'');
const fullDoc=value=>/^\d{11}$|^\d{14}$/.test(doc(value))?doc(value):null;
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const decimal=(value,places=2)=>{
 if(!['string','number'].includes(typeof value)||String(value).length>32||!new RegExp('^\\d+(?:\\.\\d{1,'+places+'})?$').test(String(value)))return null;
 const [a,b='']=String(value).split('.'),n=BigInt(a)*10n**BigInt(places)+BigInt(b.padEnd(places,'0'));
 return n<=BigInt(Number.MAX_SAFE_INTEGER)?n:null;
};
const money=n=>{const value=n<0n?-n:n;return (n<0n?'-':'')+(value/100n)+'.'+String(value%100n).padStart(2,'0');};
const mask=value=>String(value).slice(0,3)+'…'+String(value).slice(-4);
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const failure=message=>{throw Error(message);};
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');

export async function payoutSchemaAvailable(env){
 if(!env.DB)return false;
 const names=['supplier_payout_intents','supplier_payout_settings','supplier_payout_profiles','supplier_payout_checks','supplier_payout_lock',
  'supplier_billing_messages','supplier_order_cost_references','supplier_cost_policy_approvals','supplier_shared_cost_scope',
  'supplier_directory','supplier_contacts','wa_local_bridge','wa_local_groups','wa_local_outbox','supplier_paid_order_records'];
 const row=await env.DB.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ("+names.map(()=>'?').join(',')+')').bind(...names).first();
 return row?.count===names.length;
}
const keyReady=env=>typeof env.ASAAS_SUPPLIER_PAYOUT_AUTH_TOKEN==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(env.ASAAS_SUPPLIER_PAYOUT_AUTH_TOKEN);
async function bank(env,path,{body,request=fetch}={}){
 const config=asaasConfig(env);if(config.sandbox!==false||!config.apiKey)return null;
 try{
  const r=await request(config.apiUrl+path,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(8000),
   headers:{access_token:config.apiKey,'user-agent':'StreetballStore/1.0',accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json().catch(()=>null);return r.ok&&plain(data)?data:null;
 }catch{return null;}
}

export function normalizePayoutProfile(input){
 const fields=['receiverCpfCnpj','exchangeRateMode','exchangeRateBrlPerUsd','gatewayFeeBrl','otherCostsBrlPerOrder','otherCostsBrlPerUnit','salesCostRate','validUntil'];
 if(!plain(input)||Object.keys(input).some(k=>!fields.includes(k)))failure('Perfil financeiro inválido.');
 const receiver=fullDoc(input.receiverCpfCnpj),fx=decimal(input.exchangeRateBrlPerUsd,6),rate=decimal(input.salesCostRate,6);
 if(!receiver||!['fixed','supplier_quote'].includes(input.exchangeRateMode)||
  (input.exchangeRateMode==='fixed'&&(fx===null||fx<=0n))||rate===null||rate>1000000n||
  ['gatewayFeeBrl','otherCostsBrlPerOrder','otherCostsBrlPerUnit'].some(k=>decimal(input[k])===null)||
  typeof input.validUntil!=='string'||!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(input.validUntil)||!Number.isFinite(Date.parse(input.validUntil))||Date.parse(input.validUntil)<=Date.now())failure('Informe recebedor, câmbio, tarifas, despesas e validade conferidos. Valores ausentes não viram zero.');
 return Object.fromEntries(fields.map(k=>[k,k==='receiverCpfCnpj'?receiver:k==='validUntil'?new Date(input[k]).toISOString():k==='exchangeRateBrlPerUsd'&&input.exchangeRateMode==='supplier_quote'?null:String(input[k])]));
}
async function profileFor(env,supplierId){
 const row=await env.DB.prepare('SELECT revision,profile_json FROM supplier_payout_profiles WHERE supplier_id=?').bind(supplierId).first();
 if(!row)return null;
 try{return {revision:row.revision,profile:normalizePayoutProfile(JSON.parse(row.profile_json))};}catch{return null;}
}
export async function supplierPayoutStatus(env){
 const available=await payoutSchemaAvailable(env),base={available,version:PAYOUT_VERSION,enabled:false,ready:false,
  authorizationTokenConfigured:keyReady(env),securityConfirmed:false,activeProfiles:0,limitePorPedido:null,limitePorDia:null,queue:[],latest:null};
 if(!available)return base;
 const settings=await env.DB.prepare('SELECT enabled,security_confirmed FROM supplier_payout_settings WHERE id=1').first();
 const profiles=await env.DB.prepare('SELECT p.supplier_id,p.revision,p.profile_json FROM supplier_payout_profiles p JOIN supplier_contacts c ON c.supplier_id=p.supplier_id JOIN supplier_shared_cost_scope s ON s.supplier_id=p.supplier_id WHERE c.authorized=1 AND s.policy_version=?').bind(SUPPLIER_COST_VERSION).all();
 for(const row of profiles.results||[])try{normalizePayoutProfile(JSON.parse(row.profile_json));base.activeProfiles++;}catch{}
 base.securityConfirmed=settings?.security_confirmed===1;
 base.enabled=!!(settings?.enabled===1&&base.securityConfirmed&&keyReady(env)&&localOrdersReady(env)&&asaasConfig(env).apiKey);
 base.ready=base.enabled&&base.activeProfiles>0;
 base.queue=(await env.DB.prepare('SELECT state,COUNT(*) AS count FROM supplier_payout_intents GROUP BY state').all()).results||[];
 const last=await env.DB.prepare('SELECT id,order_id,state,transaction_id,bank_status,amount_cents,actual_fee_cents,actual_net_cents,actual_result_brl,receipt_url,receipt_group_id,last_error,created_at FROM supplier_payout_intents ORDER BY created_at DESC,id DESC LIMIT 1').first();
 base.latest=last?{id:last.id,orderId:last.order_id,state:last.state,transactionId:last.transaction_id,bankStatus:last.bank_status,
  valueBrl:money(BigInt(last.amount_cents)),actualFeeBrl:last.actual_fee_cents==null?null:money(BigInt(last.actual_fee_cents)),
  receivedNetBrl:last.actual_net_cents==null?null:money(BigInt(last.actual_net_cents)),resultAfterRecordedCostsBrl:last.actual_result_brl,
  receiptAvailable:!!last.receipt_url,receiptQueued:!!last.receipt_group_id,receiptSent:false,
  pendencia:last.last_error,createdAt:last.created_at}:null;
 if(last?.receipt_group_id){const sent=await env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN state='sent' THEN 1 ELSE 0 END) AS sent FROM wa_local_outbox WHERE group_id=?").bind(last.receipt_group_id).first();base.latest.receiptSent=!!(sent?.total&&sent.sent===sent.total);}
 base.waiting=(await env.DB.prepare('SELECT c.reason,COUNT(*) AS count FROM supplier_payout_checks c JOIN supplier_billing_messages b ON b.id=c.billing_id LEFT JOIN supplier_payout_intents p ON p.order_id=b.order_id LEFT JOIN supplier_paid_order_records m ON m.order_id=b.order_id WHERE p.id IS NULL AND m.order_id IS NULL AND b.seq=(SELECT MAX(n.seq) FROM supplier_billing_messages n WHERE n.order_id=b.order_id AND n.supplier_id=b.supplier_id) GROUP BY c.reason').all()).results||[];
 return base;
}

export async function inspectSupplierPayout(env,billingId,{request=fetch}={}){
 if(!await payoutSchemaAvailable(env))return null;
 const bill=billingId?await env.DB.prepare('SELECT * FROM supplier_billing_messages WHERE id=?').bind(billingId).first():
  await env.DB.prepare("SELECT * FROM supplier_billing_messages WHERE state='ready_for_check' AND linked=1 ORDER BY seq DESC LIMIT 1").first();
 if(!bill)return null;
 const input=await loadSupplierBillingForAudit(env,{orderId:bill.order_id,billingId:bill.id});if(!input)return null;
 const order=await env.DB.prepare('SELECT id,items_json FROM orders WHERE id=?').bind(bill.order_id).first();
 const costs=await loadSharedSupplierCosts(env,order);if(!costs)return null;
 const decoded=await bank(env,'/pix/qrCodes/decode',{body:{payload:input.pixPayload},request}),receiver=fullDoc(decoded?.receiver?.cpfCnpj);
 if(!receiver||decoded.payload!==input.pixPayload||decoded.canBePaid!==true)return null;
 return {billingId:bill.id,orderId:bill.order_id,supplierId:bill.supplier_id,valueBrl:input.quotedTotalBrl,expectedUsd:costs.totalUsd,quotedExchangeRateBrlPerUsd:input.quotedExchangeRateBrlPerUsd,
  receiverName:String(decoded.receiver.name||decoded.receiver.tradingName||'').slice(0,120),receiverDocument:mask(receiver),
  receiverBinding:await hash(bill.id+'|'+bill.fingerprint+'|'+receiver),receiverCpfCnpj:receiver};
}

/** These settings create no transfer. Only explicitly enabling the processor can submit future qualified bills. */
export async function handleSupplierPayoutAction(action,env,body={}, {request=fetch}={}){
 if(action==='status')return {ok:true,...await supplierPayoutStatus(env)};
 if(!localOrdersReady(env)||!await payoutSchemaAvailable(env))failure('Instale a preparação de pagamentos no Mac de produção.');
 if(action==='inspect'){
  const preview=await inspectSupplierPayout(env,body.billingId,{request});
  if(!preview)failure('Ainda não há cobrança atual com Pix e referência de compra completos.');
  const {receiverCpfCnpj,...safe}=preview;return {ok:true,consultaSomenteLeitura:true,...safe};
 }
 if(action==='profile'){
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||body.expectedRevision>=Number.MAX_SAFE_INTEGER)failure('Revisão do perfil inválida.');
  let supplierId=body.supplierId,input=body.profile;
  if(body.billingId){
   const preview=await inspectSupplierPayout(env,body.billingId,{request});
   if(!preview||body.receiverBinding!==preview.receiverBinding||body.confirmReceiver!==true)failure('Confira o recebedor da cobrança antes de cadastrar o perfil.');
   supplierId=preview.supplierId;input={...body.profile,receiverCpfCnpj:preview.receiverCpfCnpj};
  }
  const profile=normalizePayoutProfile(input);
  const supplier=await env.DB.prepare('SELECT c.supplier_id FROM supplier_contacts c JOIN supplier_shared_cost_scope s ON s.supplier_id=c.supplier_id WHERE c.supplier_id=? AND c.authorized=1 AND s.policy_version=?').bind(supplierId,SUPPLIER_COST_VERSION).first();
  if(!supplier)failure('O fornecedor não está autorizado na tabela de custos compartilhada.');
  const saved=await env.DB.prepare('INSERT INTO supplier_payout_profiles(supplier_id,revision,profile_json,updated_at) SELECT ?,?,?,? WHERE COALESCE((SELECT revision FROM supplier_payout_profiles WHERE supplier_id=?),0)=? ON CONFLICT(supplier_id) DO UPDATE SET revision=excluded.revision,profile_json=excluded.profile_json,updated_at=excluded.updated_at WHERE supplier_payout_profiles.revision=?')
   .bind(supplierId,body.expectedRevision+1,JSON.stringify(profile),instant(),supplierId,body.expectedRevision,body.expectedRevision).run();
  if(!saved.meta?.changes)failure('O perfil foi atualizado em outra sessão. Confira a revisão antes de salvar.');
  await env.DB.prepare('UPDATE supplier_payout_checks SET next_check_at=?').bind(instant()).run();
  return {ok:true,supplierId,revision:body.expectedRevision+1,receiverDocument:mask(profile.receiverCpfCnpj),validUntil:profile.validUntil,pagamentoIniciado:false};
 }
 if(action==='profiles'){
  const rows=await env.DB.prepare('SELECT supplier_id,revision,profile_json FROM supplier_payout_profiles').all();
  return {ok:true,profiles:(rows.results||[]).map(row=>{let p;try{p=JSON.parse(row.profile_json);}catch{p={};}return {supplierId:row.supplier_id,revision:row.revision,receiverDocument:mask(p.receiverCpfCnpj||''),validUntil:p.validUntil};})};
 }
 if(action==='resolve'){
  if(!uuid(body.intentId)||!uuid(body.transactionId))failure('Informe a intenção do bot e o ID da transação no Asaas.');
  const intent=await env.DB.prepare('SELECT * FROM supplier_payout_intents WHERE id=?').bind(body.intentId).first();
  if(!intent||(!['unknown','submitting','submitted','authorized','needs_review'].includes(intent.state))||(intent.transaction_id&&intent.transaction_id!==body.transactionId))failure('A intenção não está disponível para essa conferência.');
  const tx=await bank(env,'/pix/transactions/'+encodeURIComponent(body.transactionId),{request});
  if(!transactionMatchesIntent(tx,intent,body.transactionId,true))failure('A transação não comprovou a referência exclusiva, o valor e o recebedor da intenção. Nenhum Pix novo foi solicitado.');
  await env.DB.prepare("UPDATE supplier_payout_intents SET transaction_id=COALESCE(transaction_id,?),state=CASE WHEN authorization_at IS NOT NULL THEN 'authorized' ELSE 'submitted' END,next_poll_at=NULL,updated_at=? WHERE id=? AND (transaction_id IS NULL OR transaction_id=?)")
   .bind(tx.id,instant(),intent.id,tx.id).run();
  await reconcile(env,{...intent,transaction_id:tx.id},{request});
  return {ok:true,consultaSomenteLeituraNoAsaas:true,novoPagamentoSolicitado:false,...await supplierPayoutStatus(env)};
 }
 if(action==='disable'){
  await env.DB.prepare('UPDATE supplier_payout_settings SET enabled=0,updated_at=? WHERE id=1').bind(instant()).run();return {ok:true,...await supplierPayoutStatus(env)};
 }
 if(action==='enable'){
  const status=await supplierPayoutStatus(env),costs=await sharedSupplierCostStatus(env);
  if(body.securityWebhookConfigured!==true||body.costPolicyVersion!==SUPPLIER_COST_VERSION||!keyReady(env)||status.activeProfiles<1||!costs.configured)failure('Confirme o mecanismo de segurança no Asaas e cadastre ao menos um perfil financeiro vigente.');
  const readiness=await productionReadiness(env,{request}),required=['chaveAutenticada','contaAprovada','contaCorrespondeAoCnpj'];
  if(required.some(k=>readiness.verificacoes?.[k]!==true))failure('A conta Asaas de produção não confirmou os requisitos de saída.');
  await env.DB.prepare('UPDATE supplier_payout_settings SET enabled=1,security_confirmed=1,updated_at=? WHERE id=1').bind(instant()).run();
  return {ok:true,...await supplierPayoutStatus(env)};
 }
 failure('Operação de pagamentos desconhecida.');
}

export function receiverMatches(actual,expected){
 const value=doc(actual),full=fullDoc(expected);if(!full||value.length!==full.length||!/^[\d*]+$/.test(value))return false;
 if(!value.includes('*'))return value===full;
 return value.replace(/\*/g,'').length>=6&&[...value].every((c,i)=>c==='*'||c===full[i]);
}
function transactionMatchesIntent(tx,intent,transactionId,requireDescription=false){
 return tx?.id===transactionId&&tx.type==='DEBIT'&&decimal(tx.value)===BigInt(intent.amount_cents)&&receiverMatches(tx.externalAccount?.cpfCnpj,intent.receiver_document)&&
  (!requireDescription||tx.description==='Streetball '+intent.order_id.slice(0,8)+' / '+intent.id);
}
function receiptUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&['www.asaas.com','asaas.com'].includes(u.hostname)&&!u.username&&!u.password&&(!u.port||u.port==='443')?u.href:null;}catch{return null;}}
async function note(env,bill,reason){
 await env.DB.prepare('INSERT INTO supplier_payout_checks(billing_id,reason,next_check_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(billing_id) DO UPDATE SET reason=excluded.reason,next_check_at=excluded.next_check_at,updated_at=excluded.updated_at')
  .bind(bill.id,reason,plus(3600000),instant()).run();
}
async function rememberOutcome(env,intent,state,{transactionId=null,bankStatus=null,error=null,fee=null,net=null,result=null,receipt=null}={}){
 await env.DB.prepare('UPDATE supplier_payout_intents SET state=?,transaction_id=COALESCE(?,transaction_id),bank_status=COALESCE(?,bank_status),last_error=?,actual_fee_cents=COALESCE(?,actual_fee_cents),actual_net_cents=?,actual_result_brl=?,receipt_url=COALESCE(?,receipt_url),next_poll_at=?,updated_at=? WHERE id=?')
  .bind(state,transactionId,bankStatus,error,fee,net,result,receipt,state==='submitted'?null:plus(state==='paid'?60000:30000),instant(),intent.id).run();
}
async function reconcile(env,intent,{request,enqueue}){
 if(!intent.transaction_id)return;
 const tx=await bank(env,'/pix/transactions/'+encodeURIComponent(intent.transaction_id),{request});
 if(!tx){await env.DB.prepare('UPDATE supplier_payout_intents SET next_poll_at=? WHERE id=?').bind(plus(30000),intent.id).run();return;}
 if(tx.id===intent.transaction_id&&tx.type==='DEBIT'&&['REFUSED','CANCELLED'].includes(tx.status)){
  await rememberOutcome(env,intent,tx.status==='REFUSED'?'refused':'cancelled',{bankStatus:tx.status,error:'O Asaas recusou ou cancelou o Pix. Nenhuma nova tentativa será criada automaticamente.'});return;
 }
 if(tx.id!==intent.transaction_id||tx.type!=='DEBIT'||tx.finality||tx.scheduledDate||
  (tx.changeValue!=null&&decimal(tx.changeValue)!==0n)||(tx.refundedValue!=null&&decimal(tx.refundedValue)!==0n)||
  decimal(tx.value)!==BigInt(intent.amount_cents)||!receiverMatches(tx.externalAccount?.cpfCnpj,intent.receiver_document)){
  await rememberOutcome(env,intent,'needs_review',{bankStatus:typeof tx.status==='string'?tx.status:null,error:'A transação retornada difere do Pix registrado.'});return;
 }
 if(tx.status!=='DONE'){await env.DB.prepare('UPDATE supplier_payout_intents SET bank_status=?,next_poll_at=?,updated_at=? WHERE id=?').bind(String(tx.status||'UNKNOWN').slice(0,90),plus(15000),instant(),intent.id).run();return;}
 const fee=decimal(tx.chargedFeeValue),receipt=receiptUrl(tx.transactionReceiptUrl);
 let error=fee===null?'O Pix foi concluído; a tarifa final ainda precisa ser confirmada.':
  BigInt(intent.amount_cents)+fee>BigInt(intent.reserved_cents)?'O Pix foi concluído com tarifa diferente da reservada. Conferir o resultado.':null;
 const authorization=await env.DB.prepare('SELECT authorization_at FROM supplier_payout_intents WHERE id=?').bind(intent.id).first();
 if(!authorization?.authorization_at){
  error='O Pix foi concluído sem autorização registrada pelo webhook. O executor foi desativado para conferir o mecanismo do Asaas.';
  await env.DB.prepare('UPDATE supplier_payout_settings SET enabled=0,updated_at=? WHERE id=1').bind(instant()).run();
 }
 let submitted,audit;try{submitted=JSON.parse(intent.reference_json);audit=JSON.parse(intent.audit_json);}catch{submitted={};audit={};}
 const charge=/^pay_[A-Za-z0-9_-]+$/.test(submitted.customerPaymentId||'')?await bank(env,'/payments/'+encodeURIComponent(submitted.customerPaymentId),{request}):null;
 const net=decimal(charge?.netValue),other=decimal(audit.valoresBrl?.outrosCustos);
 const incomeValid=charge?.id===submitted.customerPaymentId&&charge.externalReference===intent.order_id&&charge.status==='RECEIVED'&&charge.deleted===false&&!charge.chargeback&&
  (charge.refunds==null||(Array.isArray(charge.refunds)&&charge.refunds.length===0))&&net!==null&&net<=decimal(charge.value)&&decimal(charge.value)===decimal(audit.valoresBrl?.receitaBruta);
 const result=incomeValid&&fee!==null&&other!==null?net-BigInt(intent.amount_cents)-fee-other:null;
 if(!incomeValid)error='O Pix foi concluído, mas o recebimento do cliente mudou ou não pôde ser conferido. O executor foi desativado.';
 else if(result!==null&&result<=0n)error='O Pix foi concluído, mas o resultado real não cobre as despesas com resultado positivo. O executor foi desativado.';
 if(error)await env.DB.prepare('UPDATE supplier_payout_settings SET enabled=0,updated_at=? WHERE id=1').bind(instant()).run();
 await rememberOutcome(env,intent,'paid',{bankStatus:'DONE',fee:fee===null?null:Number(fee),net:incomeValid?Number(net):null,result:result===null?null:money(result),receipt,error});
 await env.DB.prepare("INSERT OR IGNORE INTO supplier_paid_order_records(order_id,source,reference_id,recorded_at) VALUES(?,'executor',?,?)").bind(intent.order_id,intent.id,instant()).run();
 await env.DB.prepare('UPDATE supplier_jobs SET status=?,updated_at=? WHERE order_id=?').bind(error?'manual_review':'supplier_paid',instant(),intent.order_id).run();
}
async function queueReceipt(env,intent,enqueue){
 if(!enqueue||intent.state!=='paid'||!intent.receipt_url||intent.receipt_group_id)return;
 try{
  const queued=await enqueue(env,intent.supplier_phone,[{type:'text',text:{body:'Pagamento do pedido '+intent.order_id.slice(0,8)+' concluído. Valor: R$ '+money(BigInt(intent.amount_cents)).replace('.',',')+'.\nComprovante Asaas: '+intent.receipt_url}}],
   {orderId:intent.order_id,purpose:'supplier_payment_receipt',dedupeKey:'supplier_payment_receipt:'+intent.id});
  await env.DB.prepare('UPDATE supplier_payout_intents SET receipt_group_id=?,updated_at=? WHERE id=? AND state=?').bind(queued.groupId,instant(),intent.id,'paid').run();
 }catch{
  // Defer a blocked receipt so it cannot starve new orders on every connector tick.
  await env.DB.prepare("UPDATE supplier_payout_intents SET next_poll_at=? WHERE id=? AND state='paid' AND receipt_group_id IS NULL").bind(plus(60000),intent.id).run();
 }
}

/** Exactly one submission per order. There is no provider idempotency key and no retry of an ambiguous POST. */
export async function processSupplierPayouts(env,{request=fetch,enqueue}={}){
 if(asaasConfig(env).sandbox!==false||!asaasConfig(env).apiKey||!await payoutSchemaAvailable(env))return;
 const token=crypto.randomUUID(),lease=plus(120000);
 const lock=await env.DB.prepare('INSERT INTO supplier_payout_lock(id,token,lease_until) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,lease_until=excluded.lease_until WHERE supplier_payout_lock.lease_until<? RETURNING token').bind(token,lease,instant()).first();
 if(lock?.token!==token)return;
 try{
  await env.DB.prepare("UPDATE supplier_payout_intents SET state='unknown',last_error='O processo foi interrompido durante o envio. Conferir no Asaas; não repetir o Pix.',updated_at=? WHERE state='submitting' AND updated_at<?").bind(instant(),new Date(Date.now()-120000).toISOString()).run();
  // One bank operation per tick keeps reconciliation within the Worker's request budget.
  const pending=await env.DB.prepare("SELECT * FROM supplier_payout_intents WHERE transaction_id IS NOT NULL AND (state IN ('submitted','authorized','needs_review') OR (state='paid' AND receipt_url IS NULL)) AND (next_poll_at IS NULL OR next_poll_at<=?) ORDER BY updated_at LIMIT 1").bind(instant()).first();
  if(pending){
   await reconcile(env,pending,{request,enqueue});
   const updated=await env.DB.prepare('SELECT * FROM supplier_payout_intents WHERE id=?').bind(pending.id).first();
   if(updated)await queueReceipt(env,updated,enqueue);return;
  }
  const paid=await env.DB.prepare("SELECT * FROM supplier_payout_intents WHERE state='paid' AND receipt_url IS NOT NULL AND receipt_group_id IS NULL AND (next_poll_at IS NULL OR next_poll_at<=?) ORDER BY created_at LIMIT 1").bind(instant()).first();
  if(paid){await queueReceipt(env,paid,enqueue);return;}
  const settings=await env.DB.prepare('SELECT enabled,security_confirmed FROM supplier_payout_settings WHERE id=1').first();
  if(settings?.enabled!==1||settings.security_confirmed!==1||!keyReady(env)||!localOrdersReady(env))return;
  const heartbeat=await env.DB.prepare('SELECT heartbeat_at FROM wa_local_bridge WHERE id=1').first();
  if(!heartbeat||Date.now()-Date.parse(heartbeat.heartbeat_at)>60000)return;
  const candidates=await env.DB.prepare("SELECT b.* FROM supplier_billing_messages b LEFT JOIN supplier_payout_intents p ON p.order_id=b.order_id LEFT JOIN supplier_payout_checks c ON c.billing_id=b.id LEFT JOIN supplier_paid_order_records m ON m.order_id=b.order_id LEFT JOIN supplier_jobs j ON j.order_id=b.order_id WHERE b.linked=1 AND b.state='ready_for_check' AND p.id IS NULL AND m.order_id IS NULL AND (j.status IS NULL OR j.status!='supplier_paid') AND (c.next_check_at IS NULL OR c.next_check_at<=?) AND b.seq=(SELECT MAX(n.seq) FROM supplier_billing_messages n WHERE n.order_id=b.order_id AND n.supplier_id=b.supplier_id) ORDER BY b.seq LIMIT 1").bind(instant()).all();
  for(const bill of candidates.results||[]){
   const current=await profileFor(env,bill.supplier_id);
   if(!current){await note(env,bill,'Perfil de recebedor/câmbio ausente ou vencido.');continue;}
   const order=await env.DB.prepare('SELECT id,items_json,total,payment_id FROM orders WHERE id=?').bind(bill.order_id).first();
   const reference=await loadSharedSupplierCosts(env,order);
   if(!reference){await note(env,bill,'A referência compartilhada de compra está incompleta.');continue;}
   const fees=await bank(env,'/myAccount/fees/',{request}),baseFee=decimal(fees?.transfer?.pix?.feeValue),discount=fees?.transfer?.pix?.discountValue;
   if(baseFee===null||(discount!=null&&decimal(discount)===null)){await note(env,bill,'Não foi possível confirmar a tarifa de saída do Asaas.');continue;}
   const pixFee=discount==null?baseFee:(baseFee>decimal(discount)?baseFee:decimal(discount));
   const p=current.profile,rate=decimal(p.salesCostRate,6),gross=decimal(order.total);
   if(gross===null){await note(env,bill,'O valor do pedido não foi confirmado.');continue;}
   const other=decimal(p.otherCostsBrlPerOrder)+decimal(p.otherCostsBrlPerUnit)*BigInt(reference.quantity)+(gross*rate+500000n)/1000000n;
   let exchangeRate=p.exchangeRateBrlPerUsd;
   if(p.exchangeRateMode==='supplier_quote'){
    const envelope=JSON.parse(bill.format_json);exchangeRate=envelope.quotedExchangeRateBrlPerUsd;
    if(decimal(exchangeRate,6)===null||decimal(exchangeRate,6)<=0n||!envelope.quotedTotalUsd){
     await note(env,bill,'O total em USD e o câmbio precisam estar declarados na cobrança para este perfil.');
     if(enqueue)await enqueue(env,bill.supplier_phone,[{type:'text',text:{body:'Pedido '+bill.order_id.slice(0,8)+': envie em uma única resposta o total em USD incluindo frete e adicionais, como “Total USD: 15,00”, o câmbio aplicado como “Câmbio BRL por USD: 5,12”, as taxas, o Total BRL e o Pix Copia e Cola. Responda a esta mensagem com a cobrança completa.'}}],
      {orderId:bill.order_id,purpose:'billing_request',dedupeKey:'supplier_fx_request:'+bill.order_id+':'+bill.supplier_id});
     continue;
    }
   }
   const costs={exchangeRateBrlPerUsd:exchangeRate,gatewayFeeBrl:p.gatewayFeeBrl,pixFeeBrl:money(pixFee),otherCostsBrl:money(other)};
   const input=await loadSupplierBillingForAudit(env,{orderId:bill.order_id,billingId:bill.id,costs,receiverCpfCnpj:p.receiverCpfCnpj});
   if(!input){await note(env,bill,'A cobrança mudou ou perdeu a vinculação com o pedido.');continue;}
   const reserved=await env.DB.prepare("SELECT COALESCE(SUM(reserved_cents),0) AS total FROM supplier_payout_intents WHERE state IN ('submitting','submitted','authorized','unknown','needs_review')").first();
   const allocated=BigInt(reserved?.total||0);
   let ordinaryPix=false;
   const allocatedRequest=async(url,options)=>{
    const response=await request(url,options);
    if(String(url)==='https://api.asaas.com/v3/pix/qrCodes/decode'&&response.ok){
     const decoded=await response.clone().json();ordinaryPix=['STATIC','DYNAMIC','DYNAMIC_WITH_ASAAS_ADDRESS_KEY'].includes(decoded?.type);
    }
    if(String(url)==='https://api.asaas.com/v3/finance/balance'&&response.ok){
     const data=await response.json(),balance=decimal(data?.balance);
     if(balance===null)return Response.json({});
     return Response.json({balance:money(balance>allocated?balance-allocated:0n)});
    }
    return response;
   };
   const audit=await auditSupplierPayment(env,input,{request:allocatedRequest});
   if(!audit.conferenciaFinanceiraConcluida){await note(env,bill,audit.pendencias.join(' ').slice(0,500));continue;}
   if(!ordinaryPix){await note(env,bill,'O tipo de Pix não foi confirmado como pagamento único comum.');continue;}
   const latest=await loadSupplierBillingForAudit(env,{orderId:bill.order_id,billingId:bill.id});
   const stillCurrent=await profileFor(env,bill.supplier_id);
   const stillEnabled=await env.DB.prepare('SELECT enabled,security_confirmed FROM supplier_payout_settings WHERE id=1').first();
   const held=await env.DB.prepare('SELECT token,lease_until FROM supplier_payout_lock WHERE id=1').first();
   if(!latest||stillCurrent?.revision!==current.revision||stillEnabled?.enabled!==1||stillEnabled.security_confirmed!==1||held?.token!==token||held.lease_until<=instant())continue;
   const amount=decimal(audit.valoresBrl.valorPix),value=Number(money(amount));
   if(decimal(value)!==amount){await note(env,bill,'O valor não pode ser serializado com precisão de centavos.');continue;}
   const intent={id:crypto.randomUUID(),order_id:bill.order_id},t=instant();
   const inserted=await env.DB.prepare("INSERT OR IGNORE INTO supplier_payout_intents(id,order_id,billing_id,supplier_id,supplier_phone,profile_revision,reference_json,audit_json,amount_cents,reserved_cents,receiver_document,state,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,'submitting',?,? WHERE NOT EXISTS(SELECT 1 FROM supplier_paid_order_records WHERE order_id=?) AND NOT EXISTS(SELECT 1 FROM supplier_jobs WHERE order_id=? AND status='supplier_paid') AND EXISTS(SELECT 1 FROM supplier_payout_settings WHERE id=1 AND enabled=1 AND security_confirmed=1) AND EXISTS(SELECT 1 FROM supplier_payout_profiles WHERE supplier_id=? AND revision=?)")
    .bind(intent.id,bill.order_id,bill.id,bill.supplier_id,bill.supplier_phone,current.revision,JSON.stringify({...input,customerPaymentId:order.payment_id}),JSON.stringify(audit),Number(amount),Number(amount+pixFee),p.receiverCpfCnpj,t,t,bill.order_id,bill.order_id,bill.supplier_id,current.revision).run();
   if(!inserted.meta?.changes)continue;
   const tx=await bank(env,'/pix/qrCodes/pay',{body:{qrCode:{payload:input.pixPayload},value,description:'Streetball '+bill.order_id.slice(0,8)+' / '+intent.id},request});
   if(!uuid(tx?.id)){
    await env.DB.prepare("UPDATE supplier_payout_intents SET state='unknown',last_error='O Asaas não devolveu uma identificação conclusiva. Conferir sem repetir o Pix.',updated_at=? WHERE id=? AND transaction_id IS NULL").bind(instant(),intent.id).run();continue;
   }
   const linked=await env.DB.prepare('SELECT transaction_id FROM supplier_payout_intents WHERE id=?').bind(intent.id).first();
   if(linked?.transaction_id&&linked.transaction_id!==tx.id){
    await rememberOutcome(env,intent,'needs_review',{error:'O ID retornado pelo Asaas difere do já comprovado no webhook.'});
    await env.DB.prepare('UPDATE supplier_payout_settings SET enabled=0,updated_at=? WHERE id=1').bind(instant()).run();continue;
   }
   await env.DB.prepare("UPDATE supplier_payout_intents SET state=CASE WHEN authorization_at IS NOT NULL THEN 'authorized' ELSE 'submitted' END,transaction_id=COALESCE(transaction_id,?),bank_status=?,next_poll_at=NULL,updated_at=? WHERE id=? AND state IN ('submitting','unknown','submitted','authorized') AND (transaction_id IS NULL OR transaction_id=?)")
    .bind(tx.id,typeof tx.status==='string'?tx.status.slice(0,90):null,instant(),intent.id,tx.id).run();
  }
 }finally{await env.DB.prepare('DELETE FROM supplier_payout_lock WHERE id=1 AND token=?').bind(token).run();}
}

export async function handlePayoutAuthorization(request,env,{request:providerRequest=fetch}={}){
 const answer=(status,code=200,reason='')=>Response.json({status,...(reason?{refuseReason:reason}:{})},{status:code,headers:{'cache-control':'no-store'}});
 if(request.method!=='POST')return answer('REFUSED',405);
 if(!keyReady(env))return answer('REFUSED',503);
 const received=request.headers.get('asaas-access-token')||'',expected=env.ASAAS_SUPPLIER_PAYOUT_AUTH_TOKEN;
 const [a,b]=await Promise.all([hash(received),hash(expected)]);let different=0;for(let i=0;i<a.length;i++)different|=a.charCodeAt(i)^b.charCodeAt(i);
 if(different)return answer('REFUSED',403);
 if(Number(request.headers.get('content-length')||0)>16000)return answer('REFUSED',413);
 const raw=await request.text();if(raw.length>16000)return answer('REFUSED',413);
 let body;try{body=JSON.parse(raw);}catch{return answer('REFUSED',400);}
 if(body?.type!=='PIX_QR_CODE'||!uuid(body.pixQrCode?.id)||!await payoutSchemaAvailable(env))return answer('REFUSED');
 const tx=body.pixQrCode;let intent=await env.DB.prepare('SELECT * FROM supplier_payout_intents WHERE transaction_id=?').bind(tx.id).first();
 if(!intent&&typeof tx.description==='string'){
  const marker=tx.description.match(/^Streetball ([a-f0-9]{8}) \/ ([a-f0-9-]{36})$/i);
  const pending=marker?await env.DB.prepare("SELECT * FROM supplier_payout_intents WHERE id=? AND transaction_id IS NULL AND state IN ('submitting','unknown')").bind(marker[2]).first():null;
  if(pending&&pending.order_id.startsWith(marker[1])){
   const proof=await bank(env,'/pix/transactions/'+encodeURIComponent(tx.id),{request:providerRequest});
   if(transactionMatchesIntent(proof,pending,tx.id,true)){
    await env.DB.prepare("UPDATE supplier_payout_intents SET transaction_id=?,state='submitted',next_poll_at=NULL,updated_at=? WHERE id=? AND transaction_id IS NULL AND state IN ('submitting','unknown')").bind(tx.id,instant(),pending.id).run();
    intent=await env.DB.prepare('SELECT * FROM supplier_payout_intents WHERE transaction_id=?').bind(tx.id).first();
   }
  }
 }
 if(!intent){
  const inFlight=await env.DB.prepare("SELECT id FROM supplier_payout_intents WHERE state='submitting' AND updated_at>=? LIMIT 1").bind(new Date(Date.now()-30000).toISOString()).first();
  return answer('REFUSED',inFlight?503:200,'Operação não identificada no registro de pagamentos.');
 }
 const settings=await env.DB.prepare('SELECT enabled,security_confirmed FROM supplier_payout_settings WHERE id=1').first();
 if(!localOrdersReady(env)||settings?.enabled!==1||settings.security_confirmed!==1||!['submitted','authorized'].includes(intent.state)||
  tx.type!=='DEBIT'||decimal(tx.value)!==BigInt(intent.amount_cents)||tx.finality||tx.scheduledDate||
  (tx.changeValue!=null&&decimal(tx.changeValue)!==0n)||(tx.refundedValue!=null&&decimal(tx.refundedValue)!==0n)||
  !receiverMatches(tx.externalAccount?.cpfCnpj,intent.receiver_document))return answer('REFUSED');
 const current=await profileFor(env,intent.supplier_id);
 const validBill=await loadSupplierBillingForAudit(env,{orderId:intent.order_id,billingId:intent.billing_id});
 const order=await env.DB.prepare('SELECT id,status,items_json,payment_id,total FROM orders WHERE id=?').bind(intent.order_id).first();
 const reference=await loadSharedSupplierCosts(env,order);
 let submitted;try{submitted=JSON.parse(intent.reference_json);}catch{return answer('REFUSED');}
 if(!current||current.revision!==intent.profile_revision||!validBill||!reference||submitted.customerPaymentId!==order?.payment_id||!['paid_supplier_pending','supplier_preparing'].includes(order?.status))return answer('REFUSED');
 const charge=await bank(env,'/payments/'+encodeURIComponent(order.payment_id),{request:providerRequest});
 if(charge?.id!==order.payment_id||charge.externalReference!==order.id||charge.status!=='RECEIVED'||charge.deleted!==false||charge.chargeback||
  (charge.refunds!=null&&(!Array.isArray(charge.refunds)||charge.refunds.length))||decimal(charge.value)!==decimal(order.total))return answer('REFUSED');
 const original=JSON.parse(intent.audit_json),net=decimal(charge.netValue),other=decimal(original.valoresBrl.outrosCustos);
 if(net===null||other===null||net>decimal(charge.value)||net<=BigInt(intent.reserved_cents)+other)return answer('REFUSED');
 const authorized=await env.DB.prepare("UPDATE supplier_payout_intents SET state='authorized',authorization_at=COALESCE(authorization_at,?),next_poll_at=NULL,updated_at=? WHERE id=? AND state IN ('submitted','authorized') AND NOT EXISTS(SELECT 1 FROM supplier_paid_order_records WHERE order_id=?) AND NOT EXISTS(SELECT 1 FROM supplier_jobs WHERE order_id=? AND status='supplier_paid') AND EXISTS(SELECT 1 FROM supplier_payout_settings WHERE id=1 AND enabled=1 AND security_confirmed=1) AND EXISTS(SELECT 1 FROM supplier_payout_profiles WHERE supplier_id=? AND revision=? AND json_extract(profile_json,'$.validUntil')>?) AND EXISTS(SELECT 1 FROM orders WHERE id=? AND payment_id=? AND status IN ('paid_supplier_pending','supplier_preparing') AND total=?) AND EXISTS(SELECT 1 FROM supplier_billing_messages b WHERE b.id=? AND b.seq=(SELECT MAX(n.seq) FROM supplier_billing_messages n WHERE n.order_id=b.order_id AND n.supplier_id=b.supplier_id)) AND EXISTS(SELECT 1 FROM supplier_dispatch d JOIN supplier_contacts c ON c.supplier_id=d.supplier_id WHERE d.order_id=? AND d.supplier_id=? AND d.supplier_phone=? AND c.phone_e164=d.supplier_phone AND c.authorized=1)")
  .bind(instant(),instant(),intent.id,intent.order_id,intent.order_id,intent.supplier_id,intent.profile_revision,instant(),order.id,order.payment_id,order.total,intent.billing_id,intent.order_id,intent.supplier_id,intent.supplier_phone).run();
 if(!authorized.meta?.changes)return answer('REFUSED');
 return answer('APPROVED');
}
