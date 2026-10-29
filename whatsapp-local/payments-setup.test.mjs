import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configureProductionKey,prepareProduction} from './payments-setup.mjs';

function fixture(t,toml='name="streetball-store"\nASAAS_SANDBOX="true"\nPAYMENTS_PRODUCTION_ENABLED="false"\nWA_AUTOMATION_ENABLED="false"\n'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'streetball-payment-stage-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'wrangler.toml'),toml);
 return {root,before:toml};
}
const sandbox=async(url,options)=>{
 assert.equal(url,'https://lojastreetball.com.br/api/checkout/config');assert.equal(options.redirect,'error');
 return Response.json({sandbox:true,enabled:true});
};

test('production staging targets only the separate secret and lets Wrangler collect it privately',async t=>{
 const {root,before}=fixture(t),messages=[];let calls=0;
 await configureProductionKey({root,request:sandbox,log:value=>messages.push(value),run:(program,args,options)=>{
  calls++;assert.equal(program,'npx');assert.deepEqual(args,['--yes','wrangler@4','secret','put','ASAAS_PRODUCTION_API_KEY']);
  assert.equal(options.cwd,root);assert.equal(options.stdio,'inherit');assert.equal(options.input,undefined);
  return {status:0};
 }});
 assert.equal(calls,1);assert.equal(fs.readFileSync(path.join(root,'wrangler.toml'),'utf8'),before);
 assert.deepEqual(fs.readdirSync(root),['wrangler.toml']);
 assert.ok(messages.some(value=>value.includes('Chave de produção cadastrada')));
});

test('staging never modifies a different Worker or an already enabled production configuration',async t=>{
 for(const toml of ['name="another-worker"\nASAAS_SANDBOX="true"\nPAYMENTS_PRODUCTION_ENABLED="false"\nWA_AUTOMATION_ENABLED="false"\n',
  'name="streetball-store"\nASAAS_SANDBOX="false"\nPAYMENTS_PRODUCTION_ENABLED="true"\nWA_AUTOMATION_ENABLED="true"\n']){
  const {root}=fixture(t,toml);
  await assert.rejects(configureProductionKey({root,request:()=>assert.fail('Local validation must happen first'),run:()=>assert.fail(),log:()=>{}}),/configuração local/);
 }
});

test('staging stops before upload if the deployed environment changed or cannot be checked',async t=>{
 const {root}=fixture(t);
 for(const request of [async()=>Response.json({sandbox:false}),async()=>Response.json({sandbox:true},{status:503}),async()=>{throw Error('offline');}]){
  await assert.rejects(configureProductionKey({root,request,run:()=>assert.fail('No secret may be uploaded'),log:()=>{}}),/Nenhuma chave foi alterada/);
 }
});

test('a failed secret upload is not reported as a configured production key',async t=>{
 const {root}=fixture(t),messages=[];
 await assert.rejects(configureProductionKey({root,request:sandbox,run:()=>({status:1}),log:value=>messages.push(value)}),/não foi confirmado/);
 assert.ok(!messages.some(value=>value.includes('Chave de produção cadastrada')));
});

test('preparation publishes the existing Sandbox configuration then inspects through the private bridge',async t=>{
 const {root,before}=fixture(t),steps=[],logs=[];
 const report={ok:true,configuracaoPagamentoConferida:false,consultaSomenteLeitura:true};
 const result=await prepareProduction({root,request:sandbox,run:(program,args,options)=>{
  assert.equal(program,'npx');assert.deepEqual(args,['--yes','wrangler@4','deploy']);assert.equal(options.cwd,root);
  assert.equal(options.stdio,'inherit');steps.push('deploy');return {status:0};
 },inspect:async()=>{assert.deepEqual(steps,['deploy']);steps.push('inspect');return report;},log:value=>logs.push(value)});
 assert.equal(result,report);assert.deepEqual(steps,['deploy','inspect']);
 assert.equal(fs.readFileSync(path.join(root,'wrangler.toml'),'utf8'),before);
 assert.ok(logs.includes(JSON.stringify(report,null,2)));
});

test('failed preparation cannot claim to have checked the provider or change the release flags',async t=>{
 const {root,before}=fixture(t);
 await assert.rejects(prepareProduction({root,request:sandbox,run:()=>({status:1}),inspect:()=>assert.fail('No inspection after a failed deploy'),log:()=>{}}),/publicação não foi confirmada/);
 assert.equal(fs.readFileSync(path.join(root,'wrangler.toml'),'utf8'),before);
});
