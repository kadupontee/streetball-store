import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {connectionStatus,prepareState,statePaths} from './state.mjs';
import {inspectMacService,launchFailure,parseService,parseServicePolicy,serviceHealth,waitForConnection} from './service-health.mjs';
import {restartConnection} from './restart.mjs';
import {storeCommand} from './store-cli.mjs';

function fixture(t) {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'streetball-service-test-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const paths=statePaths(home,'darwin');prepareState(paths);
  const write=(file,data)=>fs.writeFileSync(file,JSON.stringify(data),{mode:0o600});
  write(path.join(paths.auth,'creds.json'),{registered:false,me:{id:'5511999999999:7@s.whatsapp.net'}});
  return {paths,write};
}

test('a stopped process never inherits connected state from an old status file',t=>{
  const {paths,write}=fixture(t);
  write(paths.lock,{pid:2147483647});write(paths.status,{pid:2147483647,state:'connected'});
  assert.equal(connectionStatus(paths).ativo,false);
  assert.equal(connectionStatus(paths).estado,'stopped');
  assert.equal(connectionStatus(paths).sessaoSalva,true);
});
test('a newly started process does not inherit the previous process status',t=>{
  const {paths,write}=fixture(t);
  write(paths.lock,{pid:process.pid});write(paths.status,{pid:2147483647,state:'connected',updatedAt:'old'});
  assert.equal(connectionStatus(paths).ativo,true);
  assert.equal(connectionStatus(paths).estado,'starting');
  assert.equal(connectionStatus(paths).atualizadoEm,null);
  write(paths.status,{pid:process.pid,state:'connected',updatedAt:'current'});
  assert.equal(connectionStatus(paths).estado,'connected');
});
test('launchctl diagnostics extract state, PID and exit code without exposing its environment',()=>{
  const data=parseService({status:0,stdout:'service = {\n state = waiting\n last exit code = 78\n pid = 1234\n environment = {\n PRIVATE_TOKEN = do-not-print-me\n }\n}'});
  assert.equal(data.estado,'waiting');assert.equal(data.pid,1234);assert.equal(data.ultimoCodigoSaida,78);
  assert.ok(!JSON.stringify(data).includes('PRIVATE_TOKEN'));
  assert.equal(parseService({status:113,stderr:'not found'}).cadastrado,false);
});
test('start failure includes the native code and only the first error line',()=>{
  const message=launchFailure({status:5,stderr:'Bootstrap failed: 5: Input/output error\nTry running as root\n'});
  assert.match(message,/launchctl 5/);assert.match(message,/Input\/output/);assert.ok(!message.includes('root'));
  assert.match(launchFailure({error:{code:'ETIMEDOUT'},status:null}),/ETIMEDOUT/);
});
test('only Streetball disabled policy is parsed, across boolean and named launchctl formats',()=>{
  assert.equal(parseServicePolicy({status:0,stdout:'disabled services = {\n "com.other.private" => true\n "com.streetball.whatsapp" => false\n}'}),false);
  assert.equal(parseServicePolicy({status:0,stdout:' "com.streetball.whatsapp" => true\n'}),true);
  assert.equal(parseServicePolicy({status:0,stdout:' "com.streetball.whatsapp" => disabled\n'}),true);
  assert.equal(parseServicePolicy({status:0,stdout:' "com.streetball.whatsapp" => enabled\n'}),false);
  assert.equal(parseServicePolicy({status:0,stdout:'disabled services = {}'}),false);
  assert.equal(parseServicePolicy({status:1}),null);
});
test('an unloaded disabled service is diagnosed without exposing other applications',()=>{
  const current=inspectMacService({platform:'darwin',uid:501,run:args=>{
    if(args[0]==='print'){assert.equal(args[1],'gui/501/com.streetball.whatsapp');return {status:113};}
    assert.deepEqual(args,['print-disabled','gui/501']);
    return {status:0,stdout:' "com.other.private" => true\n "com.streetball.whatsapp" => disabled\n'};
  }});
  assert.equal(current.cadastrado,false);assert.equal(current.desativado,true);
  assert.ok(!JSON.stringify(current).includes('com.other.private'));
});
test('readiness reports a disabled service immediately with the macOS settings location',async()=>{
  await assert.rejects(waitForConnection({snapshot:()=>({ativo:false,servicoDoMac:{desativado:true}}),
    pause:()=>assert.fail('A disabled service must not wait for a connection'),log:()=>{}}),/desativou.*Itens de Início/);
});
test('readiness requires the connected process to match the macOS service PID',async()=>{
  let time=0,step=0;
  const snapshots=[
    {ativo:true,estado:'connected',processoPid:10,servicoDoMac:{cadastrado:true,pid:20}},
    {ativo:true,estado:'connected',processoPid:10,servicoDoMac:{cadastrado:true,pid:10}}
  ];
  const result=await waitForConnection({snapshot:()=>snapshots[Math.min(step++,1)],clock:()=>time,
    pause:async ms=>{time+=ms;},log:()=>{}});
  assert.equal(step,2);assert.equal(result.processoPid,10);
});
test('a service that never starts reports timeout rather than confirming readiness',async()=>{
  let time=0;
  await assert.rejects(waitForConnection({snapshot:()=>({ativo:false,estado:'stopped',servicoDoMac:{cadastrado:true,pid:null}}),
    clock:()=>time,pause:async ms=>{time+=ms;},timeoutMs:1000,log:()=>{}}),/não foi confirmada/);
});
test('restart waits for the old process, starts once, verifies readiness and preserves auth',async t=>{
  const {paths}=fixture(t),commands=[];
  const before=fs.readFileSync(path.join(paths.auth,'creds.json'),'utf8');
  let checks=0,time=0;
  await restartConnection({paths,command:value=>commands.push(value),isRunning:()=>checks++<2,
    clock:()=>time,pause:async ms=>{time+=ms;},ready:async()=>commands.push('ready'),log:()=>{}});
  assert.deepEqual(commands,['stop','start','ready']);
  assert.equal(time,400);
  assert.equal(fs.readFileSync(path.join(paths.auth,'creds.json'),'utf8'),before);
});
test('restart never starts a second instance while another process is still alive',async t=>{
  const {paths}=fixture(t),commands=[];let time=0;
  await assert.rejects(restartConnection({paths,command:value=>commands.push(value),isRunning:()=>true,
    clock:()=>time,pause:async()=>{time+=8000;},ready:async()=>commands.push('ready'),log:()=>{}}),/anterior ainda está ativa/);
  assert.deepEqual(commands,['stop']);
});
test('restart awaits asynchronous unload and preserves the login registration file',async t=>{
  const {paths}=fixture(t),commands=[];
  await restartConnection({paths,isRunning:()=>false,command:async(value,options)=>{
    if(value==='stop'){
      assert.equal(options.removeAgent,false);
      await Promise.resolve();commands.push('unloaded');
    } else {assert.deepEqual(commands,['unloaded']);commands.push('started');}
  },ready:async()=>commands.push('ready'),log:()=>{}});
  assert.deepEqual(commands,['unloaded','started','ready']);
});
test('diagnostics omit credentials, bridge tokens, arbitrary log dumps and chat text',t=>{
  const {paths,write}=fixture(t),token='A'.repeat(43);
  write(paths.config,{enabled:true,token});
  fs.writeFileSync(paths.log,'private chat text\nSESSION_KEY='+token+'\nError: authorization Bearer '+token+'\nConectado. Esta etapa não envia pedidos a fornecedores.\n');
  const data=serviceHealth(paths,()=>({cadastrado:false,pid:null})),out=JSON.stringify(data);
  assert.equal(data.ponteConfigurada,true);assert.equal(data.sessaoSalva,true);
  assert.ok(!out.includes(token));assert.ok(!out.includes('private chat text'));assert.ok(!out.includes('5511999999999'));
});

test('store test tells a stopped process to restart instead of asking it to wait',async t=>{
  const {paths,write}=fixture(t);
  write(paths.config,{enabled:true,storeUrl:'https://loja.example',token:'A'.repeat(43)});
  await assert.rejects(storeCommand('test',paths),/parado.*reiniciar/);
});

test('store test does not inherit connected status from an earlier process',async t=>{
  const {paths,write}=fixture(t);
  write(paths.config,{enabled:true,storeUrl:'https://loja.example',token:'A'.repeat(43)});
  write(paths.lock,{pid:process.pid});write(paths.status,{pid:2147483647,state:'connected'});
  await assert.rejects(storeCommand('test',paths),/não foi confirmada/);
});
