import test from 'node:test';
import assert from 'node:assert/strict';
import {localD1} from './support/local-d1.mjs';
import {handleLocalWhatsApp} from '../worker/local-whatsapp.js';
import {routePaidOrder,handleSupplierInbound,monitorSupplierSLA} from '../worker/fulfillment.js';
import {localOrdersReady,recordPaymentEnvironment,recordPaymentReceipt,hasProductionReceipt} from '../worker/local-orders.js';
import {enqueueLocalGroup} from '../worker/local-orders.js';
import worker from '../worker/index.js';
import {pixFixture} from './support/pix-fixture.mjs';
import {auditSupplierPayment} from '../worker/supplier-payment-audit.js';

const token='fake-local-order-secret-012345678901234567890';
const self='5511999999999@s.whatsapp.net',supplier='8613800138000',second='8613900139000';
const orderId='1234abcd-1234-4234-8234-123456789012';
function envFor(db){return {DB:db,WA_LOCAL_BRIDGE_TOKEN:token,WA_TRANSPORT:'local',WA_LOCAL_ORDERS_ENABLED:'true',WA_AUTOMATION_ENABLED:'true',ASAAS_SANDBOX:'false',
 PAYMENTS_PRODUCTION_ENABLED:'true',SALES_ENABLED:'true',CUSTOMER_PAYS_IMPORT_TAXES:'true',IMPORT_TAX_DISCLOSURE_APPROVED:'true',IMPORT_COMPLIANCE_APPROVED:'true',STORE_PUBLIC_URL:'https://loja.example',
 ASSETS:{async fetch(request){
  if(new URL(request.url).pathname==='/whatsapp-preview.json')return Response.json({id:'demo',title:'Camisa Clube Exemplo',image:'/images/demo.webp'});
  return Response.json([{id:'demo',title:'Camisa Clube Exemplo',image:'/images/demo.webp'}]);
 }}};}
async function request(env,action,data={}){
 const r=await handleLocalWhatsApp(new Request('https://loja.example/api/local-whatsapp/'+action,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({accountJid:self,...data})}),env,{onInbound:m=>handleSupplierInbound(env,m)});
 return {status:r.status,...await r.json()};
}
function seed(query,{consent=true}={}){
 const t=new Date().toISOString();
 const item={id:'demo',title:'Camisa Clube Exemplo',qty:1,size:'P',image:'/images/demo.webp',personalize:false,patch:false};
 query({sql:'INSERT INTO orders(id,created_at,updated_at,status,name,email,phone,cpf,zip,address,city,state,items_json,subtotal,shipping,total) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',args:[orderId,t,t,'paid_supplier_pending','Comprador Exemplo','example@example.invalid','11888888888','00000000000','00000000','Rua de Teste 123','São Paulo','SP',JSON.stringify([item]),199.9,0,199.9]});
 query({sql:'INSERT INTO supplier_jobs(id,order_id,status,created_at,updated_at) VALUES(?,?,?,?,?)',args:['job-example',orderId,'requires_supplier_routing',t,t]});
 query({sql:'UPDATE orders SET payment_id=? WHERE id=?',args:['pay_fake_production',orderId]});
 query({sql:'INSERT INTO order_payment_environments(order_id,environment,payment_id,received_at,recorded_at) VALUES(?,?,?,?,?)',args:[orderId,'production','pay_fake_production',t,t]});
 for(const [n,p]of [[1,supplier],[2,second]]){
  query({sql:'INSERT INTO supplier_directory(id,display_name,created_at,updated_at) VALUES(?,?,?,?)',args:['supplier'+n,'Fornecedor Exemplo '+n,t,t]});
  query({sql:'INSERT INTO supplier_contacts(supplier_id,phone_e164,authorized,updated_at) VALUES(?,?,1,?)',args:['supplier'+n,p,t]});
  query({sql:'INSERT INTO supplier_priority(supplier_id,rank,updated_at) VALUES(?,?,?)',args:['supplier'+n,n,t]});
 }
 if(consent)query({sql:'INSERT INTO buyer_message_optin(order_id,consented_at) VALUES(?,?)',args:[orderId,t]});
}
const one=(query,sql,args=[])=>query({sql,args}).results[0];
async function sendNext(env,messageId){
 const claimed=await request(env,'orders-claim',{allowLive:true});assert.equal(claimed.status,200);assert.ok(claimed.job);
 const job=claimed.job;
 assert.equal((await request(env,'orders-sending',{jobId:job.id,lease:job.lease})).status,200);
 assert.equal((await request(env,'orders-ack',{jobId:job.id,lease:job.lease,messageId})).status,200);
 return job;
}

