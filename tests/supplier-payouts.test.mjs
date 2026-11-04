import test from 'node:test';
import assert from 'node:assert/strict';
import {localD1} from './support/local-d1.mjs';
import {pixFixture} from './support/pix-fixture.mjs';
import {collectSupplierBilling} from '../worker/supplier-billing.js';
import {recordSharedSupplierCostReference,configureSharedSupplierCosts,SUPPLIER_COST_VERSION} from '../worker/supplier-cost-reference.js';
import {enqueueLocalGroup} from '../worker/local-orders.js';
import {handleSupplierPayoutAction,handlePayoutAuthorization,processSupplierPayouts,supplierPayoutStatus,normalizePayoutProfile,receiverMatches} from '../worker/supplier-payouts.js';
import worker from '../worker/index.js';
import {handleLocalWhatsApp} from '../worker/local-whatsapp.js';

const id='1234abcd-1234-4234-8234-123456789012',phone='8613800138001',receiver='00000000000100';
const transactionId='11111111-2222-4333-8444-555555555555';
const merchant={legalName:'Empresa de teste',cnpj:'11.222.333/0001-81',address:'Rua Exemplo, 123',email:'store@example.invalid',shippingBrl:0,deliveryMinDays:15,deliveryMaxDays:45,customerPaysImportTaxes:true};
const one=(query,sql,args=[])=>query({sql,args}).results[0];
const profile=changes=>({receiverCpfCnpj:receiver,exchangeRateMode:'fixed',exchangeRateBrlPerUsd:'5.12',gatewayFeeBrl:'0.00',
 otherCostsBrlPerOrder:'5.00',otherCostsBrlPerUnit:'0.00',salesCostRate:'0',validUntil:new Date(Date.now()+3600000).toISOString(),...changes});

