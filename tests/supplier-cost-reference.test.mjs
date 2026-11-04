import test from 'node:test';
import assert from 'node:assert/strict';
import {localD1} from './support/local-d1.mjs';
import {SUPPLIER_COST_VERSION,sharedSupplierCostReference,recordSharedSupplierCostReference,
 configureSharedSupplierCosts,sharedSupplierCostStatus,loadSharedSupplierCosts,applySharedSupplierCosts,sharedSupplierQuotedTotal} from '../worker/supplier-cost-reference.js';
import worker from '../worker/index.js';

const id='1234abcd-1234-4234-8234-123456789012';
const item=(overrides={})=>({id:'a',qty:1,size:'P',patch:false,personalize:false,...overrides});
const product=(overrides={})=>({id:'a',kind:'fan',price:159.90,sizes:['P','M','G','GG','XXL','3XL','4XL'],...overrides});
const reference=(i=item(),p=product())=>sharedSupplierCostReference([i],[p]);

test('known USD costs follow the shared supplier table and never use retail BRL prices',()=>{
 for(const [kind,unit]of Object.entries({fan:'11.00',female:'11.00',kids:'13.00',retro:'16.00',retro_long:'19.00',long:'15.00',
  player_adidas:'16.00',player_puma:'17.00',player_nike:'18.00',shorts:'10.00',shorts_player:'12.00',jacket:'30.00'})){
  const r=reference(item(),product({kind,price:379.80}));assert.equal(r.complete,true,kind);assert.equal(r.items[0].unitUsd,unit,kind);
 }
 assert.equal(reference(item(),product({kind:'jacket',price:379.8})).totalUsd,'34.00');
});
test('sizes, patch and personalization are unit costs multiplied by quantity, while freight is per order',()=>{
 for(const [size,extra]of [['P','0.00'],['XXL','1.00'],['3XL','2.00'],['4XL','3.00']]){
  const r=reference(item({size,qty:2,patch:true,personalize:true}));
  assert.equal(r.complete,true);assert.equal(r.items[0].sizeExtraUsd,extra);
  assert.equal(r.items[0].patchUnitUsd,'1.00');assert.equal(r.items[0].personalizationUnitUsd,'3.00');
  assert.equal(r.freightUsd,'3.00');
 }
 const r=reference(item({qty:2,size:'XXL',patch:true,personalize:true}));assert.equal(r.goodsUsd,'32.00');assert.equal(r.totalUsd,'35.00');
 assert.equal(reference().freightUsd,'4.00');assert.equal(reference(item({qty:3})).freightUsd,'0.00');
});
test('single-model fan promotions retain extras and are not applied to more expensive types',()=>{
 assert.equal(reference(item({qty:5})).goodsUsd,'55.00');
 assert.equal(reference(item({qty:10})).goodsUsd,'105.00');
 assert.equal(reference(item({qty:10,patch:true,personalize:true,size:'XXL'})).goodsUsd,'155.00');
 assert.equal(reference(item({qty:10}),product({kind:'retro'})).goodsUsd,'160.00');
 const mixed=sharedSupplierCostReference([item({qty:5}),item({id:'b',qty:5})],[product(),product({id:'b'})]);
 assert.equal(mixed.complete,false);assert.match(mixed.issues.join(' '),/promoção/);
});
test('unknown exact costs and uncertain apparel classification require a cost reference rather than becoming jacket cost',()=>{
 for(const kind of ['blouse','coat','socks','set','unknown']){
  const r=reference(item(),product({kind,price:379.8}));assert.equal(r.complete,false,kind);assert.equal(r.totalUsd,null);
 }
 assert.equal(reference(item(),product({apparelPriceReviewRequired:true})).complete,false);
 assert.equal(reference(item(),product({title:'Blusa corrigida',titleLocked:true})).complete,false);
 assert.equal(reference(item(),product({apparelPriceReviewRequired:true,kindLocked:true})).complete,true);
});
test('missing catalog data, invalid sizes, quantities and options cannot produce a complete cost',()=>{
 for(const i of [item({qty:0}),item({qty:1.5}),item({qty:'1'}),item({size:'missing'}),item({patch:'yes'}),item({personalize:'false'})]){
  assert.equal(reference(i).complete,false);
 }
 assert.equal(sharedSupplierCostReference([item()],[]).complete,false);
 assert.equal(sharedSupplierCostReference([],[]).complete,false);
 const r=reference(item({qty:1000000}));assert.equal(r.complete,true);assert.equal(r.totalUsd,'11000000.00');
});