test('paid order sends photo, waits for actual sends, links replies and queues buyer update with consent',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);await request(env,'session');
 assert.equal(await routePaidOrder(env,orderId),true);
 let d=one(query,'SELECT * FROM supplier_dispatch WHERE order_id=?',[orderId]);
 assert.equal(d.state,'queued_local');assert.equal(d.sent_at,null);
 const stock=await sendNext(env,'REMOTE_STOCK_QUERY');
 assert.equal(stock.recipientJid,supplier+'@s.whatsapp.net');assert.equal(stock.payload.type,'image');
 assert.match(stock.payload.image.caption,/apenas 1 unidade/);assert.ok(!stock.payload.image.caption.includes('Comprador Exemplo'));assert.ok(!stock.payload.image.caption.includes('Rua de Teste'));
 assert.equal(one(query,'SELECT state FROM supplier_dispatch WHERE order_id=?',[orderId]).state,'awaiting_reply');
 assert.equal((await request(env,'orders-inbound',{messageId:'REPLY_AVAILABLE',fromJid:supplier+'@s.whatsapp.net',contextId:'REMOTE_STOCK_QUERY',text:'sim'})).status,200);
 d=one(query,'SELECT * FROM supplier_dispatch WHERE order_id=?',[orderId]);assert.equal(d.state,'details_queued_local');assert.equal(d.details_sent_at,null);
 const header=await sendNext(env,'REMOTE_ORDER_HEADER');assert.match(header.payload.text.body,/Rua de Teste/);assert.ok(!header.payload.text.body.includes('00000000000'));
 assert.equal(one(query,'SELECT details_sent_at FROM supplier_dispatch WHERE order_id=?',[orderId]).details_sent_at,null);
 await sendNext(env,'REMOTE_ORDER_PHOTO');
 assert.equal(one(query,'SELECT state FROM supplier_dispatch WHERE order_id=?',[orderId]).state,'details_sent');
 const confirm={messageId:'REPLY_CONFIRM_ORDER',fromJid:supplier+'@s.whatsapp.net',contextId:'REMOTE_ORDER_PHOTO',text:'confirmar 1234abcd'};
 assert.equal((await request(env,'orders-inbound',confirm)).status,200);
 assert.equal(one(query,'SELECT status FROM orders WHERE id=?',[orderId]).status,'supplier_preparing');
 assert.equal(one(query,'SELECT state FROM buyer_notifications WHERE order_id=?',[orderId]).state,'queued_local');
 const buyer=await sendNext(env,'REMOTE_BUYER_UPDATE');assert.equal(buyer.recipientJid,'5511888888888@s.whatsapp.net');
 assert.equal(one(query,'SELECT state FROM buyer_notifications WHERE order_id=?',[orderId]).state,'sent');
 assert.equal((await request(env,'orders-inbound',confirm)).duplicate,true);
 assert.equal((await request(env,'orders-claim',{allowLive:true})).job,null);
});
test('negative reply queries the next registered supplier and a late first-supplier reply cannot affect it',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);await request(env,'session');await routePaidOrder(env,orderId);await sendNext(env,'FIRST_SUPPLIER_QUERY');
 await request(env,'orders-inbound',{messageId:'FIRST_NO_STOCK',fromJid:supplier+'@s.whatsapp.net',contextId:'FIRST_SUPPLIER_QUERY',text:'não'});
 const next=await sendNext(env,'SECOND_SUPPLIER_QUERY');assert.equal(next.recipientJid,second+'@s.whatsapp.net');
 await request(env,'orders-inbound',{messageId:'FIRST_LATE_YES',fromJid:supplier+'@s.whatsapp.net',contextId:'FIRST_SUPPLIER_QUERY',text:'sim'});
 const d=one(query,'SELECT * FROM supplier_dispatch WHERE order_id=?',[orderId]);assert.equal(d.supplier_phone,second);assert.equal(d.state,'awaiting_reply');
});
test('production gates block real queries and multi-model orders remain in review',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);env.ASAAS_SANDBOX='true';
 assert.equal(localOrdersReady(env),false);assert.equal(await routePaidOrder(env,orderId),false);
 assert.equal(one(query,'SELECT COUNT(*) AS count FROM wa_local_outbox').count,0);
 env.ASAAS_SANDBOX='false';
 const item={id:'a',title:'Exemplo',qty:1,size:'P',image:'/images/demo.webp'};
 query({sql:'UPDATE orders SET items_json=? WHERE id=?',args:[JSON.stringify([item,{...item,id:'b'}]),orderId]});
 assert.equal(await routePaidOrder(env,orderId),false);assert.equal(one(query,'SELECT state FROM supplier_dispatch WHERE order_id=?',[orderId]).state,'needs_review');
});
test('client preview mode cannot claim live customer jobs',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);await request(env,'session');await routePaidOrder(env,orderId);
 assert.equal((await request(env,'orders-claim',{allowLive:false})).job,null);
 assert.ok((await request(env,'orders-claim',{allowLive:true})).job);
});
test('revoked supplier authorization prevents transmission and uncertain sends never replay',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);await request(env,'session');await routePaidOrder(env,orderId);
 const {job}=await request(env,'orders-claim',{allowLive:true});
 query({sql:'UPDATE supplier_contacts SET authorized=0 WHERE supplier_id=?',args:['supplier1']});
 assert.equal((await request(env,'orders-sending',{jobId:job.id,lease:job.lease})).status,409);
 await request(env,'orders-uncertain',{jobId:job.id,lease:job.lease});
 assert.equal((await request(env,'orders-claim',{allowLive:true})).job,null);
 assert.equal(one(query,'SELECT state FROM supplier_dispatch WHERE order_id=?',[orderId]).state,'needs_review');
});
test('photo preview and quoted own-account reply do not create orders or contact suppliers',async t=>{
 const {db,query}=localD1(t),env=envFor(db);env.ASAAS_SANDBOX='true';env.WA_LOCAL_ORDERS_ENABLED='false';await request(env,'session');
 assert.equal((await request(env,'orders-preview')).status,200);
 const job=await sendNext(env,'PREVIEW_PHOTO_MESSAGE');assert.equal(job.preview,true);assert.equal(job.recipientJid,self);
 const reply=await request(env,'orders-inbound',{messageId:'PREVIEW_REPLY_YES',fromJid:self,contextId:'PREVIEW_PHOTO_MESSAGE',text:'sim'});
 assert.equal(reply.preview,true);assert.equal(reply.kind,'available');
 assert.equal((await request(env,'orders-status')).latestPreview.reply.kind,'available');
 assert.equal(one(query,'SELECT COUNT(*) AS count FROM orders').count,0);
 assert.equal(one(query,'SELECT COUNT(*) AS count FROM supplier_dispatch').count,0);
});
test('12-hour fallback and 72-hour apology use actual send time and buyer consent',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);await request(env,'session');await routePaidOrder(env,orderId);await sendNext(env,'SLA_FIRST_QUERY');
 query({sql:'UPDATE supplier_dispatch SET sent_at=?,created_at=? WHERE order_id=?',args:[new Date(Date.now()-13*3600e3).toISOString(),new Date(Date.now()-14*3600e3).toISOString(),orderId]});
 await monitorSupplierSLA(env);assert.equal(one(query,'SELECT supplier_phone FROM supplier_dispatch WHERE order_id=?',[orderId]).supplier_phone,second);
 query({sql:'UPDATE supplier_dispatch SET created_at=? WHERE order_id=?',args:[new Date(Date.now()-73*3600e3).toISOString(),orderId]});
 await monitorSupplierSLA(env);
 assert.equal(one(query,'SELECT state FROM supplier_dispatch WHERE order_id=?',[orderId]).state,'deadline_review');
 assert.equal(one(query,'SELECT state FROM buyer_delay_notifications WHERE order_id=?',[orderId]).state,'queued_local');
 const apology=await sendNext(env,'SLA_BUYER_APOLOGY');assert.match(apology.payload.text.body,/desculpas/);
});
test('a failed SQL batch cannot leave a deliverable message without its tracking',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);
 const batch=db.batch.bind(db);db.batch=statements=>batch([...statements,db.prepare('INSERT INTO nonexistent_table(x) VALUES(1)')]);
 assert.equal(await routePaidOrder(env,orderId),false);
 assert.equal(one(query,'SELECT COUNT(*) AS count FROM wa_local_groups').count,0);
 assert.equal(one(query,'SELECT COUNT(*) AS count FROM wa_local_outbox').count,0);
 assert.equal(one(query,'SELECT state FROM supplier_dispatch WHERE order_id=?',[orderId]).state,'needs_review');
});
test('old simulated or untracked paid orders cannot become live supplier requests after switching environments',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);
 query({sql:"UPDATE order_payment_environments SET environment='sandbox' WHERE order_id=?",args:[orderId]});
 assert.equal(await hasProductionReceipt(env,orderId),false);assert.equal(await routePaidOrder(env,orderId),false);
 query({sql:'DELETE FROM order_payment_environments WHERE order_id=?',args:[orderId]});
 assert.equal(await routePaidOrder(env,orderId),false);
 assert.equal(one(query,'SELECT COUNT(*) AS count FROM wa_local_outbox').count,0);
 env.ASAAS_SANDBOX='true';await recordPaymentEnvironment(env,orderId);await recordPaymentReceipt(env,orderId,'pay_fake_production');
 env.ASAAS_SANDBOX='false';await recordPaymentReceipt(env,orderId,'pay_fake_production');
 assert.equal(await hasProductionReceipt(env,orderId),false);
});
test('buyer notifications require recorded consent even for a paid production order',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query,{consent:false});
 query({sql:"UPDATE orders SET status='supplier_preparing' WHERE id=?",args:[orderId]});
 await assert.rejects(enqueueLocalGroup(env,'5511888888888',[{type:'text',text:{body:'Order update'}}],{orderId,purpose:'buyer_update'}),/não elegível/);
 assert.equal(one(query,'SELECT COUNT(*) AS count FROM wa_local_outbox').count,0);
});
test('checkout records its environment and only the received-payment webhook releases a local query',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);
 env.ASAAS_PRODUCTION_API_KEY='fake-api-key';env.ASAAS_PRODUCTION_WEBHOOK_TOKEN='fake-webhook-token';env.SHIPPING_FLAT_BRL='0';
 env.ASSETS={async fetch(){return Response.json([{id:'demo',title:'Camisa Clube Exemplo',image:'/images/demo.webp',sizes:['P'],price:199.9,kind:'fan'}]);}};
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
 globalThis.fetch=async (url,options)=>{
  assert.ok(String(url).startsWith('https://api.asaas.com/v3/'));
  assert.equal(options.headers.access_token,env.ASAAS_PRODUCTION_API_KEY);
  if(String(url).endsWith('/customers'))return Response.json({id:'cus_fake'});
  if(String(url).endsWith('/payments'))return Response.json({id:'pay_created_api',invoiceUrl:'https://checkout.example.invalid/pay'});
  throw Error('Unexpected network request');
 };
 const body={paymentMethod:'PIX',whatsappOptIn:true,importTaxAcknowledged:true,items:[{id:'demo',size:'P',qty:1}],customer:{name:'Pessoa Exemplo',email:'person@example.invalid',phone:'11999999999',cpf:'12345678909',zip:'00000000',address:'Rua Exemplo 123',city:'São Paulo',state:'SP'}};
 const checkout=await worker.fetch(new Request('https://loja.example/api/orders',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)}),env);
 const result=await checkout.json();assert.equal(checkout.status,200,JSON.stringify(result));
 assert.equal(one(query,'SELECT environment FROM order_payment_environments WHERE order_id=?',[result.orderId]).environment,'production');
 const post=event=>worker.fetch(new Request('https://loja.example/api/webhooks/asaas',{method:'POST',headers:{'content-type':'application/json','asaas-access-token':env.ASAAS_PRODUCTION_WEBHOOK_TOKEN},body:JSON.stringify({id:'event_'+event,event,payment:{id:'pay_created_api',externalReference:result.orderId,value:199.9}})}),env);
 assert.equal((await post('PAYMENT_CONFIRMED')).status,200);assert.equal(await hasProductionReceipt(env,result.orderId),false);
 assert.equal(one(query,'SELECT COUNT(*) AS count FROM wa_local_outbox').count,0);
 assert.equal((await post('PAYMENT_RECEIVED')).status,200);assert.equal(await hasProductionReceipt(env,result.orderId),true);
 assert.equal(one(query,'SELECT state FROM supplier_dispatch WHERE order_id=?',[result.orderId]).state,'queued_local');
});
test('a reply interrupted after deduplication is surfaced for review without repeating its business action',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);await request(env,'session');await routePaidOrder(env,orderId);await sendNext(env,'INTERRUPTED_QUERY');
 const message='INTERRUPTED_REPLY',id='local:'+supplier+':'+message;
 query({sql:'INSERT INTO wa_message_events(id,order_id,received_at) VALUES(?,?,?)',args:[id,orderId,new Date(Date.now()-60000).toISOString()]});
 query({sql:"INSERT INTO wa_local_reply_receipts(id,state,order_id,received_at) VALUES(?,'processing',?,?)",args:[id,orderId,new Date(Date.now()-40000).toISOString()]});
 query({sql:'UPDATE supplier_dispatch SET updated_at=? WHERE order_id=?',args:[new Date(Date.now()-60000).toISOString(),orderId]});
 const r=await request(env,'orders-inbound',{messageId:message,fromJid:supplier+'@s.whatsapp.net',contextId:'INTERRUPTED_QUERY',text:'sim'});
 assert.equal(r.reviewRequired,true);assert.equal(one(query,'SELECT state FROM supplier_dispatch WHERE order_id=?',[orderId]).state,'needs_review');
 assert.equal(one(query,"SELECT COUNT(*) AS count FROM wa_local_groups WHERE purpose='order_details'").count,0);
});

