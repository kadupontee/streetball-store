import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {statePaths,prepareState,readJson} from './state.mjs';
import {bridgeApi,readBridgeConfig,startStoreBridge,writePrivateJson} from './store-bridge.mjs';
import {wranglerSteps} from './integrate.mjs';

const id='11111111-1111-4111-8111-111111111111',lease='22222222-2222-4222-8222-222222222222';
const account='5511999999999@s.whatsapp.net';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settled(){for(let n=0;n<20;n++)await tick();}
function fixture(t){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'wa-store-test-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const paths=statePaths(home,'darwin');prepareState(paths);
 const sent=[],calls=[],timers=[],logs=[];
 const socket={user:{id:'5511999999999:9@s.whatsapp.net'},async sendMessage(...args){sent.push(args);return {key:{id:'FAKE_OWN_MESSAGE'}};}};
 let served=false;
 const api=async(_config,_account,action,data)=>{calls.push({action,data});
  if(action==='claim'){if(served)return {ok:true,job:null};served=true;return {ok:true,job:{id,lease,kind:'self_test_v1',accountJid:account}};}
  return {ok:true};};
 const options={socket,config:{storeUrl:'https://loja.example',token:'x'.repeat(43)},paths,api,
  log:value=>logs.push(value),schedule:fn=>{timers.push(fn);return fn;},cancel:()=>{}};
 return {paths,socket,sent,calls,logs,timers,api,options};
}
test('store bridge sends the fixed test only to its authenticated account and acknowledges it',async t=>{
 const h=fixture(t),runner=startStoreBridge(h.options);await settled();await runner.stop();
 assert.equal(h.sent.length,1);assert.equal(h.sent[0][0],account);
 assert.match(h.sent[0][1].text,/conexão entre o site/);
 assert.equal(h.calls.filter(x=>x.action==='ack').length,1);
 assert.equal(readJson(h.paths.journal)[id].phase,'acked');
 assert.equal(fs.statSync(h.paths.journal).mode&0o777,0o600);
});
test('unconfirmed sends survive a restart without duplicate messages',async t=>{
 const h=fixture(t);let rejectAck=true;
 const api=async(...args)=>{if(args[2]==='ack'&&rejectAck)throw Error('network');return h.api(...args);};
 const first=startStoreBridge({...h.options,api});await settled();await first.stop();
 assert.equal(h.sent.length,1);assert.equal(readJson(h.paths.journal)[id].phase,'sent');
 rejectAck=false;
 const second=startStoreBridge({...h.options,api});await settled();await second.stop();
 assert.equal(h.sent.length,1);assert.equal(readJson(h.paths.journal)[id].phase,'acked');
});
test('crashing during transmission never causes an automatic replay',async t=>{
 const h=fixture(t);writePrivateJson(h.paths.journal,{[id]:{phase:'sending',lease}});
 const api=async(...args)=>args[2]==='claim'?{ok:true,job:null}:h.api(...args);
 const runner=startStoreBridge({...h.options,api});await settled();await runner.stop();
 assert.deepEqual(h.sent,[]);assert.equal(h.calls[1].action,'uncertain');
});
test('a task addressed to another account is refused',async t=>{
 const h=fixture(t);
 const api=async(...args)=>{const r=await h.api(...args);if(r.job)r.job.accountJid='5511888888888@s.whatsapp.net';return r;};
 const runner=startStoreBridge({...h.options,api});await settled();await runner.stop();
 assert.deepEqual(h.sent,[]);assert.ok(!fs.existsSync(h.paths.journal));
});
test('configuration uses HTTPS and the API does not follow redirects or expose tokens',async t=>{
 const h=fixture(t);writePrivateJson(h.paths.config,{...h.options.config,enabled:true});
 assert.ok(readBridgeConfig(h.paths));
 let options;
 const fakeFetch=async(_url,value)=>{options=value;return new Response('{"ok":true}');};
 await bridgeApi(h.options.config,account,'status',{},fakeFetch);
 assert.equal(options.redirect,'error');assert.equal(JSON.parse(options.body).accountJid,account);
 writePrivateJson(h.paths.config,{...h.options.config,storeUrl:'http://loja.example',enabled:true});
 assert.throws(()=>readBridgeConfig(h.paths));
});
test('installation keeps the secret on stdin and only adds test tables before deployment',()=>{
 const steps=wranglerSteps('fake-private-token');
 assert.ok(steps[0].args.includes('--file=worker/local-whatsapp-schema.sql'));
 assert.equal(steps[1].input,'fake-private-token\n');
 assert.ok(!steps[1].args.includes('fake-private-token'));
 assert.deepEqual(steps[2].args,['deploy']);
});
