import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareSupplierPayouts} from './payout-setup.mjs';
import {configureSupplierPayout} from './payout-config.mjs';
import {prepareState,statePaths,writePrivateJson,readJson} from './state.mjs';

function fixture(t){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'supplier-payout-cli-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const paths=statePaths(home,'darwin');prepareState(paths);
 writePrivateJson(paths.config,{enabled:true,ordersEnabled:true,storeUrl:'https://lojastreetball.com.br',token:'a'.repeat(43)});
 writePrivateJson(path.join(paths.auth,'creds.json'),{me:{id:'5511999999999@s.whatsapp.net'}});
 const calls=[],logs=[],state={configured:false,enabled:false},options={paths,root:home,log:line=>logs.push(line),
  async prepare(){calls.push({prepare:true});},
  async api(_config,_account,action,body){calls.push({action,body});return {ok:true,available:true,version:'supplier-pix-v1',authorizationTokenConfigured:state.configured,enabled:state.enabled};},
  run(command,args,opts){calls.push({command,args,opts});if(command==='npx')state.configured=true;return {status:0};}};
 return {home,paths,calls,logs,state,options};
}
test('preparation keeps the payout token private, sends it on stdin, copies it locally and never activates payments',async t=>{
 const f=fixture(t),before=fs.readFileSync(f.paths.config,'utf8'),result=await prepareSupplierPayouts(f.options);
 const file=path.join(f.paths.base,'supplier-payout-setup.json'),saved=readJson(file);
 assert.equal(saved.token.length,43);assert.equal(fs.statSync(file).mode&0o777,0o600);
 const secret=f.calls.find(c=>c.command==='npx');assert.deepEqual(secret.args,['--yes','wrangler@4','secret','put','ASAAS_SUPPLIER_PAYOUT_AUTH_TOKEN']);
 assert.equal(secret.opts.input,saved.token+'\n');assert.ok(!JSON.stringify(secret.args).includes(saved.token));
 assert.equal(f.calls.find(c=>c.command==='pbcopy').opts.input,saved.token);
 assert.ok(!f.logs.join('\n').includes(saved.token));assert.ok(!f.calls.some(c=>c.action==='orders-payout-enable'));
 assert.equal(result.enabled,false);assert.equal(fs.readFileSync(f.paths.config,'utf8'),before);
 await prepareSupplierPayouts(f.options);assert.equal(readJson(file).token,saved.token);
});
test('an existing remote key without its original local record cannot be silently replaced',async t=>{
 const f=fixture(t);f.state.configured=true;
 await assert.rejects(prepareSupplierPayouts(f.options),/token já existe/);assert.ok(!f.calls.some(c=>c.command==='npx'));
});
test('failed token upload and clipboard copy never produce a successful preparation message',async t=>{
 for(const target of ['npx','pbcopy']){
  const f=fixture(t),original=f.options.run;
  f.options.run=(command,args,opts)=>command===target?{status:1}:original(command,args,opts);
  await assert.rejects(prepareSupplierPayouts(f.options));assert.ok(!f.logs.some(line=>line.includes('Executor preparado')));
 }
});
test('preparation preserves an already enabled executor and the same bank authorization key',async t=>{
 const f=fixture(t);await prepareSupplierPayouts(f.options);f.state.enabled=true;
 const file=path.join(f.paths.base,'supplier-payout-setup.json'),token=readJson(file).token;
 const result=await prepareSupplierPayouts(f.options);assert.equal(result.enabled,true);assert.equal(readJson(file).token,token);
 assert.ok(f.logs.some(line=>line.includes('já estava habilitado')));
});

function configFixture(t,answers){
 const f=fixture(t),preview={billingId:'sb_'+'a'.repeat(32),orderId:'1234abcd-1234-4234-8234-123456789012',supplierId:'supplier1',
  expectedUsd:'15.00',valueBrl:'76.80',receiverName:'Recebedor fictício',receiverDocument:'000…0100',receiverBinding:'fake-binding'};
 const options={paths:f.paths,log:line=>f.logs.push(line),async ask(){if(!answers.length)assert.fail('Unexpected input request');return answers.shift();},
  async api(_config,_account,action,body){f.calls.push({action,body});
   if(action==='orders-payout-inspect')return preview;
   if(action==='orders-payout-profiles')return {profiles:[{supplierId:'supplier1',revision:1}]};
   if(action==='orders-payout-profile')return {ok:true,revision:2,pagamentoIniciado:false};
   if(action==='orders-payout-enable')return {ok:true,enabled:true};
   if(action==='orders-payout-resolve')return {ok:true,consultaSomenteLeituraNoAsaas:true,novoPagamentoSolicitado:false};
   assert.fail('Unexpected action');
  }};
 return {...f,options};
}
test('profile entry confirms a bank-bound receiver, records every expense and preserves the revision check without starting Pix',async t=>{
 const f=configFixture(t,['RECEBEDOR','1','5,12','0','5','0','6','60']);await configureSupplierPayout('profile',f.options);
 const call=f.calls.find(c=>c.action==='orders-payout-profile');assert.ok(call);assert.equal(call.body.expectedRevision,1);
 assert.equal(call.body.receiverBinding,'fake-binding');assert.equal(call.body.profile.exchangeRateMode,'fixed');assert.equal(call.body.profile.exchangeRateBrlPerUsd,'5.12');
 assert.equal(call.body.profile.salesCostRate,'0.0600');assert.equal(call.body.profile.receiverCpfCnpj,undefined);
 assert.ok(!f.calls.some(c=>c.action==='orders-payout-enable'));
});
test('accepting a quoted exchange rate is a separate explicit choice and never becomes an inferred fixed FX rate',async t=>{
 const f=configFixture(t,['RECEBEDOR','2','0','5','0','0','60']);await configureSupplierPayout('profile',f.options);
 const saved=f.calls.find(c=>c.action==='orders-payout-profile').body.profile;
 assert.equal(saved.exchangeRateMode,'supplier_quote');assert.equal(saved.exchangeRateBrlPerUsd,null);
 assert.ok(f.logs.some(line=>line.includes('não compara a cotação com uma taxa de mercado')));
});
test('missing expenses or an unconfirmed receiver stop before a financial profile is saved',async t=>{
 for(const answers of [['NAO'],['RECEBEDOR','1','5.12','']]){
  const f=configFixture(t,answers);await assert.rejects(configureSupplierPayout('profile',f.options));assert.ok(!f.calls.some(c=>c.action==='orders-payout-profile'));
 }
});
test('activation attests the actual Asaas configuration and sends the current cost-policy version',async t=>{
 const f=configFixture(t,['CONFIGURADO']);await configureSupplierPayout('enable',f.options);
 const call=f.calls.find(c=>c.action==='orders-payout-enable');assert.equal(call.body.securityWebhookConfigured,true);assert.equal(call.body.costPolicyVersion,'shared-usd-20261027-v1');
 const other=configFixture(t,['NAO']);await assert.rejects(configureSupplierPayout('enable',other.options));assert.ok(!other.calls.length);
});
test('pending Pix recovery sends only the existing intent and transaction IDs to the read-only reconciliation',async t=>{
 const intentId='11111111-2222-4333-8444-555555555555',transactionId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
 const f=configFixture(t,[intentId,transactionId]);const result=await configureSupplierPayout('resolve',f.options);
 assert.equal(result.novoPagamentoSolicitado,false);assert.deepEqual(f.calls,[{action:'orders-payout-resolve',body:{intentId,transactionId}}]);
});
