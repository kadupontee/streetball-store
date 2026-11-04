import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {productOfferPrice,applyProductOverride,emptySettings,RETAIL_PRICE_POLICY_VERSION} from '../public/store-settings.js';
import worker from '../worker/index.js';

test('camisas atuais mostram 20%; retrô, agasalhos e demais produtos mostram 17%',()=>{
 for(const kind of ['fan','female','kids','long','player_adidas','player_nike','player_puma']){
  assert.equal(productOfferPrice({kind,price:159.9}).percent,20);
  assert.equal(productOfferPrice({kind,category:'retro',price:199.9}).percent,17);
 }
 for(const kind of ['retro','retro_long','shorts','shorts_player','socks','set','jacket','coat','blouse','unknown'])assert.equal(productOfferPrice({kind,price:199.9}).percent,17);
 const corrected=applyProductOverride({kind:'fan',title:'Corinthian Home',price:159.9},{title:'Corinthians — Blusa',price:379.8});
 assert.equal(productOfferPrice(corrected).percent,17);
});

test('a referência corresponde ao desconto anunciado, sem alterar o preço efetivo',()=>{
 const shirt=Object.freeze({kind:'fan',price:160});
 assert.deepEqual(productOfferPrice(shirt),{percent:20,currentUnit:160,referenceUnit:200,quantity:1,currentTotal:160,referenceTotal:200});
 assert.equal(shirt.price,160);
 const cases=[[{kind:'fan',price:159.9},199.88],[{kind:'retro',price:199.9},240.85],[{kind:'coat',price:379.8},457.6]];
 for(const [p,reference]of cases){const offer=productOfferPrice(p);assert.equal(offer.referenceUnit,reference);assert.equal(offer.currentUnit,p.price);assert.ok((offer.referenceUnit-offer.currentUnit)/offer.referenceUnit*100>=offer.percent-1e-9);}
});

test('a vitrine usa o preço e a classificação efetivamente publicados no editor',()=>{
 const product={kind:'fan',category:'europa',price:159.9};
 const edited=applyProductOverride(product,{price:149.9});
 assert.equal(productOfferPrice(edited).currentTotal,149.9);assert.equal(productOfferPrice(edited).referenceTotal,187.38);
 const retro=applyProductOverride(product,{kind:'retro',price:199.9});assert.equal(productOfferPrice(retro).percent,17);
});

test('quantidades preservam a referência unitária e entradas inválidas não inventam uma oferta',()=>{
 const offer=productOfferPrice({kind:'fan',price:159.9},{unitPrice:192.9,quantity:2});
 assert.equal(offer.currentTotal,385.8);assert.equal(offer.referenceTotal,482.26);
 for(const price of [0,-1,NaN,Infinity,'159.9',0.0001])assert.equal(productOfferPrice({kind:'fan',price}),null);
 for(const quantity of [0,-1,1.5,Infinity])assert.equal(productOfferPrice({kind:'fan',price:159.9},{quantity}),null);
});

function environment(product,settings=emptySettings()){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../worker/schema.sql',import.meta.url),'utf8'));
 sqlite.prepare('INSERT INTO store_editor_versions(revision,state_json,published_at) VALUES(1,?,?)').run(JSON.stringify(settings),'2026-10-28T12:00:00Z');
 const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}};}};
 return {sqlite,env:{DB,ASAAS_SANDBOX:'true',SALES_ENABLED:'true',ASAAS_SANDBOX_API_KEY:'fake-key',SHIPPING_FLAT_BRL:'0',ASSETS:{fetch:async()=>Response.json([product])}}};
}
test('checkout e cobrança mantêm o valor atual, inclusive adicionais e quantidades, sem cobrar a referência',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json(String(url).endsWith('/customers')?{id:'fake-customer'}:{id:'fake-payment',invoiceUrl:'https://sandbox.asaas.com/i/fake'});});
 for(const [kind,price,extras,quantity]of [['fan',159.9,0,1],['retro',199.9,0,1],['coat',379.8,0,1],['fan',159.9,33,2]]){
  const product={id:'fake-'+kind,title:kind==='retro'?'Camisa retrô de exemplo':'Produto de exemplo',kind,price,sizes:['P','XXL']};
  const {env,sqlite}=environment(product);t.after(()=>sqlite.close());
  const offer=productOfferPrice(product,{unitPrice:price+extras,quantity});
  const body={pricingPolicyVersion:RETAIL_PRICE_POLICY_VERSION,storeRevision:1,paymentMethod:'PIX',items:[{id:product.id,size:extras?'XXL':'P',qty:quantity,patch:!!extras,personalize:!!extras,customName:extras?'TESTE':'',customNumber:extras?'10':'',referencePrice:offer.referenceUnit,price:offer.referenceUnit}],customer:{name:'Cliente fictício',email:'fake@example.invalid',phone:'11999999999',cpf:'12345678909',zip:'00000000',address:'Rua Exemplo 1',city:'São Paulo',state:'SP'}};
  const response=await worker.fetch(new Request('https://lojastreetball.com.br/api/orders',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)}),env);
  assert.equal(response.status,200);assert.equal((await response.json()).total,offer.currentTotal);assert.equal(calls.at(-1).body.value,offer.currentTotal);
  const saved=sqlite.prepare('SELECT total,items_json FROM orders').get();assert.equal(saved.total,offer.currentTotal);assert.equal(JSON.parse(saved.items_json)[0].unitPrice,price+extras);assert.notEqual(saved.total,offer.referenceTotal);
 }
});
