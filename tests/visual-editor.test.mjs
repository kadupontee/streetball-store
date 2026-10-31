import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';
import {emptySettings,normalizeSettings,RETAIL_PRICE_POLICY_VERSION} from '../public/store-settings.js';
import {handleStoreEditor,loadStoreSettings,editedCatalog} from '../worker/store-editor.js';

const origin='https://lojastreetball.com.br';
const adminKey='chave-ficticia-somente-deste-teste';
function database(){
 const sqlite=new DatabaseSync(':memory:');
 const DB={sqlite,prepare(sql){let values=[];return {
  bind(...args){values=args;return this;},
  async first(){return sqlite.prepare(sql).get(...values)||null;},
  async all(){return {results:sqlite.prepare(sql).all(...values)};},
  async run(){const result=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(result.changes)}};}
 };},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 return DB;
}
function request(method='GET',body,options={}){
 const {token=adminKey,requestOrigin=origin,query=''}=options;
 return new Request(origin+'/api/admin/store-editor'+query,{method,headers:{authorization:'Bearer '+token,...(method==='POST'?{origin:requestOrigin,'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
const sample={id:'YUP-12345',title:'Camisa antiga 1998',supplierTitle:'Brazil Home 1998',price:249.9,category:'retro',kind:'retro',sizes:['P','M'],image:'/images/camisa.jpg'};
function changes(price=249.9){const state=emptySettings();state.design.accent='#123456';state.products[sample.id]={title:'Brasil 1998 — meu nome revisado',price,kind:'long',category:'treino'};return state;}

test('a vitrine sem edições mantém o catálogo existente e não cria tabelas em acesso público',async()=>{
 const DB=database(),env={DB};
 const response=await worker.fetch(new Request(origin+'/api/storefront/config'),env);
 assert.equal(response.status,200);assert.deepEqual((await response.json()).settings,emptySettings());
 assert.equal(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='store_editor_versions'").get(),undefined);
 assert.deepEqual(await editedCatalog([sample],env),[sample]);
});
test('token inválido e POST de outro site não podem alterar nem inicializar o editor',async()=>{
 const DB=database(),env={DB,ADMIN_TOKEN:adminKey};
 assert.equal((await handleStoreEditor(request('POST',{settings:changes(),expectedRevision:0},{token:'incorreta'}),env)).status,401);
 assert.equal((await handleStoreEditor(request('POST',{settings:changes(),expectedRevision:0},{requestOrigin:'https://terceiro.example'}),env)).status,403);
 assert.equal(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='store_editor_versions'").get(),undefined);
});
test('publicação persiste de verdade em SQLite e não revela a chave administrativa',async()=>{
 const DB=database(),env={DB,ADMIN_TOKEN:adminKey};
 const publish=await handleStoreEditor(request('POST',{expectedRevision:0,settings:changes()}),env);
 assert.equal(publish.status,200);assert.equal((await publish.json()).revision,1);
 const next=await loadStoreSettings({DB});assert.equal(next.revision,1);assert.equal(next.settings.products[sample.id].price,249.9);
 const publicResponse=await worker.fetch(new Request(origin+'/api/storefront/config'),env),text=await publicResponse.text();
 assert.ok(text.includes('249.9'));assert.ok(!text.includes(adminKey));
 const imported={...sample,price:999,title:'Título substituído pelo fornecedor',kind:'fan'};
 const effective=await editedCatalog([imported],{DB});assert.equal(effective[0].price,249.9);assert.equal(effective[0].title,'Brasil 1998 — meu nome revisado');assert.equal(effective[0].kind,'long');assert.equal(effective[0].priceLocked,true);
});
test('duas abas concorrentes não sobrescrevem a publicação uma da outra',async()=>{
 const env={DB:database(),ADMIN_TOKEN:adminKey};
 await handleStoreEditor(request(),env);
 const results=await Promise.all([249.9,289.9].map(price=>handleStoreEditor(request('POST',{expectedRevision:0,settings:changes(price)}),env)));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const current=await loadStoreSettings(env);assert.equal(current.revision,1);assert.ok([249.9,289.9].includes(current.settings.products[sample.id].price));
 assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM store_editor_versions').get().n,1);
});
test('histórico é lido sem publicar; restauração cria outra versão e preserva anteriores',async()=>{
 const env={DB:database(),ADMIN_TOKEN:adminKey};
 await handleStoreEditor(request('POST',{expectedRevision:0,settings:changes(249.9)}),env);
 await handleStoreEditor(request('POST',{expectedRevision:1,settings:changes(279.9)}),env);
 const previous=await handleStoreEditor(request('GET',undefined,{query:'?revision=1'}),env),data=await previous.json();
 assert.equal(data.settings.products[sample.id].price,249.9);assert.equal((await loadStoreSettings(env)).revision,2);
 const restored=await handleStoreEditor(request('POST',{expectedRevision:2,settings:data.settings}),env);assert.equal(restored.status,200);
 assert.equal((await loadStoreSettings(env)).revision,3);assert.equal((await loadStoreSettings(env)).settings.products[sample.id].price,249.9);
 assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM store_editor_versions').get().n,3);
});
test('validação rejeita preço negativo, HTML/CSS injetado em cores, protótipos e campos de custo',async()=>{
 for(const invalid of [-1,0,NaN,Infinity,12.345,'10,00']){const state=emptySettings();state.products[sample.id]={price:invalid};assert.throws(()=>normalizeSettings(state));}
 const css=emptySettings();css.design.accent='#fff;body{display:none}';assert.throws(()=>normalizeSettings(css));
 const cost=emptySettings();cost.products[sample.id]={supplierCost:1};assert.throws(()=>normalizeSettings(cost));
 assert.throws(()=>normalizeSettings(JSON.parse('{"design":{},"products":{"__proto__":{"price":1}}}')));
 const env={DB:database(),ADMIN_TOKEN:adminKey},state=emptySettings();state.products[sample.id]={price:-10};
 const response=await handleStoreEditor(request('POST',{expectedRevision:0,settings:state}),env);assert.equal(response.status,400);assert.equal((await loadStoreSettings(env)).revision,0);
});

function checkoutEnv(){
 const DB=database();DB.sqlite.exec(readFileSync(new URL('../worker/schema.sql',import.meta.url),'utf8'));
 return {DB,ADMIN_TOKEN:adminKey,ASAAS_SANDBOX:'true',SALES_ENABLED:'true',PAYMENTS_PRODUCTION_ENABLED:'false',ASAAS_API_KEY:'apenas-uma-fixture',SHIPPING_FLAT_BRL:'0.00',ASSETS:{fetch:async()=>new Response(JSON.stringify([sample]),{headers:{'content-type':'application/json'}})}};
}
function orderBody(storeRevision=1){return {storeRevision,pricingPolicyVersion:RETAIL_PRICE_POLICY_VERSION,customer:{name:'Cliente de teste',email:'cliente@example.com',phone:'11999999999',cpf:'52998224725',zip:'01001000',address:'Rua de Teste 123',city:'São Paulo',state:'SP'},paymentMethod:'PIX',items:[{id:sample.id,size:'P',qty:1,price:0.01}]};}
function orderRequest(body){return new Request(origin+'/api/orders',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)});}
test('checkout cobra o preço publicado e impede cobrança com uma versão antiga da sacola',async()=>{
 const env=checkoutEnv();await handleStoreEditor(request('POST',{expectedRevision:0,settings:changes(249.9)}),env);
 const originalFetch=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify(String(url).endsWith('/customers')?{id:'cus_fixture'}:{id:'pay_fixture',invoiceUrl:'https://sandbox.asaas.com/i/fixture'}),{headers:{'content-type':'application/json'}});};
 try{
  const stale=await worker.fetch(orderRequest(orderBody(0)),env);assert.equal(stale.status,409);assert.equal(calls.length,0);
  const response=await worker.fetch(orderRequest(orderBody()),env);assert.equal(response.status,200);const result=await response.json();assert.equal(result.total,249.9);assert.equal(calls[1].body.value,249.9);
  const saved=env.DB.sqlite.prepare('SELECT total,items_json FROM orders').get();assert.equal(saved.total,249.9);assert.equal(JSON.parse(saved.items_json)[0].unitPrice,249.9);
 }finally{globalThis.fetch=originalFetch;}
});
test('produto oculto não é vendido e nenhuma chamada de pagamento é feita',async()=>{
 const env=checkoutEnv(),state=changes();state.products[sample.id].hidden=true;
 await handleStoreEditor(request('POST',{expectedRevision:0,settings:state}),env);
 const originalFetch=globalThis.fetch;let count=0;globalThis.fetch=async()=>{count++;throw Error('Não deveria chamar o Asaas');};
 try{const response=await worker.fetch(orderRequest(orderBody()),env);assert.equal(response.status,400);assert.equal(count,0);assert.deepEqual(await editedCatalog([sample],env),[]);}finally{globalThis.fetch=originalFetch;}
});