async function fixture(t,{enabled=true,withProfile=true,withRate=true,profileChanges={},quotedUsd="15.00",quantity=1}={}){
 const {db,query}=localD1(t),calls=[],posts=[];
 const env={DB:db,WA_LOCAL_BRIDGE_TOKEN:'fake-private-bridge-token-with-more-than-32-characters',WA_TRANSPORT:'local',WA_LOCAL_ORDERS_ENABLED:'true',WA_AUTOMATION_ENABLED:'true',
  ASAAS_SANDBOX:'false',SALES_ENABLED:'true',PAYMENTS_PRODUCTION_ENABLED:'true',CUSTOMER_PAYS_IMPORT_TAXES:'true',IMPORT_TAX_DISCLOSURE_APPROVED:'true',IMPORT_COMPLIANCE_APPROVED:'true',
  ASAAS_PRODUCTION_API_KEY:'fake-production-api-key',ASAAS_PRODUCTION_WEBHOOK_TOKEN:'fake-customer-webhook-token',ASAAS_SUPPLIER_PAYOUT_AUTH_TOKEN:'fake_payout_authorization_token_1234567890',STORE_PUBLIC_URL:'https://lojastreetball.com.br',
  ASSETS:{async fetch(){return Response.json(merchant);}}};
 const stamp=new Date().toISOString(),quotedBrl=(Number(quotedUsd)*5.12).toFixed(2);
 for(let n=1;n<=5;n++){
  query({sql:'INSERT INTO supplier_directory(id,display_name,created_at,updated_at) VALUES(?,?,?,?)',args:['supplier'+n,'Fornecedor '+n,stamp,stamp]});
  query({sql:'INSERT INTO supplier_contacts(supplier_id,phone_e164,authorized,updated_at) VALUES(?,?,1,?)',args:['supplier'+n,'861380013800'+n,stamp]});
 }
 await configureSharedSupplierCosts(env,SUPPLIER_COST_VERSION);
 query({sql:'INSERT INTO wa_local_bridge(id,account_jid,heartbeat_at) VALUES(1,?,?)',args:['5511999999999@s.whatsapp.net',stamp]});
 const bank={decodeType:'DYNAMIC',balance:500,payResponseStatus:'AWAITING_REQUEST',payError:false,fee:1.99,transactionStatus:'AWAITING_REQUEST',transactionValue:Number(quotedBrl),transactionReceiver:receiver,
  receiptUrl:'https://www.asaas.com/comprovantes/ficticio',chargeStatus:'RECEIVED',chargeRefunds:[],accountApproved:true};
 const charges=new Map();
 const seedOrder=async(orderId=id,paymentId='pay_fake',context='ORDER_REFERENCE',withFx=withRate)=>{
  const items=[{id:'p',qty:quantity,size:'P',patch:false,personalize:false}];
  query({sql:'INSERT INTO orders(id,created_at,updated_at,status,name,email,phone,cpf,zip,address,city,state,items_json,subtotal,shipping,total,payment_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',args:[orderId,stamp,stamp,'paid_supplier_pending','Teste','test@example.invalid','11999999999','00000000000','00000000','Rua Exemplo','São Paulo','SP',JSON.stringify(items),199.9,0,199.9,paymentId]});
  query({sql:'INSERT INTO order_payment_environments(order_id,environment,payment_id,received_at,recorded_at) VALUES(?,?,?,?,?)',args:[orderId,'production',paymentId,stamp,stamp]});
  query({sql:'INSERT INTO supplier_jobs(id,order_id,status,created_at,updated_at) VALUES(?,?,?,?,?)',args:['job-'+orderId,orderId,'supplier_payment_pending',stamp,stamp]});
  query({sql:"INSERT INTO supplier_dispatch(order_id,supplier_id,supplier_phone,state,message_id,details_sent_at,created_at,updated_at) VALUES(?,?,?,'details_sent',?,?,?,?)",args:[orderId,'supplier1',phone,context,stamp,stamp,stamp]});
  await recordSharedSupplierCostReference(env,orderId,items,[{id:'p',kind:'fan',sizes:['P']}]);
  const pix=pixFixture({value:quotedBrl}),text='Total USD: '+quotedUsd+'\nTotal BRL: '+quotedBrl+'\n'+(withFx?'Câmbio BRL por USD: 5.12\n':'')+pix;
  await collectSupplierBilling(env,{id:'BILL-'+orderId,from:phone,type:'text',context:{id:context},text:{body:text}},{enqueue:enqueueLocalGroup,productionReceipt:async()=>true});
  charges.set(paymentId,{id:paymentId,externalReference:orderId,value:199.9,netValue:197.91,deleted:false});
  return {pix,bill:one(query,'SELECT * FROM supplier_billing_messages WHERE order_id=? ORDER BY seq DESC',[orderId])};
 };
 const initial=await seedOrder();
 if(withProfile)await handleSupplierPayoutAction('profile',env,{supplierId:'supplier1',expectedRevision:0,profile:profile(profileChanges)});
 if(enabled)query({sql:'UPDATE supplier_payout_settings SET enabled=1,security_confirmed=1 WHERE id=1'});
 const request=async(url,options)=>{
  const u=new URL(url);assert.equal(u.origin,'https://api.asaas.com');assert.equal(options.headers.access_token,env.ASAAS_PRODUCTION_API_KEY);
  assert.equal(options.redirect,'manual');calls.push({url:String(url),method:options.method,body:options.body});
  if(u.pathname==='/v3/myAccount/fees/')return Response.json({transfer:{pix:{feeValue:bank.fee,discountValue:0}}});
  if(u.pathname==='/v3/pix/qrCodes/decode')return Response.json({payload:JSON.parse(options.body).payload,type:bank.decodeType,value:Number(quotedBrl),totalValue:Number(quotedBrl),canBePaid:true,finality:null,receiver:{cpfCnpj:receiver,name:'Recebedor fictício'}});
  if(u.pathname==='/v3/finance/balance')return Response.json({balance:bank.balance});
  if(u.pathname.startsWith('/v3/payments/')){
   const charge=charges.get(u.pathname.split('/').at(-1));assert.ok(charge);return Response.json({...charge,status:bank.chargeStatus,refunds:bank.chargeRefunds});
  }
  if(u.pathname==='/v3/pix/qrCodes/pay'){
   assert.equal(options.method,'POST');const payload=JSON.parse(options.body);posts.push(payload);
   assert.deepEqual(Object.keys(payload).sort(),['description','qrCode','value']);
   assert.deepEqual(Object.keys(payload.qrCode),['payload']);
   if(bank.beforePay)await bank.beforePay();
   if(bank.payError)throw Error('private network failure');
   return Response.json({id:transactionId,status:bank.payResponseStatus});
  }
  if(u.pathname==='/v3/pix/transactions/'+transactionId){assert.equal(options.method,'GET');assert.equal(options.body,undefined);
   return Response.json({id:transactionId,type:'DEBIT',description:bank.transactionDescription??posts[0]?.description,status:bank.transactionStatus,value:bank.transactionValue,chargedFeeValue:bank.fee,externalAccount:{cpfCnpj:bank.transactionReceiver},transactionReceiptUrl:bank.receiptUrl});}
  if(u.pathname==='/v3/myAccount/status/')return Response.json({general:bank.accountApproved?'APPROVED':'PENDING'});
  if(u.pathname==='/v3/myAccount/commercialInfo/')return Response.json({cpfCnpj:merchant.cnpj});
  if(u.pathname==='/v3/webhooks')return Response.json({data:[],hasMore:false});
  assert.fail('Unexpected provider endpoint '+u.pathname);
 };
 const process=()=>processSupplierPayouts(env,{request,enqueue:enqueueLocalGroup});
 const authorize=async({token=env.ASAAS_SUPPLIER_PAYOUT_AUTH_TOKEN,changes={},type='PIX_QR_CODE'}={})=>{
  const r=await handlePayoutAuthorization(new Request('https://lojastreetball.com.br/api/webhooks/asaas/supplier-payout-authorization',{
   method:'POST',headers:{'asaas-access-token':token,'content-type':'application/json'},body:JSON.stringify({type,pixQrCode:{id:transactionId,type:'DEBIT',status:'AWAITING_REQUEST',value:76.8,externalAccount:{cpfCnpj:receiver},...changes}})
  }),env,{request});return {httpStatus:r.status,...await r.json()};
 };
 return {env,query,calls,posts,bank,charges,seedOrder,request,process,authorize,...initial};
}

