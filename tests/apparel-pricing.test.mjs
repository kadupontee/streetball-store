import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {APPAREL_PRICE_BRL,RETAIL_PRICE_POLICY_VERSION,RETAIL_PRICES_BRL,applyProductOverride,emptySettings,normalizeSettings} from '../public/store-settings.js';
import worker from '../worker/index.js';

function environment(product,settings=emptySettings()){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../worker/schema.sql',import.meta.url),'utf8'));
 sqlite.prepare('INSERT INTO store_editor_versions(revision,state_json,published_at) VALUES(1,?,?)').run(JSON.stringify(settings),'2026-10-27T00:00:00Z');
 const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this;},
  async first(){return sqlite.prepare(sql).get(...args)||null;},
  async all(){return {results:sqlite.prepare(sql).all(...args)};},
  async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}};}};
 return {sqlite,env:{DB,ASAAS_SANDBOX:'true',SALES_ENABLED:'true',ASAAS_SANDBOX_API_KEY:'fake-key',SHIPPING_FLAT_BRL:'0.00',
  ASSETS:{fetch:async()=>Response.json([product])}}};
}
function order(id,extra={}){
 const body={pricingPolicyVersion:RETAIL_PRICE_POLICY_VERSION,storeRevision:1,paymentMethod:'PIX',
  items:[{id,size:'P',qty:1,price:0.01}],customer:{name:'Cliente Exemplo',email:'cliente@example.invalid',phone:'11999999999',
   cpf:'12345678909',zip:'00000000',address:'Rua Exemplo 123',city:'São Paulo',state:'SP'},...extra};
 return new Request('https://lojastreetball.com.br/api/orders',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)});
}
function provider(t){
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url,body:JSON.parse(options.body)});
  return Response.json(String(url).endsWith('/customers')?{id:'cus_example'}:{id:'pay_example',invoiceUrl:'https://sandbox.asaas.com/i/example'});
 };
 t.after(()=>globalThis.fetch=previous);return calls;
}

test('jaquetas, blusas e casacos usam exatamente o novo preço comum no catálogo, no modelo do editor e na cobrança',async t=>{
 const calls=provider(t);
 for(const kind of ['jacket','blouse','coat']){
  assert.equal(RETAIL_PRICES_BRL[kind],APPAREL_PRICE_BRL);
  const product={id:'EX-'+kind,title:'Modelo de inverno',kind,price:kind==='jacket'?379.90:189.90,priceLocked:true,kindLocked:true,sizes:['P'],image:'/images/example.webp'};
  assert.equal(applyProductOverride(product).price,APPAREL_PRICE_BRL);
  const {env,sqlite}=environment(product);t.after(()=>sqlite.close());
  const response=await worker.fetch(order(product.id),env);
  assert.equal(response.status,200);assert.equal((await response.json()).total,APPAREL_PRICE_BRL);
  assert.equal(calls.at(-1).body.value,APPAREL_PRICE_BRL);
  const saved=sqlite.prepare('SELECT total,items_json FROM orders').get();
  assert.equal(saved.total,APPAREL_PRICE_BRL);assert.equal(JSON.parse(saved.items_json)[0].unitPrice,APPAREL_PRICE_BRL);
 }
});

test('a correção publicada de Corinthians — Blusa acompanha a política mesmo com o tipo antigo de camisa',async t=>{
 const calls=provider(t),p={id:'EX-blusa-editada',title:'Corinthian Home',supplierTitle:'Corinthian Home',kind:'fan',price:159.90,sizes:['P']};
 const settings=emptySettings();settings.products[p.id]={title:'Corinthians — Blusa',price:379.90};
 assert.equal(normalizeSettings(settings).products[p.id].price,APPAREL_PRICE_BRL);
 assert.equal(applyProductOverride(p,settings.products[p.id]).price,APPAREL_PRICE_BRL);
 const {env,sqlite}=environment(p,settings);t.after(()=>sqlite.close());
 const response=await worker.fetch(order(p.id),env);
 assert.equal(response.status,200);assert.equal((await response.json()).total,APPAREL_PRICE_BRL);assert.equal(calls.at(-1).body.value,APPAREL_PRICE_BRL);
});

test('casos marcados como duvidosos usam o maior preço e uma classificação explícita resolve a dúvida',()=>{
 const p={id:'EX',kind:'set',price:299.90,apparelPriceReviewRequired:true};
 assert.equal(applyProductOverride(p).price,RETAIL_PRICES_BRL.set);
 assert.equal(applyProductOverride({...p,price:650}).price,650);
 assert.equal(applyProductOverride(p,{kind:'fan',price:159.90}).price,RETAIL_PRICES_BRL.fan);
 const confirmed={kind:'fan',price:159.90,title:'Argentina Hoodie',kindLocked:true};
 assert.equal(applyProductOverride(confirmed).price,RETAIL_PRICES_BRL.fan);
});

test('página com política antiga precisa atualizar antes de criar qualquer cobrança',async t=>{
 const calls=provider(t),p={id:'EX-blouse',title:'Blusa',kind:'blouse',price:189.90,sizes:['P']};
 const {env,sqlite}=environment(p);t.after(()=>sqlite.close());
 for(const pricingPolicyVersion of [undefined,'old-policy']){
  const response=await worker.fetch(order(p.id,{pricingPolicyVersion}),env);
  assert.equal(response.status,409);assert.match((await response.json()).error,/preços.*atualizados/);
 }
 assert.equal(calls.length,0);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n,0);
});

test('pedidos de camisas comuns usam o novo piso e a versão atual da política',async t=>{
 const calls=provider(t),p={id:'EX-fan',title:'Brasil Home Jersey',kind:'fan',price:159.90,sizes:['P']};
 const {env,sqlite}=environment(p);t.after(()=>sqlite.close());
 const response=await worker.fetch(order(p.id),env);
 assert.equal(response.status,200);assert.equal((await response.json()).total,RETAIL_PRICES_BRL.fan);assert.equal(calls.at(-1).body.value,RETAIL_PRICES_BRL.fan);
});

test('o catálogo integral e seu arquivo JavaScript ficam sincronizados, incluindo todos os produtos dos três tipos',()=>{
 const products=JSON.parse(readFileSync(new URL('../public/catalog.json',import.meta.url),'utf8'));
 const js=readFileSync(new URL('../public/catalog.js',import.meta.url),'utf8');
 assert.deepEqual(JSON.parse(js.slice('window.STREETBALL_CATALOG = '.length).trim().slice(0,-1)),products);
 assert.ok(products.length>=10000);
 const apparel=products.filter(p=>['jacket','blouse','coat'].includes(p.kind));
 assert.ok(['jacket','blouse','coat'].every(kind=>apparel.some(p=>p.kind===kind)));
 assert.ok(apparel.every(p=>p.price===APPAREL_PRICE_BRL));
 assert.ok(products.filter(p=>p.apparelPriceReviewRequired).every(p=>p.price>=APPAREL_PRICE_BRL));
});
