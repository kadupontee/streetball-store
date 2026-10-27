import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configureProductionKey} from './payments-setup.mjs';

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
