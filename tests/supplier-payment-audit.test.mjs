import test from 'node:test';
import assert from 'node:assert/strict';
import {auditSupplierPayment,compareSupplierPayment,supplierPaymentBudget} from '../worker/supplier-payment-audit.js';
import worker from '../worker/index.js';

const id='1234abcd-1234-4234-8234-123456789012';
const payload='000201'+'0123456789'.repeat(12);
const document='00000000000100';
function fixture(){
 const item={id:'product-example',qty:1,size:'P',patch:false,personalize:false};
 const order={id,status:'paid_supplier_pending',total:199.90,payment_id:'pay_example',items_json:JSON.stringify([item])};
 const costs={items:[{productId:item.id,qty:1,unitUsd:'11.00'}],freightUsd:'4.00',exchangeRateBrlPerUsd:'5.12',
  gatewayFeeBrl:'0.00',pixFeeBrl:'1.99',otherCostsBrl:'5.00'};
 const charge={id:order.payment_id,externalReference:id,value:199.90,netValue:197.91,status:'RECEIVED',deleted:false,refunds:[]};
 const decoded={payload,value:76.80,totalValue:76.80,canBePaid:true,finality:null,changeValue:null,receiver:{cpfCnpj:document}};
 const balance={balance:500};
 const input={orderId:id,costs,quotedTotalBrl:'76.80',pixPayload:payload,receiverCpfCnpj:document};
 const calls=[],sql=[];
 const env={ASAAS_SANDBOX:'false',ASAAS_PRODUCTION_API_KEY:'fake-production-key-not-a-real-secret',
  ADMIN_TOKEN:'fake-admin',DB:{prepare(query){sql.push(query);return {bind(){return this;},async first(){
   if(query.includes('FROM orders '))return order;
   if(query.includes('FROM order_payment_environments '))return {environment:'production',payment_id:order.payment_id,received_at:'2026-10-27T00:00:00.000Z'};
   if(query.includes('FROM supplier_dispatch '))return {state:'details_sent',details_sent_at:'2026-10-27T00:01:00.000Z',authorized:1,phone_e164:'8613800138000',supplier_phone:'8613800138000'};
   assert.fail('Unexpected SQL');
  },run(){assert.fail('Read-only audit cannot write to D1');}};}}};
 const request=async(url,options)=>{
  assert.equal(options.redirect,'error');assert.equal(options.headers.access_token,env.ASAAS_PRODUCTION_API_KEY);
  calls.push({url,options});
  if(url==='https://api.asaas.com/v3/payments/pay_example'){assert.equal(options.method,'GET');assert.equal(options.body,undefined);return Response.json(charge);}
  if(url==='https://api.asaas.com/v3/finance/balance'){assert.equal(options.method,'GET');assert.equal(options.body,undefined);return Response.json(balance);}
  if(url==='https://api.asaas.com/v3/pix/qrCodes/decode'){
   assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{payload});return Response.json(decoded);
  }
  assert.fail('The audit cannot call any other provider endpoint, including payment');
 };
 const compare=()=>compareSupplierPayment({order,charge,decoded,balance,costs,quotedTotalBrl:input.quotedTotalBrl,receiverCpfCnpj:input.receiverCpfCnpj});
 return {item,order,costs,charge,decoded,balance,input,env,request,calls,sql,compare};
}

test('financial check compares gross, actual net receipt, supplier quote, Pix and every supplied expense',()=>{
 const f=fixture(),r=f.compare();
 assert.equal(r.conferenciaFinanceiraConcluida,true);assert.deepEqual(r.pendencias,[]);
 assert.deepEqual(r.valoresBrl,{receitaBruta:'199.90',receitaLiquida:'197.91',custoEsperadoFornecedor:'76.80',
  cotacaoFornecedor:'76.80',valorPix:'76.80',tarifaPix:'1.99',outrosCustos:'5.00',resultadoAposCustos:'114.12'});
 assert.equal(r.pagamentoIniciado,false);assert.equal(r.pagamentoAutomaticoHabilitado,false);
 assert.equal(r.limitePorPedido,null);assert.equal(r.limitePorDia,null);
});

