import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {readFileSync} from 'node:fs';

const base='https://streetball-store.kpgmer.workers.dev';
function envWithAssets(mode='ok',dbReady=true){
 const assets={fetch:async req=>{
  const name=new URL(req.url).pathname;
  if(mode==='missing')return new Response('Not found',{status:404});
  if(name==='/account.html')return new Response('<html><title>Minha conta</title></html>',{headers:{'content-type':'text/html; charset=utf-8'}});
  if(name==='/account.js')return new Response('console.log("conta")',{headers:{'content-type':'application/javascript'}});
  return new Response('Not found',{status:404});
 }};
 const DB={prepare:()=>({first:async()=>dbReady?{name:'customer_accounts'}:null})};
 return {ASSETS:assets,DB};
}
test('criar conta, meus pedidos e minha conta abrem pagina canônica via Worker',async()=>{
 const env=envWithAssets();
 for(const [route,fragment] of [['/criar-conta','#criar-conta'],['/pedidos','#pedidos'],['/conta','']]){
  const response=await worker.fetch(new Request(base+route),env);
  assert.equal(response.status,302);
  assert.equal(response.headers.get('location'),base+'/account.html'+fragment);
 }
});
test('rota HTML de cadastro é servida diretamente mesmo quando Worker responde primeiro',async()=>{
 const response=await worker.fetch(new Request(base+'/account.html#criar-conta'),envWithAssets());
 assert.equal(response.status,200);
 assert.match(await response.text(),/Minha conta/);
});
test('ausência do arquivo publicado mostra 503 explicativo em vez de 404 vazio',async()=>{
 const response=await worker.fetch(new Request(base+'/account.html'),envWithAssets('missing'));
 assert.equal(response.status,503);
 assert.match(await response.text(),/não incluída/);
});
test('diagnóstico detecta versão incompleta, JavaScript ausente e banco pendente',async()=>{
 const good=await worker.fetch(new Request(base+'/api/health/account'),envWithAssets());
 assert.equal(good.status,200);
 const ok=await good.json();
 assert.equal(ok.ok,true);
 assert.equal(ok.accountPageReady,true);
 assert.equal(ok.accountScriptReady,true);
 assert.equal(ok.accountsDatabaseReady,true);
 const empty=await worker.fetch(new Request(base+'/api/health/account'),envWithAssets('missing',false));
 const bad=await empty.json();
 assert.equal(bad.ok,false);
 assert.equal(bad.accountPageReady,false);
 assert.equal(bad.accountScriptReady,false);
 assert.equal(bad.accountsDatabaseReady,false);
});
test('menu de criar conta no celular leva à rota correta e configuração Worker inclui página',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const toml=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
 const account=readFileSync(new URL('../public/account.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../public/account.js',import.meta.url),'utf8');
 assert.ok(html.includes('href="/account.html#criar-conta"'));
 assert.ok(toml.includes('"/account.html"'));
 assert.ok(account.includes('id="registerForm"'));
 assert.ok(js.includes("switchTab('register')"));
 assert.doesNotThrow(()=>new Function(js));
});
