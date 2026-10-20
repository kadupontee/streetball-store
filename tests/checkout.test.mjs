import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {routePaidOrder,monitorSupplierSLA,retryPendingRoutes} from '../worker/fulfillment.js';
import {readFileSync} from 'node:fs';

test('checkout não é liberado sem os serviços configurados', async ()=>{
 const req=new Request('https://loja.exemplo.com/api/checkout/config');
 const response=await worker.fetch(req,{});
 assert.equal(response.status,200);
 assert.equal((await response.json()).enabled,false);
});
test('checkout pode ser habilitado para simulações no Sandbox',async ()=>{
 const req=new Request('https://loja.exemplo.com/api/checkout/config');
 const env={DB:{},ASSETS:{},ASAAS_API_KEY:'sandbox-test',SHIPPING_FLAT_BRL:'21.90',SALES_ENABLED:'true',ASAAS_SANDBOX:'true'};
 const response=await worker.fetch(req,env);
 const data=await response.json();
 assert.equal(data.enabled,true);
 assert.equal(data.sandbox,true);
 assert.equal(data.shipping,21.90);
 assert.deepEqual(data.methods,['PIX','CREDIT_CARD']);
 assert.equal(data.supplierPaymentAutomated,false);
});
test('produção exige liberação adicional explícita',async ()=>{
 const req=new Request('https://loja.exemplo.com/api/checkout/config');
 const env={DB:{},ASSETS:{},ASAAS_API_KEY:'fake',SHIPPING_FLAT_BRL:'23',SALES_ENABLED:'true',ASAAS_SANDBOX:'false'};
 const response=await worker.fetch(req,env);
 assert.equal((await response.json()).enabled,false);
});
test('preço e cobrança não são gerados em prévia não configurada',async ()=>{
 const req=new Request('https://loja.exemplo.com/api/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({paymentMethod:'PIX',customer:{},items:[]})});
 const response=await worker.fetch(req,{});
 assert.equal(response.status,503);
});
test('webhook de pagamento exige token Asaas válido',async ()=>{
 const req=new Request('https://loja.exemplo.com/api/webhooks/asaas',{method:'POST',headers:{'content-type':'application/json','asaas-access-token':'invalido'},body:'{}'});
 const response=await worker.fetch(req,{ASAAS_WEBHOOK_TOKEN:'segredo-valido'});
 assert.equal(response.status,401);
});
test('webhook Meta não aceita mensagens sem assinatura',async ()=>{
 const req=new Request('https://loja.exemplo.com/api/webhooks/whatsapp',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 const response=await worker.fetch(req,{WA_APP_SECRET:'segredo'});
 assert.equal(response.status,403);
});
test('filas não enviam mensagens nem pagam fornecedores sem banco',async ()=>{
 assert.equal(await routePaidOrder({},'id'),false);
 await monitorSupplierSLA({});
 await retryPendingRoutes({});
});
test('interface apresenta Pix e cartão com total de frete',()=>{
 const page=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(page,/name="paymentMethod"/);
 assert.match(page,/<option value="PIX">Pix/);
 assert.match(page,/<option value="CREDIT_CARD">Cartão de crédito/);
 assert.match(page,/id="checkoutGrandTotal"/);
});
test('código frontend tem sintaxe válida',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.doesNotThrow(()=>new Function(app));
});
