import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {releaseProduction} from './production-release.mjs';
import {prepareState,readJson,statePaths,writePrivateJson} from './state.mjs';

const rootHere=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const toml=fs.readFileSync(path.join(rootHere,'wrangler.toml'),'utf8');
const technical={cadastroPublico:true,chaveProducaoConfigurada:true,tokenWebhookConfigurado:true,chaveAutenticada:true,
 contaAprovada:true,contaCorrespondeAoCnpj:true,webhookEncontrado:true,webhookUnico:true,webhookAtivado:true,
 eventosCorretos:true,entregaWebhookCorreta:true};
const readiness=live=>({ok:true,ambienteAtivo:live?'producao':'sandbox',configuracaoPagamentoConferida:live,
 verificacoes:{...technical,revisaoImportacaoConcluida:live,pagamentosReaisLiberados:live}});

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'streetball-release-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'wrangler.toml'),toml);
 const paths=statePaths(root,'darwin');prepareState(paths);
 writePrivateJson(paths.config,{enabled:true,ordersEnabled:false,storeUrl:'https://lojastreetball.com.br',token:'a'.repeat(48)});
 writePrivateJson(path.join(paths.auth,'creds.json'),{me:{id:'5511999999999:1@s.whatsapp.net'}});
 const steps=[],logs=[];let deployed=false,time=0;
 const options={root,paths,log:message=>logs.push(message),clock:()=>time,pause:async ms=>{time+=ms;},
  remote:async action=>{
   steps.push(action+(deployed?':after':':before'));
   if(action==='production-status')return readiness(deployed);
   if(action==='orders-status')return {ok:true,enabled:deployed,mode:deployed?'live_orders':'preview_only'};
   if(action==='status')return {ok:true,online:true};
   assert.fail('Unexpected action: '+action);
  },
  restart:async input=>{
   assert.equal(input.paths,paths);assert.equal(readJson(paths.config).ordersEnabled,true);
   steps.push('restart');return {ativo:true,estado:'connected'};
  },
  run:(program,args,config)=>{
   assert.equal(program,'npx');assert.deepEqual(args,['--yes','wrangler@4','deploy']);
   assert.equal(config.cwd,root);assert.equal(config.stdio,'inherit');
   assert.ok(steps.includes('restart'));assert.ok(steps.includes('status:before'));
   deployed=true;steps.push('deploy');return {status:0};
  },
  request:async(url,options)=>{
   assert.equal(deployed,true);assert.equal(url,'https://lojastreetball.com.br/api/checkout/config');
   assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.body,undefined);
   steps.push('checkout');return Response.json({enabled:true,sandbox:false,shipping:0,
    customerPaysImportTaxesPlanned:true,productionImportComplianceReviewed:true});
  }};
 return {root,paths,options,steps,logs};
}

test('release reconnects the saved account before publishing and confirms the real checkout and order bridge',async t=>{
 const f=fixture(t),before=fs.readFileSync(path.join(f.root,'wrangler.toml'),'utf8');
 const result=await releaseProduction(f.options);
 assert.deepEqual(f.steps,['production-status:before','orders-status:before','restart','status:before','deploy',
  'production-status:after','checkout','orders-status:after','status:after']);
 assert.equal(result.ambienteAtivo,'producao');assert.equal(result.encaminhamentoPedidosAtivo,true);
 assert.equal(result.pagamentoFornecedorAutomatico,false);assert.equal(readJson(f.paths.config).ordersEnabled,true);
 assert.equal(fs.statSync(f.paths.config).mode&0o777,0o600);
 assert.equal(fs.readFileSync(path.join(f.root,'wrangler.toml'),'utf8'),before);
 assert.ok(f.logs.some(message=>message.includes('Vendas reais liberadas')));
 assert.ok(!f.logs.join('\n').includes('a'.repeat(48)));
});

test('a missing, failed or unknown technical check stops before changing local orders or deployment',async t=>{
 for(const key of Object.keys(technical))for(const value of [false,null,undefined]){
  const f=fixture(t),report=readiness(false);report.verificacoes[key]=value;
  await assert.rejects(releaseProduction({...f.options,remote:async()=>report,
   restart:()=>assert.fail('No restart'),run:()=>assert.fail('No deployment')}),/verificações/);
  assert.equal(readJson(f.paths.config).ordersEnabled,false);
 }
});

