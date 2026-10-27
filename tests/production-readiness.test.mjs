import test from 'node:test';
import assert from 'node:assert/strict';
import {productionReadiness,validCnpj} from '../worker/production-readiness.js';
import {handleLocalWhatsApp} from '../worker/local-whatsapp.js';

const token='owner-bridge-secret-with-more-than-32-characters',account='5511999999999@s.whatsapp.net';
const key='$aact_prod_PRIVATE_KEY',webhookToken='PRIVATE_WEBHOOK_TOKEN';
const merchant={legalName:'Empresa de teste',cnpj:'11.222.333/0001-81',address:'Rua Exemplo, 123',email:'store@example.invalid',shippingBrl:0,deliveryMinDays:15,deliveryMaxDays:45,customerPaysImportTaxes:true};
const goodHook={url:'https://lojastreetball.com.br/api/webhooks/asaas',enabled:false,interrupted:false,apiVersion:3,sendType:'SEQUENTIALLY',events:['PAYMENT_RECEIVED','PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED'],authToken:'PRIVATE_PROVIDER_TOKEN'};
function fixture({profile=merchant,status={general:'APPROVED'},commercial={cpfCnpj:merchant.cnpj,email:'PRIVATE_EMAIL',incomeValue:12345},hooks=[goodHook],providerStatus=200}={}){
 const calls=[];
 const env={ASAAS_SANDBOX:'true',ASAAS_PRODUCTION_API_KEY:key,ASAAS_API_KEY:'sandbox-key',ASAAS_PRODUCTION_WEBHOOK_TOKEN:webhookToken,
  IMPORT_TAX_DISCLOSURE_APPROVED:'false',IMPORT_COMPLIANCE_APPROVED:'false',SALES_ENABLED:'true',PAYMENTS_PRODUCTION_ENABLED:'false',
  ASSETS:{async fetch(req){assert.equal(new URL(req.url).pathname,'/merchant.json');return Response.json(profile);}}};
 const request=async(url,options)=>{
  calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.redirect,'error');
  assert.equal(options.headers.access_token,key);assert.ok(String(url).startsWith('https://api.asaas.com/v3/'));
  if(providerStatus!==200)return Response.json({errors:[{description:'PRIVATE_ERROR '+key}]},{status:providerStatus});
  if(url.endsWith('/myAccount/status/'))return Response.json(status);
  if(url.endsWith('/myAccount/commercialInfo/'))return Response.json(commercial);
  if(url.endsWith('/webhooks?limit=100'))return Response.json({data:hooks,hasMore:false});
  assert.fail('Unexpected provider endpoint');
 };
 return {env,request,calls};
}