test('large valid orders have no arbitrary per-order or daily spending ceiling',()=>{
 const f=fixture();f.order.total=1000000;f.charge.value=1000000;f.charge.netValue=999000;
 f.costs.items[0].unitUsd='100000.00';f.costs.freightUsd='0.00';f.costs.exchangeRateBrlPerUsd='5.00';
 f.input.quotedTotalBrl='500000.00';f.decoded.value=f.decoded.totalValue=500000;f.balance.balance=600000;
 assert.equal(f.compare().conferenciaFinanceiraConcluida,true);
});

test('currency conversion rounds exactly once in cents and includes gateway, Pix and other costs',()=>{
 const f=fixture();f.costs.items[0].unitUsd='0.01';f.costs.freightUsd='0.00';f.costs.exchangeRateBrlPerUsd='1.5';
 f.costs.gatewayFeeBrl='0.01';const budget=supplierPaymentBudget([f.item],f.costs);
 assert.equal(budget.supplier,3n);assert.equal(budget.expense,702n);
});

test('missing costs, wrong product, quantity mismatch and ambiguous money formats cannot pass',()=>{
 for(const change of [f=>delete f.costs.freightUsd,f=>delete f.costs.pixFeeBrl,f=>delete f.costs.otherCostsBrl,
  f=>f.costs.items[0].productId='different',f=>f.costs.items[0].qty=2,f=>f.costs.items.push(f.costs.items[0]),
  f=>f.costs.items[0].unitUsd='11,00',f=>f.costs.items[0].unitUsd=Infinity,f=>f.costs.items[0].unitUsd=-11,
  f=>f.costs.items[0].unitUsd='1e2',f=>f.costs.exchangeRateBrlPerUsd='5.1234567']){
  const f=fixture();change(f);assert.equal(f.compare().verificacoes.custoEsperadoInformado,false);
 }
});

test('a different payment, reference, gross value or missing net receipt fails verification',()=>{
 for(const change of [f=>f.charge.id='pay_another',f=>f.charge.externalReference='other-order',f=>f.charge.value=199.89,
  f=>delete f.charge.netValue,f=>f.charge.netValue=200,f=>f.charge.netValue='197.919']){
  const f=fixture();change(f);assert.equal(f.compare().conferenciaFinanceiraConcluida,false);
 }
});

test('confirmed but unsettled, refunded, contested or deleted customer payments are not available',()=>{
 for(const change of [f=>f.charge.status='CONFIRMED',f=>f.charge.status='REFUNDED',f=>f.charge.deleted=true,
  f=>f.charge.refunds=[{id:'refund-example'}],f=>f.charge.chargeback={status:'REQUESTED'}]){
  const f=fixture();change(f);assert.equal(f.compare().verificacoes.recebimentoLiquidado,false);
 }
});

test('a smaller cost than the sale price alone does not validate the quote or the Pix',()=>{
 for(const change of [f=>f.input.quotedTotalBrl='90.00',f=>f.decoded.totalValue=90,
  f=>f.decoded.totalValue='76.801']){
  const f=fixture();change(f);assert.equal(f.compare().conferenciaFinanceiraConcluida,false);
 }
});

test('expired/refused QR codes, withdrawal/change Pix, unknown recipients and insufficient balance fail',()=>{
 for(const change of [f=>f.decoded.canBePaid=false,f=>f.decoded.finality='WITHDRAWAL',f=>f.decoded.changeValue=1,
  f=>f.decoded.receiver.cpfCnpj='11111111000111',f=>f.decoded.receiver.cpfCnpj='**.***.***/0001-00',
  f=>f.input.receiverCpfCnpj='',f=>f.balance.balance=78.78]){
  const f=fixture();change(f);assert.equal(f.compare().conferenciaFinanceiraConcluida,false);
 }
});

test('zero and negative results fail even if all quoted values match and the account has funds',()=>{
 for(const net of [83.79,80]){
  const f=fixture();f.charge.netValue=net;const r=f.compare();
  assert.equal(r.verificacoes.resultadoPositivo,false);assert.equal(r.conferenciaFinanceiraConcluida,false);
 }
});

