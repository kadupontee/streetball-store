import test from 'node:test';
import assert from 'node:assert/strict';
import {monitorSupplierSLA,isSearchExpired,PER_SUPPLIER_TIMEOUT_MS,ORDER_SEARCH_DEADLINE_MS,apologyDraft} from '../worker/fulfillment.js';

function fakeDb({hasOverdue=true,hasPending=false,optin=false}={}){
 const sqlCalls=[],writes=[],state={reviewed:false};
 const id='12345678-1234-4234-8234-123456789012';
 const db={
  prepare(sql){
   let args=[];
   const st={
    bind(...parts){args=parts;return st},
    async all(){
     sqlCalls.push(sql);
     if(sql.includes("d.created_at<=?")&&sql.includes("FROM supplier_dispatch d JOIN orders"))return {results:hasOverdue&&!state.reviewed?[{order_id:id,phone:'11999999999'}]:[]};
     if(sql.includes("d.state='awaiting_reply'")&&sql.includes("FROM supplier_dispatch d JOIN orders"))return {results:hasPending?[{order_id:id,supplier_id:'james',supplier_phone:'8613800138000',sent_at:new Date(Date.now()-13*3600e3).toISOString()}]:[]};
     if(sql.startsWith('SELECT supplier_id FROM supplier_attempts'))return {results:[{supplier_id:'james'}]};
     if(sql.includes('FROM supplier_directory d LEFT JOIN supplier_contacts'))return {results:[]};
     return {results:[]};
    },
    async first(){
     if(sql.startsWith('SELECT order_id FROM buyer_message_optin'))return optin?{order_id:id}:null;
     if(sql.startsWith('SELECT id,status,items_json FROM orders'))return {id,status:'paid_supplier_pending',items_json:'[]'};
     if(sql.startsWith('SELECT created_at FROM supplier_dispatch'))return {created_at:new Date(Date.now()-14*3600e3).toISOString()};
     return null;
    },
    async run(){
     writes.push({sql,args});
     if(sql.includes("SET state='deadline_review'"))state.reviewed=true;
     return {meta:{changes:1}};
    }
   };
   return st;
  }
 };
 return {db,writes,sqlCalls,id};
}

test('prazos separados: 12 horas por fornecedor e 72 horas para buscar disponibilidade',()=>{
 assert.equal(PER_SUPPLIER_TIMEOUT_MS,12*3600e3);
 assert.equal(ORDER_SEARCH_DEADLINE_MS,72*3600e3);
 const past=new Date(Date.now()-73*3600e3).toISOString();
 assert.equal(isSearchExpired(past),true);
 assert.equal(isSearchExpired(new Date().toISOString()),false);
});

test('Sandbox e automação desligada não enviam desculpas nem alteram pedidos',async()=>{
 const r=fakeDb();
 await monitorSupplierSLA({DB:r.db,ASAAS_SANDBOX:'true',WA_AUTOMATION_ENABLED:'true'});
 await monitorSupplierSLA({DB:r.db,ASAAS_SANDBOX:'false',WA_AUTOMATION_ENABLED:'false'});
 assert.equal(r.sqlCalls.length,0);
 assert.equal(r.writes.length,0);
});

test('72h vencidas levam a revisão manual e aviso manual quando falta template',async()=>{
 const r=fakeDb();
 await monitorSupplierSLA({DB:r.db,ASAAS_SANDBOX:'false',WA_AUTOMATION_ENABLED:'true'});
 assert.ok(r.writes.some(w=>w.sql.includes("state='deadline_review'")));
 assert.ok(r.writes.some(w=>w.sql.includes("status='manual_review'")));
 assert.ok(r.writes.some(w=>w.sql.includes('buyer_delay_notifications')&&w.args.includes('needs_manual_contact')));
 await monitorSupplierSLA({DB:r.db,ASAAS_SANDBOX:'false',WA_AUTOMATION_ENABLED:'true'});
 assert.equal(r.writes.filter(w=>w.sql.includes('buyer_delay_notifications')).length,1);
 assert.match(apologyDraft(r.id),/desculpas pela demora/);
});

test('sem consentimento, template não pode enviar desculpas automaticamente',async()=>{
 const r=fakeDb({optin:false});
 await monitorSupplierSLA({DB:r.db,ASAAS_SANDBOX:'false',WA_AUTOMATION_ENABLED:'true',BUYER_DELAY_WA_TEMPLATE:'pedido_atrasado'});
 assert.ok(r.writes.some(w=>w.sql.includes('buyer_delay_notifications')&&w.args.includes('needs_manual_contact')));
 assert.ok(!r.writes.some(w=>w.sql.includes("state='sending'")));
});

test('12h sem resposta pula fornecedor e registra timeout antes de 72h',async()=>{
 const r=fakeDb({hasOverdue:false,hasPending:true});
 await monitorSupplierSLA({DB:r.db,ASAAS_SANDBOX:'false',WA_AUTOMATION_ENABLED:'true'});
 assert.ok(r.writes.some(w=>w.sql.includes("state='supplier_skipped'")));
 assert.ok(r.writes.some(w=>w.sql.includes('supplier_attempts')&&w.args.includes('timed_out')));
});