async function readyForBill(env){
 await request(env,'session');await routePaidOrder(env,orderId);await sendNext(env,'BILL_STOCK_QUERY');
 await request(env,'orders-inbound',{messageId:'BILL_STOCK_YES',fromJid:supplier+'@s.whatsapp.net',contextId:'BILL_STOCK_QUERY',text:'sim'});
 await sendNext(env,'BILL_ORDER_HEADER');await sendNext(env,'BILL_ORDER_PHOTO');
}
const billReply=(messageId,text,extra={})=>({messageId,fromJid:supplier+'@s.whatsapp.net',contextId:'BILL_ORDER_PHOTO',text,...extra});
const auditInput=billingId=>({orderId,billingId,receiverCpfCnpj:'00000000000100',costs:{
 items:[{productId:'demo',qty:1,unitUsd:'11.00'}],freightUsd:'4.00',exchangeRateBrlPerUsd:'5.12',gatewayFeeBrl:'0.00',pixFeeBrl:'1.99',otherCostsBrl:'5.00'}});

test('a provider change requests standardized billing through the real order queue, once per missing-info category',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);await readyForBill(env);
 const body=billReply('NEW_PROVIDER_LINK','Total BRL: 76,80\nhttps://new-provider.example.invalid/anything');
 assert.equal((await request(env,'orders-inbound',body)).status,200);
 assert.equal(one(query,'SELECT state FROM supplier_billing_messages').state,'needs_details');
 assert.equal(one(query,'SELECT status FROM supplier_jobs WHERE order_id=?',[orderId]).status,'supplier_attention');
 const followup=await sendNext(env,'BILL_REQUEST_DETAILS');assert.equal(followup.recipientJid,supplier+'@s.whatsapp.net');
 assert.match(followup.payload.text.body,/Pix Copia e Cola/);assert.match(followup.payload.text.body,/1234abcd/);
 assert.equal((await request(env,'orders-inbound',body)).duplicate,true);
 await request(env,'orders-inbound',billReply('OTHER_PROVIDER_LINK','https://another-provider.example.invalid/changed'));
 assert.equal(one(query,"SELECT COUNT(*) AS count FROM wa_local_groups WHERE purpose='billing_request'").count,1);
 assert.equal((await request(env,'orders-claim',{allowLive:true})).job,null);
 assert.equal(one(query,'SELECT status FROM orders WHERE id=?',[orderId]).status,'paid_supplier_pending');
});