test('profiles require an explicit FX policy, every expense and a current validity instead of guessing values',()=>{
 assert.equal(normalizePayoutProfile(profile()).exchangeRateBrlPerUsd,'5.12');
 assert.equal(normalizePayoutProfile(profile({exchangeRateMode:'supplier_quote',exchangeRateBrlPerUsd:null})).exchangeRateBrlPerUsd,null);
 for(const change of [{exchangeRateMode:undefined},{gatewayFeeBrl:undefined},{otherCostsBrlPerUnit:undefined},{salesCostRate:'1.01'},
  {exchangeRateBrlPerUsd:'5,12'},{validUntil:'2020-01-01T00:00:00Z'},{receiverCpfCnpj:'***123456**'},{maxDailyBrl:'1000'}])assert.throws(()=>normalizePayoutProfile(profile(change)));
 assert.equal(receiverMatches('***.123.456-**','00012345600'),true);assert.equal(receiverMatches('***.123.457-**','00012345600'),false);
 assert.equal(receiverMatches('*********00','00012345600'),false);
});

test('disabled settings, missing authorization token and Sandbox cannot submit a payment',async t=>{
 const f=await fixture(t,{enabled:false});await f.process();assert.equal(f.posts.length,0);assert.equal(f.calls.length,0);
 f.query({sql:'UPDATE supplier_payout_settings SET enabled=1,security_confirmed=1'});delete f.env.ASAAS_SUPPLIER_PAYOUT_AUTH_TOKEN;
 await f.process();assert.equal(f.posts.length,0);f.env.ASAAS_SANDBOX='true';await f.process();assert.equal(f.posts.length,0);
});

test('automatic submission uses recorded shared costs, one exclusive intent and the documented bank request',async t=>{
 const f=await fixture(t);await Promise.all([f.process(),f.process()]);
 assert.equal(f.posts.length,1);assert.equal(f.posts[0].value,76.8);assert.equal(f.posts[0].qrCode.payload,f.pix);
 const row=one(f.query,'SELECT * FROM supplier_payout_intents');assert.equal(row.state,'submitted');assert.equal(row.transaction_id,transactionId);assert.equal(row.amount_cents,7680);assert.equal(row.reserved_cents,7879);
 assert.equal(JSON.parse(row.audit_json).referenciaCustos.origem,'tabela_compartilhada_do_pedido');
 assert.equal(one(f.query,"SELECT COUNT(*) AS count FROM wa_local_groups WHERE purpose='supplier_payment_receipt'").count,0);
 await f.process();assert.equal(f.posts.length,1);assert.notEqual(one(f.query,'SELECT state FROM supplier_payout_intents').state,'paid');
});

