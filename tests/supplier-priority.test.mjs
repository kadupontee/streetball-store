import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {loadSupplierCandidates} from '../worker/fulfillment.js';

test('nova prioridade salva no D1 e controla a fila de fornecedores',async()=>{
 const names=['fornecedor_a','fornecedor_b','fornecedor_c'],rank=new Map();
 const db={
  prepare(sql){
   let args=[];
   const st={
    bind(...x){args=x;return st},
    async all(){
     if(sql.startsWith('SELECT id FROM supplier_directory'))return {results:names.map(id=>({id}))};
     if(sql.includes('FROM supplier_directory d LEFT JOIN supplier_contacts')){
      return {results:names.map(id=>({id,display_name:id,phone_e164:'8613800138000',authorized:1,rank:rank.get(id)||null}))
       .sort((a,b)=>(a.rank??999)-(b.rank??999))};
     }
     return {results:[]};
    },
    async run(){
     if(sql.startsWith('INSERT INTO supplier_priority'))rank.set(args[0],args[1]);
     return {meta:{changes:1}};
    }
   };
   return st;
  },
  async batch(statements){for(const x of statements)await x.run()}
 };
 const env={DB:db,ADMIN_TOKEN:'senha-de-teste',SUPPLIER_WA_TEMPLATE:'estoque'};
 const make=ids=>new Request('https://example.com/api/admin/supplier-priority',{
  method:'POST',headers:{authorization:'Bearer senha-de-teste'},
  body:JSON.stringify({ids})
 });
 let response=await worker.fetch(make(['fornecedor_c','fornecedor_a','fornecedor_b']),env);
 assert.equal(response.status,200);
 assert.equal(rank.get('fornecedor_c'),1);
 assert.deepEqual((await loadSupplierCandidates(env)).map(x=>x.id),['fornecedor_c','fornecedor_a','fornecedor_b']);
 response=await worker.fetch(make(['fornecedor_a','fornecedor_a','fornecedor_b']),env);
 assert.equal(response.status,400);
 response=await worker.fetch(make(['fornecedor_a','fornecedor_b']),env);
 assert.equal(response.status,409);
});