test('release rejects a different Worker, incomplete approval, duplicate flag or incorrect shipping',async t=>{
 for(const changed of [toml.replace('name = "streetball-store"','name = "another-worker"'),
  toml.replace('IMPORT_COMPLIANCE_APPROVED = "true"','IMPORT_COMPLIANCE_APPROVED = "false"'),
  toml.replace('WA_LOCAL_ORDERS_ENABLED = "true"','WA_LOCAL_ORDERS_ENABLED = "false"'),
  toml.replace('SHIPPING_FLAT_BRL = "0.00"','SHIPPING_FLAT_BRL = "10.00"'),
  toml+'\nASAAS_SANDBOX = "true"\n']){
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'wrangler.toml'),changed);
  await assert.rejects(releaseProduction({...f.options,remote:()=>assert.fail('No provider queries'),run:()=>assert.fail('No deployment')}),/configuração/);
 }
});

test('an unavailable orders schema or a connector for a different store prevents release',async t=>{
 const f=fixture(t);
 await assert.rejects(releaseProduction({...f.options,remote:async action=>action==='production-status'?readiness(false):{ok:true},
  run:()=>assert.fail('No deployment'),restart:()=>assert.fail('No restart')}),/fila de pedidos/);
 writePrivateJson(f.paths.config,{...readJson(f.paths.config),storeUrl:'https://other.example'});
 await assert.rejects(releaseProduction({...f.options,remote:()=>assert.fail('No queries')}),/vinculada/);
});

test('a failed restart restores local order settings and does not publish production',async t=>{
 for(const restart of [async()=>{throw Error('Serviço indisponível');},async()=>({ativo:false,estado:'stopped'})]){
  const f=fixture(t);
  await assert.rejects(releaseProduction({...f.options,restart,run:()=>assert.fail('No deployment')}));
  assert.equal(readJson(f.paths.config).ordersEnabled,false);
  assert.ok(!f.logs.some(message=>message.includes('Vendas reais liberadas')));
 }
});

test('a connected WhatsApp without a server heartbeat cannot publish a live checkout',async t=>{
 const f=fixture(t),remote=f.options.remote;
 await assert.rejects(releaseProduction({...f.options,remote:async action=>action==='status'?{ok:true,online:false}:remote(action),
  run:()=>assert.fail('No deployment')}),/presença/);
});

test('release waits for the restarted connector to register its heartbeat before deploying',async t=>{
 const f=fixture(t),remote=f.options.remote;let attempts=0;
 await releaseProduction({...f.options,remote:async action=>{
  if(action==='status'&&!f.steps.includes('deploy')&&++attempts<3)return {ok:true,online:false};
  return remote(action);
 }});
 assert.equal(attempts,3);assert.equal(f.steps.filter(step=>step==='deploy').length,1);
});

test('a failed deployment does not claim release or run post-publication checks',async t=>{
 const f=fixture(t);
 await assert.rejects(releaseProduction({...f.options,run:()=>({status:1}),request:()=>assert.fail('No checkout read')}),/publicação não foi confirmada/);
 assert.ok(!f.steps.includes('production-status:after'));
 assert.ok(!f.logs.some(message=>message.includes('Vendas reais liberadas')));
});

test('release cannot claim success if the published payment settings or checkout remain in Sandbox',async t=>{
 for(const stage of ['report','checkout']){
  const f=fixture(t),remote=f.options.remote;
  await assert.rejects(releaseProduction({...f.options,
   remote:async action=>stage==='report'&&action==='production-status'&&f.steps.includes('deploy')?readiness(false):remote(action),
   request:stage==='checkout'?async()=>Response.json({enabled:true,sandbox:true,shipping:0}):f.options.request}),/não foi confirmado|não foi confirmada/);
  assert.ok(!f.logs.some(message=>message.includes('Vendas reais liberadas')));
 }
});

test('release does not claim success if order forwarding or connectivity fails after publishing',async t=>{
 for(const stage of ['orders-status','status']){
  const f=fixture(t),remote=f.options.remote;
  await assert.rejects(releaseProduction({...f.options,remote:async action=>action===stage&&f.steps.includes('deploy')?
   {ok:true,enabled:false,mode:'preview_only',online:false}:remote(action)}),/encaminhamento de pedidos não foi confirmado/);
  assert.ok(!f.logs.some(message=>message.includes('Vendas reais liberadas')));
 }
});

test('a repeat release can reconnect and verify an already published real environment',async t=>{
 const f=fixture(t),remote=f.options.remote;
 await releaseProduction({...f.options,remote:async action=>action==='production-status'?readiness(true):remote(action)});
 assert.equal(f.steps.filter(step=>step==='deploy').length,1);
 assert.ok(f.logs.some(message=>message.includes('Vendas reais liberadas')));
});