test('authorization and a separate DONE lookup precede the paid status and the single queued receipt',async t=>{
 const f=await fixture(t);await f.process();assert.equal((await f.authorize()).status,'APPROVED');
 f.bank.transactionStatus='DONE';await f.process();
 assert.equal(one(f.query,'SELECT state FROM supplier_payout_intents').state,'paid');assert.equal(one(f.query,'SELECT status FROM supplier_jobs').status,'supplier_paid');
 assert.equal((await supplierPayoutStatus(f.env)).latest.resultAfterRecordedCostsBrl,'114.12');
 const receipt=one(f.query,"SELECT * FROM wa_local_groups WHERE purpose='supplier_payment_receipt'");assert.ok(receipt);assert.equal(receipt.recipient_jid,phone+'@s.whatsapp.net');
 assert.match(one(f.query,'SELECT payload_json FROM wa_local_outbox WHERE group_id=?',[receipt.id]).payload_json,/www.asaas.com\/comprovantes/);
 await f.process();assert.equal(f.posts.length,1);assert.equal(one(f.query,"SELECT COUNT(*) AS count FROM wa_local_groups WHERE purpose='supplier_payment_receipt'").count,1);
});

test('an initial DONE response is never the final proof, and missing authorization is detected after real confirmation',async t=>{
 const f=await fixture(t);f.bank.payResponseStatus='DONE';await f.process();assert.equal(one(f.query,'SELECT state FROM supplier_payout_intents').state,'submitted');
 f.bank.transactionStatus='DONE';await f.process();
 assert.equal(one(f.query,'SELECT state FROM supplier_payout_intents').state,'paid');assert.equal((await supplierPayoutStatus(f.env)).enabled,false);
 assert.match(one(f.query,'SELECT last_error FROM supplier_payout_intents').last_error,/sem autorização/);
});

test('a timeout or a restart after submission never causes a second debit, including with a new bill for that order',async t=>{
 const f=await fixture(t);f.bank.payError=true;await f.process();assert.equal(f.posts.length,1);assert.equal(one(f.query,'SELECT state FROM supplier_payout_intents').state,'unknown');
 await f.process();assert.equal(f.posts.length,1);
 f.query({sql:"UPDATE supplier_payout_intents SET state='submitting',updated_at=?",args:[new Date(Date.now()-180000).toISOString()]});
 await f.process();assert.equal(f.posts.length,1);assert.equal(one(f.query,'SELECT state FROM supplier_payout_intents').state,'unknown');
});

test('unsettled/refunded receipts, revoked supplier permission and missing immutable references prevent bank submission',async t=>{
 const f=await fixture(t);f.bank.chargeStatus='CONFIRMED';await f.process();assert.equal(f.posts.length,0);
 f.bank.chargeStatus='RECEIVED';f.bank.chargeRefunds=[{id:'refund-fake'}];f.query({sql:'DELETE FROM supplier_payout_checks'});await f.process();assert.equal(f.posts.length,0);
 f.bank.chargeRefunds=[];f.query({sql:'DELETE FROM supplier_payout_checks'});f.query({sql:'UPDATE supplier_contacts SET authorized=0 WHERE supplier_id=?',args:['supplier1']});await f.process();assert.equal(f.posts.length,0);
 f.query({sql:'UPDATE supplier_contacts SET authorized=1 WHERE supplier_id=?',args:['supplier1']});f.query({sql:'DELETE FROM supplier_order_cost_references'});await f.process();assert.equal(f.posts.length,0);
});

test('composite recurring QR codes and insufficient unreserved balance never become outgoing payments',async t=>{
 const f=await fixture(t);f.bank.decodeType='COMPOSITE';await f.process();assert.equal(f.posts.length,0);
 f.bank.decodeType='DYNAMIC';f.bank.balance=78.78;f.query({sql:'DELETE FROM supplier_payout_checks'});await f.process();assert.equal(f.posts.length,0);
});

test('an unknown first payment keeps its reservation when another order is checked',async t=>{
 const f=await fixture(t);f.bank.balance=150;f.bank.payError=true;await f.process();assert.equal(f.posts.length,1);
 await f.seedOrder('aabbccdd-1234-4234-8234-123456789012','pay_second','ORDER_SECOND');
 f.bank.payError=false;await f.process();assert.equal(f.posts.length,1);
 assert.match(one(f.query,'SELECT reason FROM supplier_payout_checks ORDER BY updated_at DESC').reason,/saldo/);
});