test('a long complete bill is preserved and the audit reads its current evidence without fetching supplier pages or paying',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);await readyForBill(env);
 const pix=pixFixture(),text='COBRANÇA 1234abcd\nTotal USD: 15.00\nTotal BRL: 76,80\n'+('Descrição fictícia do orçamento. '.repeat(20))+'\nPix: '+pix;
 assert.ok(text.length>400);
 await request(env,'orders-inbound',billReply('COMPLETE_LONG_BILL',text));
 const evidence=one(query,'SELECT * FROM supplier_billing_messages');assert.equal(evidence.state,'ready_for_check');
 assert.equal(JSON.parse(evidence.format_json).pixPayload,pix);
 env.ASAAS_PRODUCTION_API_KEY='fake-key';const calls=[];
 const provider=async(url,options)=>{
  calls.push(String(url));assert.equal(options.redirect,'error');
  if(String(url).endsWith('/payments/pay_fake_production'))return Response.json({id:'pay_fake_production',externalReference:orderId,value:199.9,netValue:197.91,status:'RECEIVED',deleted:false,refunds:[]});
  if(String(url).endsWith('/finance/balance'))return Response.json({balance:500});
  if(String(url).endsWith('/pix/qrCodes/decode')){
   assert.deepEqual(JSON.parse(options.body),{payload:pix});return Response.json({payload:pix,value:76.8,totalValue:76.8,canBePaid:true,receiver:{cpfCnpj:'00000000000100'}});
  }
  assert.fail('Unexpected network or payment request');
 };
 const report=await auditSupplierPayment(env,auditInput(evidence.id),{request:provider});
 assert.equal(report.conferenciaFinanceiraConcluida,true);assert.equal(report.pagamentoIniciado,false);assert.equal(calls.length,3);
 assert.equal(one(query,'SELECT status FROM orders WHERE id=?',[orderId]).status,'paid_supplier_pending');
 const status=await request(env,'orders-billing-status');assert.equal(status.available,true);assert.equal(status.latest.state,'ready_for_check');
 assert.ok(!JSON.stringify(status).includes(pix));assert.ok(!JSON.stringify(status).includes('00000000000100'));
});