test('seller CNPJ validation checks both digits and rejects repeated or incomplete numbers',()=>{
 assert.equal(validCnpj(merchant.cnpj),true);
 assert.equal(validCnpj('11.222.333/0001-80'),false);
 assert.equal(validCnpj('00000000000000'),false);
 assert.equal(validCnpj('11222333'),false);
});
test('preparation reads only production status, business identity and webhook settings without exposing private data',async()=>{
 const {env,request,calls}=fixture();const report=await productionReadiness(env,{request});
 assert.equal(calls.length,3);assert.equal(report.ambienteAtivo,'sandbox');assert.equal(report.consultaSomenteLeitura,true);
 assert.equal(report.verificacoes.cadastroPublico,true);assert.equal(report.verificacoes.chaveAutenticada,true);
 assert.equal(report.verificacoes.contaAprovada,true);assert.equal(report.verificacoes.contaCorrespondeAoCnpj,true);
 assert.equal(report.verificacoes.webhookEncontrado,true);assert.equal(report.verificacoes.eventosCorretos,true);
 assert.equal(report.verificacoes.webhookAtivado,false);assert.equal(report.configuracaoPagamentoConferida,false);
 const text=JSON.stringify(report);
 for(const value of [key,webhookToken,'PRIVATE_PROVIDER_TOKEN','PRIVATE_EMAIL','12345'])assert.ok(!text.includes(value));
});
test('missing credentials or an invalid seller profile never send a provider request',async()=>{
 for(const variant of ['no-key','bad-profile']){
  const {env}=fixture({profile:variant==='bad-profile'?{...merchant,cnpj:'invalid'}:merchant});
  if(variant==='no-key')delete env.ASAAS_PRODUCTION_API_KEY;
  const report=await productionReadiness(env,{request:()=>assert.fail('No request allowed')});
  assert.equal(report.configuracaoPagamentoConferida,false);
 }
});
test('a different or unverified account CNPJ cannot pass the release inspection',async()=>{
 for(const commercial of [{cpfCnpj:'99.999.999/0001-00'},{cpfCnpj:'12345678909'},{}]){
  const {env,request}=fixture({commercial});const report=await productionReadiness(env,{request});
  assert.notEqual(report.verificacoes.contaCorrespondeAoCnpj,true);assert.equal(report.configuracaoPagamentoConferida,false);
 }
});
test('webhook duplicates, wrong targets, missing events and interrupted delivery are reported',async()=>{
 for(const hooks of [[goodHook,goodHook],[{...goodHook,url:'https://another.example/webhook'}],
  [{...goodHook,events:['PAYMENT_RECEIVED']}],[{...goodHook,interrupted:true}],[{...goodHook,sendType:'NON_SEQUENTIALLY'}]]){
  const {env,request}=fixture({hooks});const report=await productionReadiness(env,{request});
  assert.equal(report.configuracaoPagamentoConferida,false);
  const c=report.verificacoes;assert.ok(!c.webhookUnico||!c.eventosCorretos||!c.entregaWebhookCorreta);
 }
});
test('provider errors and unavailable requests are sanitized and cannot confirm readiness',async()=>{
 const {env,request}=fixture({providerStatus:401});
 for(const read of [request,async()=>{throw Error('PRIVATE_NETWORK '+key);}]){
  const report=await productionReadiness(env,{request:read});assert.equal(report.verificacoes.chaveAutenticada,false);
  assert.equal(report.configuracaoPagamentoConferida,false);assert.ok(!JSON.stringify(report).includes('PRIVATE'));
 }
});
test('complete settings are distinguished from confirmation of token delivery by a real event',async()=>{
 const {env,request}=fixture({hooks:[{...goodHook,enabled:true}]});
 Object.assign(env,{ASAAS_SANDBOX:'false',PAYMENTS_PRODUCTION_ENABLED:'true',IMPORT_TAX_DISCLOSURE_APPROVED:'true',IMPORT_COMPLIANCE_APPROVED:'true'});
 const report=await productionReadiness(env,{request});assert.equal(report.configuracaoPagamentoConferida,true);
 assert.match(report.correspondenciaTokenWebhook,/A validar/);
});
test('only the bound authenticated connector can inspect production and the route does not write orders',async t=>{
 const {env,request,calls}=fixture();const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});globalThis.fetch=request;
 let reads=0;
 env.WA_LOCAL_BRIDGE_TOKEN=token;env.DB={prepare(sql){reads++;assert.match(sql,/SELECT account_jid,heartbeat_at FROM wa_local_bridge/);return {async first(){return {account_jid:account,heartbeat_at:new Date().toISOString()};}};}};
 const post=(secret,accountJid)=>handleLocalWhatsApp(new Request('https://lojastreetball.com.br/api/local-whatsapp/production-status',{method:'POST',headers:{authorization:'Bearer '+secret},body:JSON.stringify({accountJid})}),env);
 assert.equal((await post('wrong',account)).status,401);assert.equal(reads,0);assert.equal(calls.length,0);
 assert.equal((await post(token,'5511888888888@s.whatsapp.net')).status,409);assert.equal(calls.length,0);
 const response=await post(token,account);assert.equal(response.status,200);assert.equal((await response.json()).consultaSomenteLeitura,true);assert.equal(calls.length,3);
});