test('the webhook rejects unknown operations, wrong token/value/payee, revocation and changed quotes',async t=>{
 const f=await fixture(t);await f.process();
 assert.equal((await f.authorize({token:'wrong'})).status,'REFUSED');
 assert.equal((await f.authorize({type:'TRANSFER'})).status,'REFUSED');
 assert.equal((await f.authorize({changes:{value:76.81}})).status,'REFUSED');
 assert.equal((await f.authorize({changes:{externalAccount:{cpfCnpj:'11111111000111'}}})).status,'REFUSED');
 f.query({sql:'UPDATE supplier_contacts SET authorized=0 WHERE supplier_id=?',args:['supplier1']});assert.equal((await f.authorize()).status,'REFUSED');
 f.query({sql:'UPDATE supplier_contacts SET authorized=1 WHERE supplier_id=?',args:['supplier1']});
 f.query({sql:"INSERT INTO supplier_billing_messages(id,inbound_message_id,order_id,supplier_id,supplier_phone,fingerprint,linked,format_json,state,created_at,updated_at) SELECT 'sb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','replacement',order_id,supplier_id,supplier_phone,'changed',linked,format_json,state,created_at,updated_at FROM supplier_billing_messages LIMIT 1"});
 assert.equal((await f.authorize()).status,'REFUSED');assert.equal(f.posts.length,1);
});

test('the webhook rechecks the enable flag after bank reads rather than approving a payment disabled in flight',async t=>{
 const f=await fixture(t);await f.process();
 const request=async(url,options)=>{const r=await f.request(url,options);if(String(url).includes('/payments/'))f.query({sql:'UPDATE supplier_payout_settings SET enabled=0'});return r;};
 const r=await handlePayoutAuthorization(new Request('https://store.example.invalid/api/webhooks/asaas/supplier-payout-authorization',{method:'POST',headers:{'asaas-access-token':f.env.ASAAS_SUPPLIER_PAYOUT_AUTH_TOKEN},body:JSON.stringify({type:'PIX_QR_CODE',pixQrCode:{id:transactionId,type:'DEBIT',value:76.8,externalAccount:{cpfCnpj:receiver}}})}),f.env,{request});
 assert.equal((await r.json()).status,'REFUSED');
});

test('dynamic exchange is an explicit profile choice and a missing quoted rate requests clarification without a debit',async t=>{
 const f=await fixture(t,{withRate:false,profileChanges:{exchangeRateMode:'supplier_quote',exchangeRateBrlPerUsd:null}});await f.process();assert.equal(f.posts.length,0);
 const group=one(f.query,"SELECT * FROM wa_local_groups WHERE purpose='billing_request'");assert.ok(group);
 assert.match(one(f.query,'SELECT payload_json FROM wa_local_outbox WHERE group_id=?',[group.id]).payload_json,/Câmbio BRL por USD/);
});
test('an explicitly accepted quoted exchange is used only when its arithmetic matches the Pix and shared costs',async t=>{
 const f=await fixture(t,{profileChanges:{exchangeRateMode:'supplier_quote',exchangeRateBrlPerUsd:null}});await f.process();assert.equal(f.posts.length,1);
 const row=one(f.query,'SELECT reference_json FROM supplier_payout_intents');assert.equal(JSON.parse(row.reference_json).costs.exchangeRateBrlPerUsd,'5.12');
});

