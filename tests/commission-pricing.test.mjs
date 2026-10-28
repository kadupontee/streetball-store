import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {RETAIL_PRICES_BRL,RETAIL_ADDONS_BRL,RETAIL_PRICE_POLICY_VERSION,applyProductOverride,emptySettings} from '../public/store-settings.js';
import worker from '../worker/index.js';

const catalog=JSON.parse(readFileSync(new URL('../public/catalog.json',import.meta.url),'utf8'));
const costs=JSON.parse(readFileSync(new URL('../scripts/costs.json',import.meta.url),'utf8'));
const cents=x=>Math.round((x+Number.EPSILON)*100);

test('every priced catalog variant with a recorded cost retains at least R$10 after coupon, seller and sales reserves',()=>{
 let checked=0;
 for(const product of catalog){
  let supplier=costs.supplier_usd[product.kind];
  if(supplier===undefined)continue; // Missing coat/blouse costs remain unverified.
  if(typeof supplier==='object')supplier=supplier.max;
  assert.ok(product.price>=RETAIL_PRICES_BRL[product.kind],product.id);
  for(const size of product.sizes)for(const patch of [false,true])for(const personalize of [false,true]){
   const extra=(costs.size_extra_usd[size]||0)+(patch?costs.additions_usd.patch:0)+(personalize?costs.additions_usd.personalization:0);
   const acquisition=cents((supplier+costs.shipping_usd.one_piece)*5.30*1.25)+cents(extra*5.30*1.25);
   const retail=cents(product.price+(RETAIL_ADDONS_BRL.size[size]||0)+(patch?RETAIL_ADDONS_BRL.patch:0)+(personalize?RETAIL_ADDONS_BRL.personalization:0));
   const paid=Math.round(retail*95/100),seller=Math.round(paid*25/100),deductions=Math.round(paid*135/1000);
   assert.ok(paid-seller-deductions-acquisition>=1000,`${product.id} ${size} patch=${patch} personalize=${personalize}: ${paid-seller-deductions-acquisition} cents`);
   checked++;
  }
 }
 assert.ok(checked>100000);
});

test('old published editor prices cannot undercut the new category floor; higher prices survive',()=>{
 assert.equal(applyProductOverride({kind:'fan',price:159.9},{price:0.01}).price,189.9);
 assert.equal(applyProductOverride({kind:'retro',price:199.9},{price:159.9}).price,249.9);
 assert.equal(applyProductOverride({kind:'set',price:299.9},{price:379.8}).price,579.9);
 assert.equal(applyProductOverride({kind:'fan',price:159.9},{price:250}).price,250);
 assert.equal(applyProductOverride({kind:'fan',price:159.9},{kind:'player_nike',price:159.9}).price,269.9);
});

function environment(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../worker/schema.sql',import.meta.url),'utf8'));
 const settings=emptySettings();settings.products.example={price:159.9};
 sqlite.prepare('INSERT INTO store_editor_versions(revision,state_json,published_at) VALUES(1,?,?)').run(JSON.stringify(settings),'2026-10-28T00:00:00Z');
 const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}}}}};
 return {sqlite,env:{DB,ASAAS_SANDBOX:'true',SALES_ENABLED:'true',ASAAS_SANDBOX_API_KEY:'fake-key',SHIPPING_FLAT_BRL:'0',
  ASSETS:{fetch:async()=>Response.json([{id:'example',title:'Camisa atual',kind:'fan',price:159.9,sizes:['P','4XL']}])}}};
}
function request(version=RETAIL_PRICE_POLICY_VERSION){
 return new Request('https://store.example.invalid/api/orders',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({
  storeRevision:1,pricingPolicyVersion:version,paymentMethod:'PIX',items:[{id:'example',size:'4XL',qty:2,patch:true,personalize:true,customName:'TESTE',customNumber:'10',price:0.01}],
  customer:{name:'Cliente Teste',email:'test@example.invalid',phone:'11999999999',cpf:'12345678909',zip:'00000000',address:'Rua Exemplo 1',city:'São Paulo',state:'SP'}
 })});
}
test('checkout charges the same new floor and option prices, ignoring stale overrides and client-supplied prices',async t=>{
 const {env,sqlite}=environment();t.after(()=>sqlite.close());
 const charges=[];t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url).endsWith('/customers'))return Response.json({id:'customer'});
  const charge=JSON.parse(options.body);charges.push(charge);return Response.json({id:'payment',invoiceUrl:'https://sandbox.asaas.com/i/example'});
 });
 const response=await worker.fetch(request(),env);
 assert.equal(response.status,200);assert.equal((await response.json()).total,543.8);
 assert.equal(charges[0].value,543.8);
 const order=sqlite.prepare('SELECT total,items_json FROM orders').get();
 assert.equal(order.total,543.8);assert.equal(JSON.parse(order.items_json)[0].unitPrice,271.9);
});
test('a stale pricing policy stops an ordinary shirt checkout before any provider call or order insert',async t=>{
 const {env,sqlite}=environment();t.after(()=>sqlite.close());
 t.mock.method(globalThis,'fetch',()=>assert.fail('Stale prices must not reach payment provider'));
 const response=await worker.fetch(request('apparel-37980-20261027'),env);
 assert.equal(response.status,409);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n,0);
});
