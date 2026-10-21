import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';
import {classifyStockReply,previewSupplierOrder} from '../worker/fulfillment.js';

const token='token-de-teste';
function mockDb(){
 const list=new Map();
 return {list,prepare(sql){
  let args=[];
  const st={
   bind(...p){args=p;return st},
   async first(){
    if(sql.startsWith('SELECT id FROM supplier_directory'))return list.has(args[0])?{id:args[0]}:null;
    if(sql.startsWith('SELECT COUNT(*) AS total FROM supplier_directory'))return {total:list.size};
    return null;
   },
   async all(){
    if(sql.startsWith('SELECT id,display_name FROM supplier_directory'))return {results:[...list].map(([id,display_name])=>({id,display_name}))};
    return {results:[]};
   },
   async run(){
    if(sql.startsWith('INSERT INTO supplier_directory'))list.set(args[0],args[1]);
    return {meta:{changes:1}};
   }
  };return st;
 }};
}
function admin(path,body){
 return new Request('https://loja.exemplo.com/api/admin/'+path,{
  method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},
  body:body?JSON.stringify(body):undefined
 });
}
test('novo painel do catálogo compartilhado possui JavaScript válido',()=>{
 const source=readFileSync(new URL('../public/suppliers.html',import.meta.url),'utf8');
 const found=source.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(found);
 assert.doesNotThrow(()=>new Function(found[1]));
 assert.match(source,/Catálogo compartilhado/);
 assert.doesNotMatch(source,/data-supplier=/);
});
test('cadastro de até cinco fornecedores exige token e não envia WhatsApp',async()=>{
 const db=mockDb(),env={DB:db,ADMIN_TOKEN:token,ASAAS_SANDBOX:'true',WA_AUTOMATION_ENABLED:'false'};
 let res=await worker.fetch(new Request('https://loja.exemplo.com/api/admin/supplier-directory'),env);
 assert.equal(res.status,401);
 const ids=['james','fornecedor_b','fornecedor_c','fornecedor_d','fornecedor_e'];
 for(const id of ids){
  res=await worker.fetch(admin('supplier-directory',{id,displayName:'Loja '+id}),env);
  assert.equal(res.status,201);
 }
 res=await worker.fetch(admin('supplier-directory',{id:'fornecedor_f',displayName:'Loja sexta'}),env);
 assert.equal(res.status,409);
 res=await worker.fetch(admin('supplier-directory'),env);
 assert.equal(res.status,200);
 assert.equal((await res.json()).suppliers.length,5);
});
test('catálogo compartilhado não exige associar produto individualmente',async()=>{
 const db=mockDb(),env={DB:db,ADMIN_TOKEN:token};
 const res=await worker.fetch(admin('supplier-assignment',{supplierId:'james',productIds:['YUP-123456']}),env);
 assert.equal(res.status,404);
});
test('identifica respostas com código e mensagens diretas contextualizadas',()=>{
 assert.deepEqual(classifyStockReply('SEM_ESTOQUE a1b2c3d4'),{kind:'unavailable',orderShort:'a1b2c3d4',byContext:false});
 assert.deepEqual(classifyStockReply('não temos','wamid.exemplo'),{kind:'unavailable',orderShort:null,byContext:true});
 assert.deepEqual(classifyStockReply('Disponível a1b2c3d4'),{kind:'available',orderShort:'a1b2c3d4',byContext:false});
 assert.equal(classifyStockReply('não temos'),null);
 assert.equal(classifyStockReply('talvez, amanhã chegue', 'wamid.exemplo'),null);
 assert.equal(classifyStockReply('temos dois tamanhos, mas talvez falte um','wamid.exemplo'),null);
});
test('catálogo compartilhado apresenta fornecedor prioritário mesmo com produtos de fontes distintas',()=>{
 const env={ASAAS_SANDBOX:'true',WA_AUTOMATION_ENABLED:'false',SUPPLIERS_JSON:JSON.stringify([
  {id:'james',phone:'8613800138000',template:'consulta_estoque'},
  {id:'outro',phone:'8613800138001',template:'consulta_estoque'}
 ])};
 const order={id:'a1b2c3d4-1234-4234-8234-123456789012',status:'paid_supplier_pending',
  items_json:JSON.stringify([{id:'YUP-1',supplierId:'outro',title:'Barcelona',size:'M',qty:1},{id:'YUP-2',supplierId:'',title:'Braga',size:'G',qty:1}])};
 const preview=previewSupplierOrder(env,order);
 assert.equal(preview.supplier.id,'james');
 assert.equal(preview.supplierCandidates.length,2);
 assert.equal(preview.sharedCatalog,true);
 assert.equal(preview.readyForAutomaticSending,false);
});