test('profile changes use a revision check and never silently overwrite another operator or start a transfer',async t=>{
 const f=await fixture(t,{enabled:false});
 await assert.rejects(handleSupplierPayoutAction('profile',f.env,{supplierId:'supplier1',expectedRevision:0,profile:profile()}),/outra sessão/);
 const result=await handleSupplierPayoutAction('profile',f.env,{supplierId:'supplier1',expectedRevision:1,profile:profile({gatewayFeeBrl:'1.00'})});
 assert.equal(result.revision,2);assert.equal(f.posts.length,0);assert.equal(result.pagamentoIniciado,false);
});
test('activation requires explicit bank-security configuration and a verified production account; it does not issue a Pix itself',async t=>{
 const f=await fixture(t,{enabled:false});
 await assert.rejects(handleSupplierPayoutAction('enable',f.env,{costPolicyVersion:SUPPLIER_COST_VERSION},{request:f.request}),/Confirme/);
 f.bank.accountApproved=false;await assert.rejects(handleSupplierPayoutAction('enable',f.env,{securityWebhookConfigured:true,costPolicyVersion:SUPPLIER_COST_VERSION},{request:f.request}),/conta Asaas/);
 f.bank.accountApproved=true;const result=await handleSupplierPayoutAction('enable',f.env,{securityWebhookConfigured:true,costPolicyVersion:SUPPLIER_COST_VERSION},{request:f.request});
 assert.equal(result.enabled,true);assert.equal(f.posts.length,0);
 const output=JSON.stringify(result);for(const secret of [f.env.ASAAS_PRODUCTION_API_KEY,f.env.ASAAS_SUPPLIER_PAYOUT_AUTH_TOKEN,f.pix,receiver])assert.ok(!output.includes(secret));
});
test('a larger actual fee is recorded after DONE and stops new payments instead of hiding the real expense or repeating the debit',async t=>{
 const f=await fixture(t);await f.process();assert.equal((await f.authorize()).status,'APPROVED');
 f.bank.fee=150;f.bank.transactionStatus='DONE';await f.process();const status=await supplierPayoutStatus(f.env);
 assert.equal(status.latest.state,'paid');assert.equal(status.latest.actualFeeBrl,'150.00');assert.equal(status.latest.resultAfterRecordedCostsBrl,'-33.89');
 assert.equal(status.enabled,false);assert.equal(one(f.query,'SELECT status FROM supplier_jobs').status,'manual_review');assert.equal(f.posts.length,1);
});
test('a crash while persisting the returned transaction ID retains the exclusive intent and never resubmits it',async t=>{
 const f=await fixture(t),prepare=f.env.DB.prepare.bind(f.env.DB);
 f.env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('UPDATE supplier_payout_intents SET state=CASE WHEN authorization_at')){
  statement.run=async()=>{throw Error('simulated lost acknowledgement');};
 }return statement;};
 await assert.rejects(f.process(),/lost acknowledgement/);assert.equal(f.posts.length,1);
 f.env.DB.prepare=prepare;await f.process();assert.equal(f.posts.length,1);assert.equal(one(f.query,'SELECT state FROM supplier_payout_intents').state,'submitting');
});
test('a conflicting USD total or an expired financial profile cannot be used to release a Pix',async t=>{
 const f=await fixture(t,{profileChanges:{exchangeRateMode:'supplier_quote',exchangeRateBrlPerUsd:null}});
 const envelope=JSON.parse(f.bill.format_json);envelope.quotedTotalUsd='17.01';
 f.query({sql:'UPDATE supplier_billing_messages SET format_json=? WHERE id=?',args:[JSON.stringify(envelope),f.bill.id]});
 await f.process();assert.equal(f.posts.length,0);
 assert.match(one(f.query,'SELECT reason FROM supplier_payout_checks').reason,/total em USD/);
 const saved=one(f.query,'SELECT profile_json FROM supplier_payout_profiles');const expired=JSON.parse(saved.profile_json);expired.validUntil='2020-01-01T00:00:00Z';
 f.query({sql:'UPDATE supplier_payout_profiles SET profile_json=?',args:[JSON.stringify(expired)]});assert.equal((await supplierPayoutStatus(f.env)).ready,false);
});
test('bridge authentication and its bound account protect the financial settings; the public webhook rejects other credentials',async t=>{
 const f=await fixture(t,{enabled:false});
 const request=(token,account)=>new Request('https://lojastreetball.com.br/api/local-whatsapp/orders-payout-enable',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({accountJid:account})});
 assert.equal((await handleLocalWhatsApp(request('wrong','5511999999999@s.whatsapp.net'),f.env)).status,401);
 assert.equal((await handleLocalWhatsApp(request(f.env.WA_LOCAL_BRIDGE_TOKEN,'5511888888888@s.whatsapp.net'),f.env)).status,409);
 assert.equal(one(f.query,'SELECT enabled FROM supplier_payout_settings').enabled,0);
 const webhook=await worker.fetch(new Request('https://lojastreetball.com.br/api/webhooks/asaas/supplier-payout-authorization',{method:'POST',headers:{'asaas-access-token':'wrong'},body:'{}'}),f.env);
 assert.equal(webhook.status,403);assert.equal(f.posts.length,0);assert.equal(f.calls.length,0);
});
test('reapplying the additive migration preserves explicit activation and the exclusive payment history',async t=>{
 const f=await fixture(t);await f.process();
 const {readFileSync}=await import('node:fs');
 f.query({schema:readFileSync(new URL('../worker/local-orders-schema.sql',import.meta.url),'utf8')});
 assert.equal(one(f.query,'SELECT enabled FROM supplier_payout_settings').enabled,1);
 assert.equal(one(f.query,'SELECT COUNT(*) AS count FROM supplier_payout_intents').count,1);
 await f.process();assert.equal(f.posts.length,1);
});