test('a bare invoice asks for an exact reference; it cannot be audited until the supplier replies to that request',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);await readyForBill(env);
 const text='Total BRL: 76.80\n'+pixFixture();
 await request(env,'orders-inbound',billReply('UNSCOPED_BILL',text,{contextId:''}));
 const first=one(query,'SELECT * FROM supplier_billing_messages');assert.equal(first.linked,0);assert.equal(first.state,'needs_reference');
 env.ASAAS_PRODUCTION_API_KEY='fake-key';
 assert.equal((await auditSupplierPayment(env,auditInput(first.id),{request:()=>assert.fail('No provider call')})).conferenciaFinanceiraConcluida,false);
 const followup=await sendNext(env,'BILL_EXACT_REFERENCE_REQUEST');assert.match(followup.payload.text.body,/identificar/);
 await request(env,'orders-inbound',billReply('SCOPED_BILL',text,{contextId:'BILL_EXACT_REFERENCE_REQUEST'}));
 assert.equal(one(query,'SELECT state FROM supplier_billing_messages ORDER BY seq DESC LIMIT 1').state,'ready_for_check');
});

test('photo, PDF and other attachment notices request text, never download files or confirm an order',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);await readyForBill(env);
 for(const type of ['image','document','audio','video']){
  assert.equal((await request(env,'orders-inbound',billReply('BILL_ATTACHMENT_'+type,'',{mediaType:type}))).status,200);
 }
 assert.equal(one(query,'SELECT COUNT(*) AS count FROM supplier_billing_messages').count,4);
 assert.equal(one(query,"SELECT COUNT(*) AS count FROM wa_local_groups WHERE purpose='billing_request'").count,1);
 assert.equal(one(query,'SELECT state FROM supplier_dispatch WHERE order_id=?',[orderId]).state,'details_sent');
});

