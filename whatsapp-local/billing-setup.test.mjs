import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareBilling} from './billing-setup.mjs';
import {statePaths,prepareState,writePrivateJson} from './state.mjs';
import {BILLING_FORMAT_VERSION} from '../worker/supplier-billing-format.js';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'billing-setup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const paths=statePaths(path.join(root,'home'),'darwin');prepareState(paths);
 const toml=fs.readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
 fs.writeFileSync(path.join(root,'wrangler.toml'),toml);
 writePrivateJson(path.join(paths.auth,'creds.json'),{me:{id:'5511999999999@s.whatsapp.net'}});
 writePrivateJson(paths.config,{enabled:true,ordersEnabled:true,storeUrl:'https://lojastreetball.com.br',token:'a'.repeat(43)});
 const calls=[],messages=[];
 const options={platform:'darwin',root,paths,run(...args){calls.push({run:args});return {status:0};},
  async api(...args){calls.push({api:args});return {ok:true,available:true,enabled:true,version:BILLING_FORMAT_VERSION,pagamentoAutomaticoHabilitado:false};},
  async restart(...args){calls.push({restart:args});},log:value=>messages.push(value)};
 return {root,paths,toml,calls,messages,options};
}

test('billing setup migrates then deploys, confirms the version and restarts without changing private config or activating payouts',async t=>{
 const f=fixture(t),config=fs.readFileSync(f.paths.config,'utf8');
 const result=await prepareBilling(f.options);
 assert.equal(f.calls.length,4);assert.deepEqual(f.calls[0].run[1],['--yes','wrangler@4','d1','execute','streetball-db','--remote','--file=worker/local-orders-schema.sql','--yes']);
 assert.deepEqual(f.calls[1].run[1],['--yes','wrangler@4','deploy']);assert.equal(f.calls[2].api[2],'orders-billing-status');assert.ok(f.calls[3].restart);
 assert.equal(fs.readFileSync(f.paths.config,'utf8'),config);assert.equal(fs.readFileSync(path.join(f.root,'wrangler.toml'),'utf8'),f.toml);
 assert.equal(result.pagamentoAutomaticoHabilitado,false);assert.ok(f.messages.some(m=>m.includes('não libera débitos')));
});
test('an invalid environment or disconnected order configuration is rejected before remote changes',async t=>{
 for(const change of [f=>f.options.platform='linux',f=>fs.writeFileSync(path.join(f.root,'wrangler.toml'),f.toml.replace('"false"','"true"')),
  f=>fs.writeFileSync(path.join(f.root,'wrangler.toml'),f.toml.replace('[vars]','[vars]\nASAAS_SANDBOX = "false"')),
  f=>fs.writeFileSync(path.join(f.root,'wrangler.toml'),f.toml.replace('[vars]','[vars]\nWA_LOCAL_ORDERS_ENABLED = "false"')),
  f=>writePrivateJson(f.paths.config,{enabled:false})]){
  const f=fixture(t);change(f);await assert.rejects(prepareBilling(f.options));assert.equal(f.calls.length,0);
 }
});
test('migration/deploy failures and unconfirmed published versions stop setup before a success message or restart',async t=>{
 for(const failedStep of [0,1]){
  const f=fixture(t);let n=0;f.options.run=(...args)=>{f.calls.push({run:args});return {status:n++===failedStep?1:0};};
  await assert.rejects(prepareBilling(f.options),/não foi confirmada/);assert.equal(f.calls.length,failedStep+1);assert.ok(!f.messages.some(m=>m.includes('Recebimento de cobranças preparado')));
 }
 const f=fixture(t);f.options.api=async()=>({ok:true,available:false,version:'old'});
 await assert.rejects(prepareBilling(f.options),/não confirmou/);assert.ok(!f.calls.some(c=>c.restart));
});