const markSupplierStatus=(f,status)=>{
 f.env.ADMIN_TOKEN='fake-admin-token';
 return worker.fetch(new Request('https://lojastreetball.com.br/api/admin/supplier-status',{method:'POST',headers:{authorization:'Bearer '+f.env.ADMIN_TOKEN,'content-type':'application/json'},body:JSON.stringify({orderId:id,status})}),f.env);
};
test('a recorded manual payment survives late billing and later status changes without an automatic debit',async t=>{
 const f=await fixture(t);assert.equal((await markSupplierStatus(f,'supplier_paid')).status,200);
 assert.equal(one(f.query,'SELECT source FROM supplier_paid_order_records').source,'manual');
 await collectSupplierBilling(f.env,{id:'LATE_BILL',from:phone,type:'text',context:{id:'ORDER_REFERENCE'},text:{body:'Total USD: 15.00\nTotal BRL: 76.80\nCâmbio BRL por USD: 5.12\n'+f.pix}},{enqueue:enqueueLocalGroup,productionReceipt:async()=>true});
 assert.equal(one(f.query,'SELECT status FROM supplier_jobs').status,'supplier_paid');
 await markSupplierStatus(f,'manual_review');await f.process();assert.equal(f.posts.length,0);
 assert.equal(one(f.query,'SELECT COUNT(*) AS count FROM supplier_payout_intents').count,0);
});
test('migration preserves payments recorded by the previous version as a durable manual-payment guard',async t=>{
 const f=await fixture(t);f.query({sql:"UPDATE supplier_jobs SET status='supplier_paid'"});
 const {readFileSync}=await import('node:fs');f.query({schema:readFileSync(new URL('../worker/local-orders-schema.sql',import.meta.url),'utf8')});
 assert.equal(one(f.query,'SELECT source FROM supplier_paid_order_records').source,'manual');
 await markSupplierStatus(f,'manual_review');await f.process();assert.equal(f.posts.length,0);
});
test('a pending bank operation prevents marking a separate manual payment and cannot authorize against a paid-order guard',async t=>{
 const f=await fixture(t);await f.process();assert.equal((await markSupplierStatus(f,'supplier_paid')).status,409);
 assert.equal(one(f.query,'SELECT COUNT(*) AS count FROM supplier_paid_order_records').count,0);
 f.query({sql:"INSERT INTO supplier_paid_order_records(order_id,source,recorded_at) VALUES(?,'manual',?)",args:[id,new Date().toISOString()]});
 assert.equal((await f.authorize()).status,'REFUSED');assert.equal(f.posts.length,1);
});
test('a lost POST response can be linked by the verified bank callback nonce without a second request',async t=>{
 const f=await fixture(t);f.bank.payError=true;await f.process();
 const result=await f.authorize({changes:{description:f.posts[0].description}});assert.equal(result.status,'APPROVED');
 assert.equal(one(f.query,'SELECT transaction_id FROM supplier_payout_intents').transaction_id,transactionId);
 f.bank.transactionStatus='DONE';await f.process();assert.equal(one(f.query,'SELECT state FROM supplier_payout_intents').state,'paid');assert.equal(f.posts.length,1);
});
test('authorization recovered while POST is awaiting its response is preserved even if that response times out',async t=>{
 const f=await fixture(t);f.bank.payError=true;
 f.bank.beforePay=async()=>assert.equal((await f.authorize({changes:{description:f.posts[0].description}})).status,'APPROVED');
 await f.process();const row=one(f.query,'SELECT * FROM supplier_payout_intents');
 assert.equal(row.state,'authorized');assert.equal(row.transaction_id,transactionId);assert.ok(row.authorization_at);assert.equal(f.posts.length,1);
});
test('manual recovery only reads the bank and requires its exact intent nonce, amount and receiver',async t=>{
 const f=await fixture(t);f.bank.payError=true;await f.process();const intent=one(f.query,'SELECT * FROM supplier_payout_intents');
 f.bank.transactionDescription='another operation';
 await assert.rejects(handleSupplierPayoutAction('resolve',f.env,{intentId:intent.id,transactionId},{request:f.request}),/referência exclusiva/);
 assert.equal(one(f.query,'SELECT transaction_id FROM supplier_payout_intents').transaction_id,null);
 f.bank.transactionDescription=f.posts[0].description;
 const result=await handleSupplierPayoutAction('resolve',f.env,{intentId:intent.id,transactionId},{request:f.request});
 assert.equal(result.consultaSomenteLeituraNoAsaas,true);assert.equal(result.novoPagamentoSolicitado,false);
 assert.equal(one(f.query,'SELECT transaction_id FROM supplier_payout_intents').transaction_id,transactionId);assert.equal(f.posts.length,1);
 assert.equal((await f.authorize()).status,'APPROVED');f.bank.transactionStatus='DONE';await f.process();assert.equal(f.posts.length,1);
});
test('a definitive bank refusal releases the reservation even when no payee detail is returned and never retries',async t=>{
 const f=await fixture(t);await f.process();f.bank.transactionStatus='REFUSED';f.bank.transactionReceiver=null;f.bank.transactionValue=null;
 await f.process();assert.equal(one(f.query,'SELECT state FROM supplier_payout_intents').state,'refused');
 await f.process();assert.equal(f.posts.length,1);
});
test('a complete connector tick stays within 50 subrequests for both submission and confirmation with a receipt',async t=>{
 const f=await fixture(t),originalFetch=globalThis.fetch,prepare=f.env.DB.prepare.bind(f.env.DB);let used=0;
 const consume=()=>assert.ok(++used<=50,'Worker subrequest budget exceeded');
 f.env.DB.prepare=sql=>{consume();return prepare(sql);};globalThis.fetch=(...args)=>{consume();return f.request(...args);};
 const tick=async()=>{
  used=0;const pending=[];
  const response=await worker.fetch(new Request('https://lojastreetball.com.br/api/local-whatsapp/claim',{method:'POST',headers:{authorization:'Bearer '+f.env.WA_LOCAL_BRIDGE_TOKEN,'content-type':'application/json'},body:JSON.stringify({accountJid:'5511999999999@s.whatsapp.net'})}),f.env,{waitUntil(promise){pending.push(promise);}});
  assert.equal(response.status,200);await Promise.all(pending);assert.ok(used<=50);return used;
 };
 try{
  assert.ok(await tick());assert.equal(f.posts.length,1);
  used=0;assert.equal((await f.authorize()).status,'APPROVED');f.bank.transactionStatus='DONE';
  assert.ok(await tick());assert.equal(one(f.query,'SELECT state FROM supplier_payout_intents').state,'paid');
  assert.ok(one(f.query,'SELECT receipt_group_id FROM supplier_payout_intents').receipt_group_id);assert.equal(f.posts.length,1);
 }finally{globalThis.fetch=originalFetch;f.env.DB.prepare=prepare;}
});

