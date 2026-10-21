import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';

const auth='dev-test-token';
function request(path,body,authorized=true){
 return new Request('https://store.example/api/admin/'+path,{
  method:'POST',
  headers:{'content-type':'application/json',...(authorized?{authorization:'Bearer '+auth}:{})},
  body:JSON.stringify(body)
 });
}
function storage(){
 const directory=new Map([['fornecedor_a',{id:'fornecedor_a',display_name:'Fornecedor Antigo'}]]);
 const contacts=new Map([['fornecedor_a',{phone:'8613800138000',authorized:1}]]);
 const priority=new Map([['fornecedor_a',1]]);
 const mapping=new Map([['PRODUTO001','fornecedor_a']]);
 const history=[{supplier_id:'fornecedor_a',state:'unavailable'}];
 let active=0;
 const db={prepare(sql){
  let args=[];
  const st={
   bind(...v){args=v;return st},
   async first(){
    if(sql.startsWith('SELECT d.id,c.phone_e164 FROM supplier_directory')){
     if(!directory.has(args[0]))return null;
     return {id:args[0],phone_e164:contacts.get(args[0])?.phone||null};
    }
    if(sql.startsWith('SELECT id,display_name FROM supplier_directory WHERE')){
     return directory.get(args[0])||null;
    }
    if(sql.startsWith('SELECT COUNT(*) AS total FROM supplier_dispatch'))return {total:active};
    return null;
   },
   async run(){
    if(sql.startsWith('UPDATE supplier_directory SET display_name')){
     directory.set(args[2],{...directory.get(args[2]),display_name:args[0]});
    }else if(sql.startsWith('INSERT INTO supplier_contacts')){
     contacts.set(args[0],{phone:args[1],authorized:args[2]});
    }else if(sql.startsWith('UPDATE supplier_contacts SET authorized')){
     contacts.set(args[2],{...contacts.get(args[2]),authorized:args[0]});
    }else if(sql.startsWith('DELETE FROM supplier_product_map')){
     for(const [key,id] of mapping)if(id===args[0])mapping.delete(key);
    }else if(sql.startsWith('DELETE FROM supplier_priority'))priority.delete(args[0]);
    else if(sql.startsWith('DELETE FROM supplier_contacts'))contacts.delete(args[0]);
    else if(sql.startsWith('DELETE FROM supplier_directory'))directory.delete(args[0]);
    return {meta:{changes:1}};
   }
  };return st;
 },async batch(statements){for(const s of statements)await s.run();}};
 return {db,directory,contacts,priority,mapping,history,setActive:value=>{active=value}};
}

test('editar nome e autorização mantém telefone e histórico',async()=>{
 const store=storage();
 const env={DB:store.db,ADMIN_TOKEN:auth,WA_AUTOMATION_ENABLED:'false',ASAAS_SANDBOX:'true'};
 let res=await worker.fetch(request('supplier-update',{id:'fornecedor_a',displayName:'Fornecedor Atualizado',phone:'',authorized:false}),env);
 assert.equal(res.status,200);
 assert.equal(store.directory.get('fornecedor_a').display_name,'Fornecedor Atualizado');
 assert.equal(store.contacts.get('fornecedor_a').phone,'8613800138000');
 assert.equal(store.contacts.get('fornecedor_a').authorized,0);
 assert.equal(store.history.length,1);
 const payload=await res.json();
 assert.equal(payload.phoneEnding,'8000');
 assert.equal(JSON.stringify(payload).includes('8613800138000'),false);
 res=await worker.fetch(request('supplier-update',{id:'fornecedor_a',displayName:'Fornecedor Novo',phone:'+86 139 2222 3333',authorized:true}),env);
 assert.equal(res.status,200);
 assert.equal(store.contacts.get('fornecedor_a').phone,'8613922223333');
 assert.equal(store.contacts.get('fornecedor_a').authorized,1);
});

test('exclusão requer token, confirmação e não apaga pedidos ou tentativas',async()=>{
 const store=storage(),env={DB:store.db,ADMIN_TOKEN:auth,WA_AUTOMATION_ENABLED:'false',ASAAS_SANDBOX:'true'};
 let res=await worker.fetch(request('supplier-delete',{id:'fornecedor_a',confirmId:'fornecedor_a'},false),env);
 assert.equal(res.status,401);
 res=await worker.fetch(request('supplier-delete',{id:'fornecedor_a',confirmId:'incorreto'}),env);
 assert.equal(res.status,400);
 assert.equal(store.directory.size,1);
 store.setActive(1);
 res=await worker.fetch(request('supplier-delete',{id:'fornecedor_a',confirmId:'fornecedor_a'}),env);
 assert.equal(res.status,409);
 assert.equal(store.directory.size,1);
 store.setActive(0);
 res=await worker.fetch(request('supplier-delete',{id:'fornecedor_a',confirmId:'fornecedor_a'}),env);
 assert.equal(res.status,200);
 assert.equal(store.directory.size,0);
 assert.equal(store.contacts.size,0);
 assert.equal(store.priority.size,0);
 assert.equal(store.mapping.size,0);
 assert.equal(store.history.length,1);
});

test('painel de edição e exclusão mantém script válido',()=>{
 const html=readFileSync(new URL('../public/suppliers.html',import.meta.url),'utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Function(script[1]));
 assert.match(html,/data-edit/);
 assert.match(html,/data-delete/);
 assert.match(html,/editSupplierForm/);
 assert.match(html,/confirmId/);
});
