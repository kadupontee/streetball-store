import test from 'node:test';
import assert from 'node:assert/strict';
import {asaasConfig,asaasRequest} from '../worker/asaas.js';
import worker from '../worker/index.js';

const sandboxKey='$aact_hmlg_example',productionKey='$aact_prod_example';
const secrets={ASAAS_API_KEY:sandboxKey,ASAAS_WEBHOOK_TOKEN:'sandbox-webhook-token',
 ASAAS_PRODUCTION_API_KEY:productionKey,ASAAS_PRODUCTION_WEBHOOK_TOKEN:'production-webhook-token'};
const commercial={DB:{},ASSETS:{},SHIPPING_FLAT_BRL:'0',SALES_ENABLED:'true',PAYMENTS_PRODUCTION_ENABLED:'true',
 CUSTOMER_PAYS_IMPORT_TAXES:'true',IMPORT_TAX_DISCLOSURE_APPROVED:'true',IMPORT_COMPLIANCE_APPROVED:'true'};
const readiness=async env=>(await worker.fetch(new Request('https://loja.example/api/checkout/config'),env)).json();

test('staging production secrets preserves the existing Sandbox credentials',()=>{
 const config=asaasConfig({...secrets,ASAAS_SANDBOX:'true'});
 assert.equal(config.apiKey,sandboxKey);assert.equal(config.webhookToken,secrets.ASAAS_WEBHOOK_TOKEN);
 assert.equal(config.apiUrl,'https://api-sandbox.asaas.com/v3');
});

test('explicit Sandbox credentials override the existing Sandbox secret names',()=>{
 const config=asaasConfig({...secrets,ASAAS_SANDBOX:'true',ASAAS_SANDBOX_API_KEY:'sandbox-key-two',ASAAS_SANDBOX_WEBHOOK_TOKEN:'sandbox-token-two'});
 assert.equal(config.apiKey,'sandbox-key-two');assert.equal(config.webhookToken,'sandbox-token-two');
});

test('production uses its own API key and webhook token and never falls back to Sandbox',()=>{
 const config=asaasConfig({...secrets,ASAAS_SANDBOX:'false'});
 assert.equal(config.apiKey,productionKey);assert.equal(config.webhookToken,secrets.ASAAS_PRODUCTION_WEBHOOK_TOKEN);
 assert.equal(config.apiUrl,'https://api.asaas.com/v3');
 assert.equal(asaasConfig({ASAAS_SANDBOX:'false',ASAAS_API_KEY:sandboxKey,ASAAS_WEBHOOK_TOKEN:'old-token'}).apiKey,null);
 assert.equal(asaasConfig({ASAAS_SANDBOX:'false',ASAAS_WEBHOOK_TOKEN:'old-token'}).webhookToken,null);
});

test('known wrong-environment keys, whitespace and an unspecified environment are rejected',()=>{
 assert.equal(asaasConfig({ASAAS_SANDBOX:'true',ASAAS_API_KEY:productionKey}).apiKey,null);
 assert.equal(asaasConfig({ASAAS_SANDBOX:'false',ASAAS_PRODUCTION_API_KEY:sandboxKey}).apiKey,null);
 assert.equal(asaasConfig({ASAAS_SANDBOX:'false',ASAAS_PRODUCTION_API_KEY:' key with spaces '}).apiKey,null);
 assert.equal(asaasConfig(secrets).apiKey,null);
});

test('requests go only to the active provider environment with its matching key',async()=>{
 for(const mode of ['true','false']){
  let count=0;
  await asaasRequest('/customers',{...secrets,ASAAS_SANDBOX:mode},{name:'Example'}, {request:async(url,options)=>{
   count++;assert.equal(url,mode==='true'?'https://api-sandbox.asaas.com/v3/customers':'https://api.asaas.com/v3/customers');
   assert.equal(options.headers.access_token,mode==='true'?sandboxKey:productionKey);
   assert.equal(options.redirect,'error');assert.equal(options.headers['user-agent'],'StreetballStore/1.0');
   return Response.json({id:'fake_customer'});
  }});
  assert.equal(count,1);
 }
 await assert.rejects(asaasRequest('/customers',{ASAAS_SANDBOX:'false',ASAAS_API_KEY:sandboxKey},{},
  {request:()=>assert.fail('No provider call is allowed without a production key')}),/não configurada/);
});

test('staged keys cannot release production without the existing commercial gates and webhook token',async()=>{
 assert.equal((await readiness({...commercial,...secrets,ASAAS_SANDBOX:'false',PAYMENTS_PRODUCTION_ENABLED:'false'})).enabled,false);
 assert.equal((await readiness({...commercial,...secrets,ASAAS_SANDBOX:'false',IMPORT_COMPLIANCE_APPROVED:'false'})).enabled,false);
 assert.equal((await readiness({...commercial,...secrets,ASAAS_SANDBOX:'false',ASAAS_PRODUCTION_WEBHOOK_TOKEN:undefined})).enabled,false);
 assert.equal((await readiness({...commercial,ASAAS_API_KEY:sandboxKey,ASAAS_WEBHOOK_TOKEN:'old-token',ASAAS_SANDBOX:'false'})).enabled,false);
 const ready=await readiness({...commercial,...secrets,ASAAS_SANDBOX:'false'});
 assert.equal(ready.enabled,true);assert.equal(ready.sandbox,false);
 assert.ok(!JSON.stringify(ready).includes(productionKey));assert.ok(!JSON.stringify(ready).includes(secrets.ASAAS_PRODUCTION_WEBHOOK_TOKEN));
});

test('the webhook accepts only the active environment token before touching payment data',async()=>{
 for(const mode of ['true','false']){
  const active=mode==='true'?secrets.ASAAS_WEBHOOK_TOKEN:secrets.ASAAS_PRODUCTION_WEBHOOK_TOKEN;
  for(const candidate of [secrets.ASAAS_WEBHOOK_TOKEN,secrets.ASAAS_PRODUCTION_WEBHOOK_TOKEN]){
   const response=await worker.fetch(new Request('https://loja.example/api/webhooks/asaas',{method:'POST',
    headers:{'content-type':'application/json','asaas-access-token':candidate},body:'{}'}),{...secrets,ASAAS_SANDBOX:mode,DB:{}});
   assert.equal(response.status,candidate===active?400:401);
  }
 }
});