test('new billing evidence, a changed supplier, stale timestamps or substituted payloads invalidate an old audit selection',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);await readyForBill(env);env.ASAAS_PRODUCTION_API_KEY='fake-key';
 await request(env,'orders-inbound',billReply('FIRST_VALID_BILL','Total BRL: 76.80\n'+pixFixture()));
 const row=one(query,'SELECT * FROM supplier_billing_messages');
 const noProvider=()=>assert.fail('Stale or tampered evidence cannot reach provider');
 const bad=async input=>assert.equal((await auditSupplierPayment(env,input,{request:noProvider})).conferenciaFinanceiraConcluida,false);
 await bad({...auditInput(row.id),quotedTotalBrl:'90.00'});
 await bad({...auditInput(row.id),pixPayload:pixFixture({txid:'SUBSTITUTE'})});
 query({sql:'UPDATE supplier_billing_messages SET created_at=? WHERE id=?',args:['invalid-date',row.id]});await bad(auditInput(row.id));
 query({sql:'UPDATE supplier_billing_messages SET created_at=? WHERE id=?',args:[new Date(Date.now()-25*3600e3).toISOString(),row.id]});await bad(auditInput(row.id));
 query({sql:'UPDATE supplier_billing_messages SET created_at=? WHERE id=?',args:[new Date(Date.now()-1000).toISOString(),row.id]});
 query({sql:'UPDATE supplier_contacts SET authorized=0 WHERE supplier_id=?',args:['supplier1']});await bad(auditInput(row.id));
 query({sql:'UPDATE supplier_contacts SET authorized=1 WHERE supplier_id=?',args:['supplier1']});
 await request(env,'orders-inbound',billReply('REPLACEMENT_BILL','Total BRL: 80.00\nhttps://changed.example.invalid/pay'));await bad(auditInput(row.id));
});

