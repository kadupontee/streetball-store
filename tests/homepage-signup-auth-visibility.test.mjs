import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('os tres Criar conta da home sao visiveis apenas para visitantes',()=>{
 assert.equal((html.match(/data-guest-only/g)||[]).length,3);
 assert.match(html,/<a href="account\.html#criar-conta"[^>]*data-guest-only[^>]*>CRIAR CONTA/);
 assert.match(html,/app\.js\?v=20261022-garments-v11/);
 assert.match(app,/credentials:'same-origin',cache:'no-store'/);
});

test('status de sessao oculta registro, restaura no logout e ao voltar para a home',async()=>{
 const start='// Links de cadastro aparecem apenas para visitantes, nunca para uma sessão autenticada.';
 const end='// Delegate events from cards, tabs and cart controls.';
 const block=app.split(start)[1]?.split(end)[0];
 assert.ok(block?.includes('function refreshHomepageSessionLinks()'));
 const links=Array.from({length:3},()=>({hidden:false,style:{display:''}}));
 const listeners={};
 let authenticated=true;
 let networkFailure=false;
 const requests=[];
 const context={
  document:{
   hidden:false,
   querySelectorAll:(query)=>{assert.equal(query,'[data-guest-only]');return links},
   addEventListener:(name,fn)=>{listeners['doc:'+name]=fn}
  },
  window:{addEventListener:(name,fn)=>{listeners['win:'+name]=fn}},
  fetch:async(url,options)=>{
   requests.push({url,options});
   if(networkFailure)throw new Error('network');
   return {ok:true,json:async()=>({authenticated})};
  }
 };
 runInNewContext(block,context);
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 await flush();
 assert.ok(links.every(link=>link.hidden&&link.style.display==='none'));
 assert.equal(requests[0].url,'/api/account/me');
 assert.equal(requests[0].options.credentials,'same-origin');
 assert.equal(requests[0].options.cache,'no-store');

 authenticated=false;
 listeners['doc:visibilitychange']();
 await flush();
 assert.ok(links.every(link=>!link.hidden&&link.style.display===''));

 authenticated=true;
 listeners['win:pageshow']({persisted:true});
 await flush();
 assert.ok(links.every(link=>link.hidden&&link.style.display==='none'));

 networkFailure=true;
 listeners['doc:visibilitychange']();
 await flush();
 assert.ok(links.every(link=>!link.hidden&&link.style.display===''));
});
