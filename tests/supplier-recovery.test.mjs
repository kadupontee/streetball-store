import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';
import {loadSupplierCandidates} from '../worker/fulfillment.js';

test('sem tabela de prioridade, cadastro antigo continua visível e íntegro',async()=>{
 const contact={id:'fornecedor_1',display_name:'Fornecedor existente',phone_e164:'8613800138000',authorized:1};
 const db={
  prepare(sql){
   if(sql.includes('supplier_priority'))return {all:async()=>{throw Error('D1_ERROR: no such table: supplier_priority: SQLITE_ERROR')}};
   if(sql.includes('supplier_directory d LEFT JOIN supplier_contacts'))return {all:async()=>({results:[{...contact,rank:null}]})};
   return {all:async()=>({results:[]})};
  }
 };
 const env={ADMIN_TOKEN:'teste-local',DB:db,WA_AUTOMATION_ENABLED:'false',ASAAS_SANDBOX:'true'};
 const response=await worker.fetch(new Request('https://example.com/api/admin/supplier-directory',{headers:{authorization:'Bearer teste-local'}}),env);
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.suppliers.length,1);
 assert.equal(body.suppliers[0].display_name,'Fornecedor existente');
 assert.equal(body.suppliers[0].phoneEnding,'8000');
 assert.ok(!JSON.stringify(body).includes('8613800138000'));
 const candidates=await loadSupplierCandidates(env);
 assert.equal(candidates.length,1);
 assert.equal(candidates[0].id,'fornecedor_1');
});

test('erro administrativo não deve ser confundido com lista apagada',()=>{
 const html=readFileSync(new URL('../public/suppliers.html',import.meta.url),'utf8');
 assert.match(html,/ERRO AO CARREGAR/);
 assert.match(html,/Isso não significa que foram excluídos/);
 const match=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(match);
 assert.doesNotThrow(()=>new Function(match[1]));
});