test('conflicting order references and third-party senders cannot register a payable bill or advance preparation',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);await readyForBill(env);
 await request(env,'orders-inbound',billReply('WRONG_REFERENCE_BILL','COBRANÇA aabbccdd\nTotal BRL: 76.80\n'+pixFixture()));
 const saved=one(query,'SELECT * FROM supplier_billing_messages');assert.equal(saved.state,'needs_details');
 assert.ok(JSON.parse(saved.format_json).issues.includes('order_reference_conflict'));
 assert.equal(one(query,"SELECT COUNT(*) AS count FROM wa_local_groups WHERE purpose='billing_request'").count,0);
 await request(env,'orders-inbound',billReply('THIRD_PARTY_BILL','COBRANÇA 1234abcd\nTotal BRL: 76.80\n'+pixFixture(),{fromJid:'8613700137000@s.whatsapp.net'}));
 assert.equal(one(query,'SELECT COUNT(*) AS count FROM supplier_billing_messages').count,1);
 assert.equal(one(query,'SELECT status FROM orders WHERE id=?',[orderId]).status,'paid_supplier_pending');
});

test('missing billing migration preserves manual review and does not pretend the collector is available',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);await readyForBill(env);
 query({sql:'DROP TABLE supplier_billing_messages'});
 assert.equal((await request(env,'orders-billing-status')).available,false);
 await request(env,'orders-inbound',billReply('MANUAL_BILL_FALLBACK','https://unknown.example.invalid/bill'));
 assert.equal(one(query,'SELECT status FROM supplier_jobs WHERE order_id=?',[orderId]).status,'supplier_attention');
});