function seed(query){
 const stamp=new Date().toISOString(),items=[item()];
 query({sql:'INSERT INTO orders(id,created_at,updated_at,status,name,email,phone,cpf,zip,address,city,state,items_json,subtotal,shipping,total,payment_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  args:[id,stamp,stamp,'paid_supplier_pending','Teste','test@example.invalid','11999999999','00000000000','00000000','Rua Exemplo','São Paulo','SP',JSON.stringify(items),199.9,0,199.9,'pay_fake']});
 for(let n=1;n<=5;n++){
  query({sql:'INSERT INTO supplier_directory(id,display_name,created_at,updated_at) VALUES(?,?,?,?)',args:['supplier'+n,'Fornecedor '+n,stamp,stamp]});
  query({sql:'INSERT INTO supplier_contacts(supplier_id,phone_e164,authorized,updated_at) VALUES(?,?,1,?)',args:['supplier'+n,'861380013800'+n,stamp]});
 }
 query({sql:"INSERT INTO supplier_dispatch(order_id,supplier_id,supplier_phone,state,details_sent_at,created_at,updated_at) VALUES(?,?,?,'details_sent',?,?,?)",args:[id,'supplier1','8613800138001',stamp,stamp,stamp]});
 return {id,items_json:JSON.stringify(items)};
}
const one=(query,sql,args=[])=>query({sql,args}).results[0];

test('the owner instruction enrolls the five existing authorized contacts once, without expanding to later contacts',async t=>{
 const {db,query}=localD1(t),env={DB:db};seed(query);
 assert.equal((await sharedSupplierCostStatus(env)).configured,false);
 assert.equal(await configureSharedSupplierCosts(env,'wrong-policy'),null);
 assert.equal((await configureSharedSupplierCosts(env,SUPPLIER_COST_VERSION)).suppliers,5);
 const stamp=new Date().toISOString();
 query({sql:'INSERT INTO supplier_directory(id,display_name,created_at,updated_at) VALUES(?,?,?,?)',args:['supplier6','Novo',stamp,stamp]});
 query({sql:'INSERT INTO supplier_contacts(supplier_id,phone_e164,authorized,updated_at) VALUES(?,?,1,?)',args:['supplier6','8613900139000',stamp]});
 assert.equal((await configureSharedSupplierCosts(env,SUPPLIER_COST_VERSION)).suppliers,5);
 assert.equal(one(query,'SELECT COUNT(*) AS count FROM supplier_shared_cost_scope').count,5);
});
test('scope registration is atomic and cannot leave partially approved suppliers after a database error',async t=>{
 const {db,query}=localD1(t),env={DB:db};seed(query);
 const batch=db.batch.bind(db);db.batch=statements=>batch([...statements,db.prepare('INSERT INTO absent_table(x) VALUES(1)')]);
 await assert.rejects(configureSharedSupplierCosts(env,SUPPLIER_COST_VERSION));
 assert.equal(one(query,'SELECT COUNT(*) AS count FROM supplier_shared_cost_scope').count,0);
 assert.equal(one(query,'SELECT COUNT(*) AS count FROM supplier_cost_policy_approvals').count,0);
});
test('checkout cost snapshots are immutable and independent of later catalog/retail edits',async t=>{
 const {db,query}=localD1(t),env={DB:db},order=seed(query);await configureSharedSupplierCosts(env,SUPPLIER_COST_VERSION);
 assert.equal(await recordSharedSupplierCostReference(env,id,[item()],[product()]),true);
 assert.equal(await recordSharedSupplierCostReference(env,id,[item()],[product({kind:'jacket',price:379.8})]),false);
 const r=await loadSharedSupplierCosts(env,order);assert.equal(r.items[0].kind,'fan');assert.equal(r.items[0].unitUsd,'11.00');assert.equal(r.totalUsd,'15.00');
 query({sql:'UPDATE supplier_contacts SET phone_e164=? WHERE supplier_id=?',args:['8613900139000','supplier1']});
 assert.equal(await loadSharedSupplierCosts(env,order),null);
});
test('revocation, changed order options, stale policy and corrupted stored costs cannot pass a shared-cost audit',async t=>{
 const {db,query}=localD1(t),env={DB:db},order=seed(query);await configureSharedSupplierCosts(env,SUPPLIER_COST_VERSION);
 await recordSharedSupplierCostReference(env,id,[item()],[product()]);
 assert.equal(await loadSharedSupplierCosts(env,{...order,items_json:JSON.stringify([item({qty:2})])}),null);
 query({sql:'UPDATE supplier_contacts SET authorized=0 WHERE supplier_id=?',args:['supplier1']});assert.equal(await loadSharedSupplierCosts(env,order),null);
 query({sql:'UPDATE supplier_contacts SET authorized=1 WHERE supplier_id=?',args:['supplier1']});
 const saved=one(query,'SELECT reference_json FROM supplier_order_cost_references WHERE order_id=?',[id]);
 const tampered=JSON.parse(saved.reference_json);tampered.items[0].unitUsd='12.00';
 query({sql:'UPDATE supplier_order_cost_references SET reference_json=? WHERE order_id=?',args:[JSON.stringify(tampered),id]});assert.equal(await loadSharedSupplierCosts(env,order),null);
 query({sql:'UPDATE supplier_order_cost_references SET reference_json=?,policy_version=? WHERE order_id=?',args:[saved.reference_json,'old-policy',id]});assert.equal(await loadSharedSupplierCosts(env,order),null);
});
test('known USD costs are filled by the server, and supplied changes cannot override them or default missing FX/fees',()=>{
 const r=reference(),other={exchangeRateBrlPerUsd:'5.12',gatewayFeeBrl:'0.00',pixFeeBrl:'1.99',otherCostsBrl:'5.00'};
 const costs=applySharedSupplierCosts(other,r);assert.deepEqual(costs.items,[{productId:'a',qty:1,unitUsd:'11.00'}]);assert.equal(costs.freightUsd,'4.00');
 assert.equal(applySharedSupplierCosts({...other,freightUsd:'0.00'},r),null);
 assert.equal(applySharedSupplierCosts({...other,items:[{productId:'a',qty:1,unitUsd:'12.00'}]},r),null);
 assert.equal(applySharedSupplierCosts({},r).exchangeRateBrlPerUsd,undefined);
});
test('a missing optional snapshot table does not take checkout offline, and the protected reference endpoint does not write',async t=>{
 const {db,query}=localD1(t),env={DB:db,ADMIN_TOKEN:'fake-admin'};seed(query);
 const url='https://store.example.invalid/api/admin/supplier-cost-reference?orderId='+id;
 assert.equal((await worker.fetch(new Request(url),env)).status,401);
 await recordSharedSupplierCostReference(env,id,[item()],[product()]);
 const response=await worker.fetch(new Request(url,{headers:{authorization:'Bearer fake-admin'}}),env);
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.consultaSomenteLeitura,true);assert.equal(body.reference.totalUsd,'15.00');
 query({sql:'DROP TABLE supplier_order_cost_references'});
 assert.equal(await recordSharedSupplierCostReference(env,id,[item()],[product()]),false);
});

test('USD tolerance scales by purchased units, with exact boundaries and no allowance for invalid quantities',()=>{
 for(const quantity of [1,2,3,100]){
  const r={complete:true,totalUsd:'1000.00',quantity},delta=2*quantity;
  const upper=(1000+delta).toFixed(2),lower=(1000-delta).toFixed(2);
  assert.equal(sharedSupplierQuotedTotal(r,upper),upper);assert.equal(sharedSupplierQuotedTotal(r,lower),lower);
  for(const q of [(1000+delta+0.01).toFixed(2),(1000-delta-0.01).toFixed(2),'0.00','invalid'])assert.equal(sharedSupplierQuotedTotal(r,q),null);
  assert.equal(sharedSupplierQuotedTotal(r,null),'1000.00');
 }
 for(const quantity of [undefined,0,-1,1.5,'2',Infinity])assert.equal(sharedSupplierQuotedTotal({complete:true,totalUsd:'100.00',quantity},'101.00'),null);
 assert.equal(sharedSupplierQuotedTotal({complete:false,totalUsd:'100.00',quantity:1},'101.00'),null);
});
