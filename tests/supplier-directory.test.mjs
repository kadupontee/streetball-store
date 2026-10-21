import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';
import {resolveMappedItems} from '../worker/supplier-mapping.js';
import {previewSupplierOrder} from '../worker/fulfillment.js';

function fakeDb(){
 const suppliers=new Map(),mapping=new Map();
 const db={
  prepare(sql){
   let args=[];
   const statement={
    bind(...values){args=values;return statement},
    async first(){
     if(sql.startsWith('SELECT id FROM supplier_directory'))return suppliers.has(args[0])?{id:args[0]}:null;
     if(sql.startsWith('SELECT COUNT(*) AS total FROM supplier_directory'))return {total:suppliers.size};
     return null;
    },
    async all(){
     if(sql.startsWith('SELECT id,display_name FROM supplier_directory'))return {results:[...suppliers].map(([id,display_name])=>({id,display_name}))};
     if(sql.startsWith('SELECT product_id, supplier_id FROM supplier_product_map'))return {results:args.filter(id=>mapping.has(id)).map(id=>({product_id:id,supplier_id:mapping.get(id)}))};
     return {results:[]};
    },
    async run(){
     if(sql.startsWith('INSERT INTO supplier_directory'))suppliers.set(args[0],args[1]);
     if(sql.startsWith('INSERT INTO supplier_product_map'))mapping.set(args[0],args[1]);
     if(sql.startsWith('DELETE FROM supplier_product_map'))mapping.delete(args[0]);
     return {meta:{changes:1}};
    }
   };return statement;
  },
  async batch(statements){for(const st of statements)await st.run();return []}
 };
 return {db,suppliers,mapping};
}
const catalog=[
 {id:'YUP-123456',title:'Barcelona',sourceUrl:'https://example.org/albums/1',sizes:['P'],price:100,image:'/images/foo.jpg'},
 {id:'YUP-987654',title:'São Paulo',sourceUrl:'https://example.org/albums/2',sizes:['M'],price:100,image:'/images/bar.jpg'}
];
const asset={fetch:async()=>new Response(JSON.stringify(catalog),{status:200})};
const token='segredo-teste';
function req(path,body){
 return new Request('https://loja.exemplo.com/api/admin/'+path,{
   method:body?'POST':'GET',
   headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined
 });
}

test('página de fornecedores carrega e código JavaScript é válido',()=>{
 const html=readFileSync(new URL('../public/suppliers.html',import.meta.url),'utf8');
 const match=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(match,'script da página precisa existir');
 assert.doesNotThrow(()=>new Function(match[1]));
 assert.match(html,/N[eE]nhuma mensagem|Nenhum WhatsApp/);
});

test('catálogo por fornecedor exige chave administrativa',async()=>{
 const res=await worker.fetch(new Request('https://loja.exemplo.com/api/admin/supplier-catalog'),{DB:fakeDb().db,ASSETS:asset,ADMIN_TOKEN:token});
 assert.equal(res.status,401);
});

test('cadastro e atribuição são persistentes em D1 sem envio',async()=>{
 const ctx=fakeDb();
 const env={DB:ctx.db,ASSETS:asset,ADMIN_TOKEN:token,WA_AUTOMATION_ENABLED:'false'};
 let result=await worker.fetch(req('supplier-directory',{id:'james_jersey',displayName:'James Jersey'}),env);
 assert.equal(result.status,201);
 result=await worker.fetch(req('supplier-assignment',{supplierId:'james_jersey',productIds:['YUP-123456']}),env);
 assert.equal(result.status,200);
 assert.equal(ctx.mapping.get('YUP-123456'),'james_jersey');
 result=await worker.fetch(req('supplier-catalog?q=Barcelona&page=1'),env);
 assert.equal(result.status,200);
 const json=await result.json();
 assert.equal(json.total,1);
 assert.equal(json.items[0].supplierId,'james_jersey');
 const items=await resolveMappedItems(env,[{id:'YUP-123456'},{id:'YUP-987654'}]);
 assert.deepEqual(items.map(i=>i.supplierId),['james_jersey','']);
 result=await worker.fetch(req('supplier-assignment',{supplierId:'',productIds:['YUP-123456']}),env);
 assert.equal(result.status,200);
 assert.equal(ctx.mapping.size,0);
});

test('fornecedor não cadastrado e produto inexistente não podem ser atribuídos',async()=>{
 const ctx=fakeDb(),env={DB:ctx.db,ASSETS:asset,ADMIN_TOKEN:token};
 let result=await worker.fetch(req('supplier-assignment',{supplierId:'fantasma',productIds:['YUP-123456']}),env);
 assert.equal(result.status,404);
 await worker.fetch(req('supplier-directory',{id:'james_jersey',displayName:'James Jersey'}),env);
 result=await worker.fetch(req('supplier-assignment',{supplierId:'james_jersey',productIds:['YUP-000000']}),env);
 assert.equal(result.status,404);
 assert.equal(ctx.mapping.size,0);
});

test('pedido misto ou sem identificação não elege fornecedor automaticamente',()=>{
 const env={WA_AUTOMATION_ENABLED:'false',SUPPLIERS_JSON:JSON.stringify([{id:'james_jersey',phone:'8613800138000',template:'teste'}]),DEFAULT_SUPPLIER_ID:'james_jersey'};
 const preview=previewSupplierOrder(env,{id:'pedido',status:'paid_supplier_pending',items_json:JSON.stringify([{id:'YUP-123456',title:'Barcelona',size:'P',qty:1,supplierId:'james_jersey'},{id:'YUP-987654',title:'São Paulo',size:'M',qty:1,supplierId:''}])});
 assert.equal(preview.supplier,null);
 assert.equal(preview.readyForAutomaticSending,false);
});