test('the protected audit reads stored order evidence and only calls payment lookup, QR decode and balance',async()=>{
 const f=fixture(),r=await auditSupplierPayment(f.env,f.input,{request:f.request});
 assert.equal(r.conferenciaFinanceiraConcluida,true);assert.equal(f.calls.length,3);
 assert.ok(f.sql.every(query=>query.startsWith('SELECT ')));
 const out=JSON.stringify(r);assert.ok(!out.includes(f.env.ASAAS_PRODUCTION_API_KEY));
 assert.ok(!out.includes(payload));assert.ok(!out.includes(document));
});

test('Sandbox, missing production key, malformed code and unverified production receipts cannot query the provider',async()=>{
 for(const change of [f=>f.env.ASAAS_SANDBOX='true',f=>delete f.env.ASAAS_PRODUCTION_API_KEY,
  f=>f.input.pixPayload='https://untrusted.example/payment',f=>f.input.orderId='invalid',
  f=>f.order.status='payment_refunded',f=>f.order.payment_id=null]){
  const f=fixture();change(f);
  const r=await auditSupplierPayment(f.env,f.input,{request:()=>assert.fail('No provider request')});
  assert.equal(r.conferenciaFinanceiraConcluida,false);assert.ok(r.pendencias.length);
 }
 const f=fixture(),original=f.env.DB.prepare;
 f.env.DB.prepare=query=>query.includes('FROM order_payment_environments ')?{bind(){return this;},async first(){return {environment:'sandbox'};}}:original(query);
 assert.equal((await auditSupplierPayment(f.env,f.input,{request:()=>assert.fail('No provider request')})).conferenciaFinanceiraConcluida,false);
});

test('revoked suppliers or order details not yet sent prevent any provider lookup',async()=>{
 for(const state of [{authorized:0},{state:'awaiting_reply'},{phone_e164:'different'}]){
  const f=fixture(),original=f.env.DB.prepare;
  f.env.DB.prepare=query=>query.includes('FROM supplier_dispatch ')?{bind(){return this;},async first(){
   return {state:'details_sent',details_sent_at:'2026-10-27',authorized:1,phone_e164:'8613800138000',supplier_phone:'8613800138000',...state};
  }}:original(query);
  assert.equal((await auditSupplierPayment(f.env,f.input,{request:()=>assert.fail('No provider request')})).conferenciaFinanceiraConcluida,false);
 }
});

test('HTTP failures, malformed responses, timeouts and a changed decoded payload cannot confirm the audit',async()=>{
 for(const request of [async()=>Response.json({errors:[{description:'private-provider-detail'}]},{status:403}),
  async()=>new Response('<html>private</html>',{status:502}),async()=>{throw Error('private-provider-detail');}]){
  const f=fixture(),r=await auditSupplierPayment(f.env,f.input,{request});
  assert.equal(r.conferenciaFinanceiraConcluida,false);assert.ok(!JSON.stringify(r).includes('private-provider-detail'));
 }
 const f=fixture();f.decoded.payload=payload+'different';
 assert.equal((await auditSupplierPayment(f.env,f.input,{request:f.request})).conferenciaFinanceiraConcluida,false);
});

test('admin authentication and valid JSON are required before an order or provider can be inspected',async()=>{
 const f=fixture();const make=(token,body)=>new Request('https://lojastreetball.com.br/api/admin/supplier-payment-check',
  {method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body});
 assert.equal((await worker.fetch(make('wrong',JSON.stringify(f.input)),f.env)).status,401);assert.equal(f.sql.length,0);
 assert.equal((await worker.fetch(make('fake-admin','{broken'),f.env)).status,400);assert.equal(f.sql.length,0);
 const previous=globalThis.fetch;globalThis.fetch=f.request;
 try{
  const response=await worker.fetch(make('fake-admin',JSON.stringify(f.input)),f.env);
  assert.equal(response.status,200);assert.equal((await response.json()).conferenciaFinanceiraConcluida,true);
 }finally{globalThis.fetch=previous;}
});