test('a supplier can send the bill after confirming preparation without changing that order or repeating a buyer update',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);await readyForBill(env);
 await request(env,'orders-inbound',billReply('CONFIRMED_BEFORE_BILL','confirmar 1234abcd'));
 await sendNext(env,'BILL_BUYER_PREPARING_NOTICE');
 await request(env,'orders-inbound',billReply('LINK_AFTER_CONFIRMATION','https://changed.example.invalid/bill'));
 const followup=await sendNext(env,'BILL_REQUEST_AFTER_CONFIRMATION');assert.equal(followup.recipientJid,supplier+'@s.whatsapp.net');
 await request(env,'orders-inbound',billReply('PIX_AFTER_CONFIRMATION','Total BRL: 76.80\n'+pixFixture(),{contextId:'BILL_REQUEST_AFTER_CONFIRMATION'}));
 assert.equal(one(query,'SELECT state FROM supplier_billing_messages ORDER BY seq DESC LIMIT 1').state,'ready_for_check');
 assert.equal(one(query,'SELECT status FROM orders WHERE id=?',[orderId]).status,'supplier_preparing');
 assert.equal(one(query,"SELECT COUNT(*) AS count FROM wa_local_groups WHERE purpose='buyer_update'").count,1);
});

test('a bill for a supplier with two eligible orders remains unassigned and visible for review',async t=>{
 const {db,query}=localD1(t),env=envFor(db);seed(query);await readyForBill(env);
 const other='aabbccdd-1234-4234-8234-123456789012',stamp=new Date().toISOString();
 query({sql:'INSERT INTO orders(id,created_at,updated_at,status,name,email,phone,cpf,zip,address,city,state,items_json,subtotal,shipping,total,payment_id) SELECT ?,created_at,updated_at,status,name,email,phone,cpf,zip,address,city,state,items_json,subtotal,shipping,total,? FROM orders WHERE id=?',args:[other,'pay_second_order',orderId]});
 query({sql:'INSERT INTO order_payment_environments(order_id,environment,payment_id,received_at,recorded_at) VALUES(?,?,?,?,?)',args:[other,'production','pay_second_order',stamp,stamp]});
 query({sql:"INSERT INTO supplier_dispatch(order_id,supplier_id,supplier_phone,state,message_id,details_sent_at,created_at,updated_at) VALUES(?,?,?,'details_sent',?,?,?,?)",args:[other,'supplier1',supplier,'OTHER_ORDER_MESSAGE',stamp,stamp,stamp]});
 await request(env,'orders-inbound',billReply('AMBIGUOUS_TWO_ORDERS','Total BRL: 76.80\n'+pixFixture(),{contextId:''}));
 const evidence=one(query,'SELECT * FROM supplier_billing_messages');assert.equal(evidence.order_id,null);assert.equal(evidence.linked,0);
 const status=await request(env,'orders-billing-status');assert.equal(status.latest.orderId,null);assert.match(status.latest.pendencias.join(' '),/vários pedidos/);
 assert.equal(one(query,"SELECT COUNT(*) AS count FROM wa_local_groups WHERE purpose='billing_request'").count,0);
});
