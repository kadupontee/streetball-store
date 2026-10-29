import test from 'node:test';
import assert from 'node:assert/strict';
import {localD1} from './support/local-d1.mjs';
import {handleAdminSales,prepareSalesNotifications,recordSalePaymentEvent,deliverSaleNotifications,readSale} from '../worker/admin-sales.js';
import {salesProgress} from '../worker/admin-sales-progress.js';
import {base64url} from '../worker/web-push.js';
import worker from '../worker/index.js';

const orderId='1234abcd-1234-4234-8234-123456789012',origin='https://lojastreetball.com.br';
const one=(q,sql,args=[])=>q({sql,args}).results[0];
function seed(query){
 const t='2026-10-01T12:00:00.000Z';
 query({sql:'INSERT INTO orders(id,created_at,updated_at,status,name,email,phone,cpf,zip,address,city,state,items_json,subtotal,shipping,total,payment_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',args:[orderId,t,t,'awaiting_payment','Cliente fictício','fake@example.invalid','11999999999','00000000000','00000000','Endereço privado','São Paulo','SP',JSON.stringify([{title:'Camisa exemplo',qty:1,size:'M'}]),199.9,0,199.9,'pay_fake']});
}
async function fixture(t){const {db,query}=localD1(t);const env={DB:db,ADMIN_TOKEN:'test-admin-key',ASAAS_SANDBOX:'false',ASAAS_PRODUCTION_WEBHOOK_TOKEN:'webhook_fake',WA_TRANSPORT:'local'};seed(query);await prepareSalesNotifications(env);return {env,query};}
async function call(env,action,{body,cookie,token,extraHeaders={}}={}){
 const r=await handleAdminSales(new Request(origin+'/api/admin/sales/'+action,{method:body!==undefined?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(token?{authorization:'Bearer '+token}:{}),...(body!==undefined?{'content-type':'application/json',origin}:{}),...extraHeaders},body:body!==undefined?JSON.stringify(body):undefined}),env);
 return {response:r,status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
async function enroll(env){
 const session=await call(env,'session',{body:{},token:env.ADMIN_TOKEN});assert.equal(session.status,200);
 const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const sub={endpoint:'https://web.push.apple.com/'+crypto.randomUUID(),keys:{p256dh:base64url(await crypto.subtle.exportKey('raw',pair.publicKey)),auth:base64url(crypto.getRandomValues(new Uint8Array(16)))}};
 const saved=await call(env,'notifications/subscribe',{body:{subscription:sub},cookie:session.cookie});assert.equal(saved.status,200);
 return {cookie:session.cookie,sub};
}
test('read-only device login is HttpOnly, persists safely and cannot authorize financial admin endpoints',async t=>{
 const {env}=await fixture(t);
 assert.equal((await call(env,'orders')).status,401);
 assert.equal((await call(env,'session',{body:{},token:'wrong'})).status,401);
 const login=await call(env,'session',{body:{},token:env.ADMIN_TOKEN});
 assert.match(login.response.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict/);
 assert.equal((await call(env,'orders',{cookie:login.cookie})).status,200);
 const detail=await call(env,'order?orderId='+orderId,{cookie:login.cookie});assert.equal(detail.status,200);
 const serialized=JSON.stringify(detail.data);assert.ok(!serialized.includes('Endereço privado'));assert.ok(!serialized.includes('private_jwk'));assert.ok(!serialized.includes('fake@example.invalid'));
 const financial=await worker.fetch(new Request(origin+'/api/admin/supplier-status',{method:'POST',headers:{cookie:login.cookie,'content-type':'application/json'},body:JSON.stringify({orderId,status:'supplier_paid'})}),env);
 assert.equal(financial.status,401);
 assert.equal((await call(env,'notifications/subscribe',{body:{},cookie:login.cookie,extraHeaders:{origin:'https://attacker.invalid'}})).status,403);
});
test('a sale is queued exactly once per existing device across CONFIRMED, RECEIVED and repeated webhooks',async t=>{
 const {env,query}=await fixture(t);await enroll(env);
 await recordSalePaymentEvent(env,orderId,'PAYMENT_CONFIRMED');await recordSalePaymentEvent(env,orderId,'PAYMENT_RECEIVED');await recordSalePaymentEvent(env,orderId,'PAYMENT_CONFIRMED');
 assert.equal(one(query,'SELECT COUNT(*) AS n FROM admin_sale_events').n,2);assert.equal(one(query,'SELECT COUNT(*) AS n FROM admin_push_deliveries').n,1);
 assert.equal((await readSale(env,orderId)).stages[0].detail,'Recebimento registrado pelo Asaas');
 const second=await enroll(env);query({sql:'UPDATE admin_push_subscriptions SET created_at=? WHERE subscription_json LIKE ?',args:['2099-01-01T00:00:00.000Z','%'+second.sub.endpoint+'%']});
 await recordSalePaymentEvent(env,orderId,'PAYMENT_RECEIVED');assert.equal(one(query,'SELECT COUNT(*) AS n FROM admin_push_deliveries').n,1);
});
test('temporary push failures retry durably, acceptance stops retrying and expired subscriptions are disabled',async t=>{
 const {env,query}=await fixture(t);await enroll(env);await recordSalePaymentEvent(env,orderId,'PAYMENT_RECEIVED');
 let calls=0;const request=async()=>{calls++;return new Response(null,{status:calls===1?503:201});};
 await deliverSaleNotifications(env,{request});assert.equal(one(query,'SELECT state FROM admin_push_deliveries').state,'pending');
 query({sql:'UPDATE admin_push_deliveries SET next_attempt_at=NULL'});await deliverSaleNotifications(env,{request});
 assert.equal(one(query,'SELECT state FROM admin_push_deliveries').state,'accepted');await deliverSaleNotifications(env,{request});assert.equal(calls,2);
 query({sql:"UPDATE admin_push_deliveries SET state='pending',next_attempt_at=NULL"});await deliverSaleNotifications(env,{request:async()=>new Response(null,{status:410})});
 assert.equal(one(query,'SELECT disabled FROM admin_push_subscriptions').disabled,1);
});
test('sandbox, cancelled sales, disabled devices and expired sessions never receive real sale pushes',async t=>{
 const {env,query}=await fixture(t),device=await enroll(env);env.ASAAS_SANDBOX='true';
 await recordSalePaymentEvent(env,orderId,'PAYMENT_RECEIVED');assert.equal(one(query,'SELECT COUNT(*) AS n FROM admin_push_deliveries').n,0);
 env.ASAAS_SANDBOX='false';await recordSalePaymentEvent(env,orderId,'PAYMENT_RECEIVED');await recordSalePaymentEvent(env,orderId,'PAYMENT_REFUNDED');
 assert.equal(one(query,'SELECT state FROM admin_push_deliveries').state,'cancelled');
 query({sql:"UPDATE orders SET status='payment_refunded'"});query({sql:"UPDATE admin_push_deliveries SET state='pending'"});
 let calls=0;const request=async()=>{calls++;return new Response(null,{status:201});};await deliverSaleNotifications(env,{request});assert.equal(calls,0);
 query({sql:"UPDATE orders SET status='paid_supplier_pending'"});await call(env,'logout',{body:{},cookie:device.cookie});await deliverSaleNotifications(env,{request});assert.equal(calls,0);
 assert.equal((await call(env,'orders',{cookie:device.cookie})).status,401);
});
test('opening the same order reads live bot state: queued, sent, confirmed and separately paid',async t=>{
 const {env,query}=await fixture(t);const time=new Date().toISOString();
 query({sql:"UPDATE orders SET status='paid_supplier_pending'"});
 query({sql:'INSERT INTO supplier_jobs(id,order_id,status,created_at,updated_at) VALUES(?,?,?,?,?)',args:['fake-job',orderId,'queued_local',time,time]});
 query({sql:'INSERT INTO supplier_dispatch(order_id,state,created_at,updated_at) VALUES(?,?,?,?)',args:[orderId,'details_queued_local',time,time]});
 let sale=await readSale(env,orderId);assert.equal(sale.stages.find(s=>s.id==='supplier_order').state,'active');assert.equal(sale.stages.find(s=>s.id==='supplier_payment').state,'pending');assert.match(sale.stages.find(s=>s.id==='supplier_payment').detail,/desativado/);assert.match(sale.stages[0].detail,/Recebimento registrado/);
 query({sql:"UPDATE supplier_dispatch SET state='confirmed',details_sent_at=?,responded_at=? WHERE order_id=?",args:[time,time,orderId]});
 sale=await readSale(env,orderId);assert.equal(sale.stages.find(s=>s.id==='supplier_order').state,'done');assert.equal(sale.stages.find(s=>s.id==='supplier_confirmation').state,'done');assert.equal(sale.stages.find(s=>s.id==='supplier_payment').state,'pending');
 query({sql:"INSERT INTO supplier_paid_order_records(order_id,source,recorded_at) VALUES(?,'manual',?)",args:[orderId,time]});
 sale=await readSale(env,orderId);assert.equal(sale.supplierPayment.state,'manual_paid');assert.match(sale.stages.find(s=>s.id==='supplier_payment').detail,/manualmente/);
});
test('payment intent, authorization or a queued receipt never masquerades as a confirmed supplier payment',()=>{
 const base={order:{id:orderId,status:'supplier_preparing',created_at:'2026-10-01T12:00:00Z',items_json:'[]'},payout:{state:'submitted',bank_status:'AWAITING_REQUEST',amount_cents:10000,receipt_url:'https://www.asaas.com/fake'},tracking:[{stage:'supplier_search',label:'Consultando fornecedores',created_at:'2026-10-01T12:00:00Z'}]};
 for(const state of ['submitting','submitted','authorized','unknown','needs_review']){
  const data=salesProgress({...base,payout:{...base.payout,state}});assert.notEqual(data.stages.find(s=>s.id==='supplier_payment').state,'done');assert.equal(data.supplierPayment.receiptUrl,null);assert.equal(data.stages.find(s=>s.id==='shipping').state,'pending');
 }
 assert.notEqual(salesProgress({...base,payout:{...base.payout,state:'paid'}}).supplierPayment.state,'paid');
 const paid=salesProgress({...base,payout:{...base.payout,state:'paid',bank_status:'DONE'}});assert.equal(paid.supplierPayment.state,'paid');assert.equal(paid.supplierPayment.receiptUrl,'https://www.asaas.com/fake');
 assert.equal(salesProgress({...base,payout:{...base.payout,state:'paid',bank_status:'DONE',receipt_url:'https://attacker.invalid/x'}}).supplierPayment.receiptUrl,null);
});
test('the real authenticated payment webhook records a sale before acknowledging it and does not double-enqueue',async t=>{
 const {env,query}=await fixture(t);await enroll(env);const waits=[];
 const message={id:'evt_fake',event:'PAYMENT_CONFIRMED',payment:{id:'pay_fake',externalReference:orderId,value:199.9}};
 const request=()=>new Request(origin+'/api/webhooks/asaas',{method:'POST',headers:{'content-type':'application/json','asaas-access-token':'webhook_fake'},body:JSON.stringify(message)});
 const old=globalThis.fetch;t.after(()=>{globalThis.fetch=old;});globalThis.fetch=async()=>new Response(null,{status:201});
 assert.equal((await worker.fetch(request(),env,{waitUntil:p=>waits.push(p)})).status,200);await Promise.all(waits);
 assert.equal((await worker.fetch(request(),env,{waitUntil:p=>waits.push(p)})).status,200);
 assert.equal(one(query,'SELECT COUNT(*) AS n FROM admin_push_deliveries').n,1);assert.equal(one(query,'SELECT state FROM admin_push_deliveries').state,'accepted');
 assert.equal(one(query,'SELECT status FROM orders').status,'awaiting_payment');
});
test('the test route identifies a transport failure without leaking raw errors and saves only safe diagnostics',async t=>{
 const {env}=await fixture(t),device=await enroll(env);
 t.mock.method(globalThis,'fetch',async()=>{throw Error('private endpoint and credentials must never reach the browser');});
 const result=await call(env,'notifications/test',{body:{},cookie:device.cookie});
 assert.equal(result.status,503);assert.equal(result.data.code,'PUSH_CONNECTION_FAILED');assert.equal(result.data.phase,'transport');assert.ok(!JSON.stringify(result.data).includes('credentials'));
 const config=await call(env,'notifications',{cookie:device.cookie});assert.equal(config.data.lastAttempt.code,'PUSH_CONNECTION_FAILED');assert.ok(!JSON.stringify(config.data.lastAttempt).includes('web.push.apple.com'));
});
test('an expired push registration is disabled and the browser receives a reconnection instruction',async t=>{
 const {env,query}=await fixture(t),device=await enroll(env);
 t.mock.method(globalThis,'fetch',async()=>Response.json({reason:'Unregistered'},{status:410}));
 const result=await call(env,'notifications/test',{body:{},cookie:device.cookie});
 assert.equal(result.status,502);assert.equal(result.data.code,'PUSH_SUBSCRIPTION_EXPIRED');assert.equal(result.data.providerStatus,410);assert.equal(result.data.providerReason,'Unregistered');
 assert.equal(one(query,'SELECT disabled FROM admin_push_subscriptions').disabled,1);assert.equal((await call(env,'notifications',{cookie:device.cookie})).data.active,false);
});
test('provider authentication errors and invalid signing keys are distinguished from sales lookup failures',async t=>{
 const {env,query}=await fixture(t),device=await enroll(env);
 const mock=t.mock.method(globalThis,'fetch',async()=>Response.json({reason:'BadJwtToken'},{status:403}));
 let result=await call(env,'notifications/test',{body:{},cookie:device.cookie});assert.equal(result.data.code,'PUSH_PROVIDER_AUTH_REJECTED');assert.equal(result.data.providerReason,'BadJwtToken');
 query({sql:'UPDATE admin_sales_config SET private_jwk=?',args:['{}']});
 result=await call(env,'notifications/test',{body:{},cookie:device.cookie});assert.equal(result.data.code,'PUSH_SIGNING_FAILED');assert.equal(result.data.phase,'authentication');assert.equal(mock.mock.callCount(),1);
});
test('a missing diagnostics table is created for existing sessions without resetting registrations or VAPID keys',async t=>{
 const {env,query}=await fixture(t),device=await enroll(env),before=one(query,'SELECT private_jwk FROM admin_sales_config').private_jwk;
 query({sql:'DROP TABLE admin_push_attempt_results'});
 t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:201}));
 const result=await call(env,'notifications/test',{body:{},cookie:device.cookie});assert.equal(result.status,200);assert.equal(result.data.acceptedByPushService,true);
 assert.equal(one(query,'SELECT private_jwk FROM admin_sales_config').private_jwk,before);assert.equal(one(query,'SELECT COUNT(*) AS n FROM admin_push_subscriptions WHERE disabled=0').n,1);
 assert.equal((await call(env,'notifications',{cookie:device.cookie})).data.lastAttempt.state,'accepted');
});
