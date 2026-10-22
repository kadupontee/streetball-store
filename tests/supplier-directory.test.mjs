import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';
import {classifyStockReply,previewSupplierOrder,routePaidOrder} from '../worker/fulfillment.js';

const token='token-de-teste';
function mockDb(){
 const list=new Map(),contacts=new Map();
 return {list,contacts,prepare(sql){
  let args=[];
  const st={
   bind(...p){args=p;return st},
   async first(){
    if(sql.startsWith('SELECT id FROM supplier_directory'))return list.has(args[0])?{id:args[0]}:null;
    if(sql.startsWith('SELECT COUNT(*) AS total FROM supplier_directory'))return {total:list.size};
    return null;
   },
   async all(){
    if(sql.includes('FROM supplier_directory d LEFT JOIN supplier_contacts'))return {results:[...list].map(([id,display_name])=>({id,display_name,phone_e164:contacts.get(id)?.phone||null,authorized:contacts.get(id)?.authorized||0}))};
    if(sql.startsWith('SELECT id,display_name FROM supplier_directory'))return {results:[...list].map(([id,display_name])=>({id,display_name}))};
    return {results:[]};
   },
   async run(){
    if(sql.startsWith('INSERT INTO supplier_directory'))list.set(args[0],args[1]);
    if(sql.startsWith('INSERT INTO supplier_contacts'))contacts.set(args[0],{phone:args[1],authorized:args[2]});
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
 assert.deepEqual(classifyStockReply('talvez, amanhã chegue', 'wamid.exemplo'),{kind:'ambiguous',orderShort:null,byContext:true});
 assert.deepEqual(classifyStockReply('temos dois tamanhos, mas talvez falte um','wamid.exemplo'),{kind:'ambiguous',orderShort:null,byContext:true});
});
test('catálogo compartilhado apresenta fornecedor prioritário mesmo com produtos de fontes distintas',()=>{
 const env={ASAAS_SANDBOX:'true',WA_AUTOMATION_ENABLED:'false',SUPPLIERS_JSON:JSON.stringify([
  {id:'james',phone:'8613800138000',template:'consulta_estoque'},
  {id:'outro',phone:'8613800138001',template:'consulta_estoque'}
 ])};
 const order={id:'a1b2c3d4-1234-4234-8234-123456789012',status:'paid_supplier_pending',city:'São Paulo',state:'SP',
  items_json:JSON.stringify([{id:'YUP-1',supplierId:'outro',title:'Barcelona',size:'M',qty:1},{id:'YUP-2',supplierId:'',title:'Braga',size:'G',qty:1}])};
 const preview=previewSupplierOrder(env,order);
 assert.equal(preview.supplier.id,'james');
 assert.equal(preview.supplierCandidates.length,2);
 assert.equal(preview.sharedCatalog,true);
 assert.equal(preview.readyForAutomaticSending,false);
});

test('resposta sem estoque seleciona o próximo fornecedor no Sandbox sem enviar mensagem',async()=>{
 const log=[];
 const order={id:'a1b2c3d4-1234-4234-8234-123456789012',status:'paid_supplier_pending',city:'São Paulo',state:'SP',
  items_json:JSON.stringify([{id:'YUP-123456',title:'Barcelona',size:'M',qty:1,image:'/images/foo.jpg'}])};
 const DB={
  prepare(sql){
   let args=[];
   const st={bind(...v){args=v;return st},
    async first(){if(sql.startsWith('SELECT id,status,items_json,city,state FROM orders'))return order;return null},
    async all(){if(sql.startsWith('SELECT supplier_id FROM supplier_attempts'))return {results:[{supplier_id:'james'}]};return {results:[]}},
    async run(){log.push({sql,args});return {meta:{changes:1}}}};
   return st;
  }
 };
 const env={DB,ASAAS_SANDBOX:'true',WA_AUTOMATION_ENABLED:'false',SUPPLIER_TEMPLATE_FORMAT:'minimal_v1',STORE_PUBLIC_URL:'https://streetball-store.kpgmer.workers.dev',
  SUPPLIERS_JSON:JSON.stringify([
    {id:'james',phone:'8613800138000',template:'consulta_foto',mediaTemplate:'consulta_foto'},
    {id:'outro',phone:'8613800138001',template:'consulta_foto',mediaTemplate:'consulta_foto'}
  ])};
 const routed=await routePaidOrder(env,order.id);
 assert.equal(routed,false);
 const draft=log.find(x=>x.sql.includes("UPDATE supplier_dispatch SET state='needs_configuration'"));
 assert.ok(draft);
 assert.equal(draft.args[0],'outro');
 assert.equal(draft.args[1],'8613800138001');
});

test('cadastro privado de telefone valida, mascara número e exige autenticação',async()=>{
 const db=mockDb(),env={DB:db,ADMIN_TOKEN:token,ASAAS_SANDBOX:'true',WA_AUTOMATION_ENABLED:'false'};
 await worker.fetch(admin('supplier-directory',{id:'china01',displayName:'Fornecedor China'}),env);
 let res=await worker.fetch(new Request('https://loja.exemplo.com/api/admin/supplier-contact',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({id:'china01',phone:'+86 138 0013 8000',authorized:true})
 }),env);
 assert.equal(res.status,401);
 res=await worker.fetch(admin('supplier-contact',{id:'china01',phone:'123',authorized:true}),env);
 assert.equal(res.status,400);
 res=await worker.fetch(admin('supplier-contact',{id:'china01',phone:'+86 138 0013 8000',authorized:true}),env);
 assert.equal(res.status,200);
 assert.equal(db.contacts.get('china01').phone,'8613800138000');
 const payload=await (await worker.fetch(admin('supplier-directory'),env)).json();
 assert.equal(payload.suppliers[0].phoneConfigured,true);
 assert.equal(payload.suppliers[0].phoneEnding,'8000');
 assert.equal(payload.suppliers[0].authorized,true);
 assert.equal(JSON.stringify(payload).includes('8613800138000'),false);
});