test('the single-unit USD allowance uses the actual quote for conversion, expenses and final bank confirmation',async t=>{
 const f=await fixture(t,{quotedUsd:'17.00'});await f.process();assert.equal(f.posts.length,1);assert.equal(f.posts[0].value,87.04);
 assert.equal((await f.authorize({changes:{value:87.04}})).status,'APPROVED');f.bank.transactionStatus='DONE';await f.process();
 assert.equal((await supplierPayoutStatus(f.env)).latest.resultAfterRecordedCostsBrl,'103.88');
 const a=JSON.parse(one(f.query,'SELECT audit_json FROM supplier_payout_intents').audit_json);
 assert.equal(a.referenciaCustos.totalReferenciaUsd,'15.00');assert.equal(a.referenciaCustos.totalConferidoUsd,'17.00');
});
test('a quote one cent beyond the single-unit allowance is held before any Pix request',async t=>{
 const f=await fixture(t,{quotedUsd:'17.01'});await f.process();assert.equal(f.posts.length,0);
 assert.match(one(f.query,'SELECT reason FROM supplier_payout_checks').reason,/US\$2/);
});

test('two units permit four USD total variation and reconcile using the actual cost',async t=>{
 const f=await fixture(t,{quantity:2,quotedUsd:'29.00'});await f.process();assert.equal(f.posts.length,1);assert.equal(f.posts[0].value,148.48);
 assert.equal((await f.authorize({changes:{value:148.48}})).status,'APPROVED');f.bank.transactionStatus='DONE';await f.process();
 const a=JSON.parse(one(f.query,'SELECT audit_json FROM supplier_payout_intents').audit_json);
 assert.equal(a.referenciaCustos.totalReferenciaUsd,'25.00');assert.equal(a.referenciaCustos.toleranciaPorPecaUsd,'2.00');
 assert.equal(a.referenciaCustos.quantidade,2);assert.equal(a.referenciaCustos.toleranciaTotalUsd,'4.00');
 assert.equal((await supplierPayoutStatus(f.env)).latest.resultAfterRecordedCostsBrl,'42.44');
});
test('two units reject a variation of four USD and one cent before any bank submission',async t=>{
 const f=await fixture(t,{quantity:2,quotedUsd:'29.01'});await f.process();assert.equal(f.posts.length,0);
 assert.match(one(f.query,'SELECT reason FROM supplier_payout_checks').reason,/US\$2 por peça/);
});
