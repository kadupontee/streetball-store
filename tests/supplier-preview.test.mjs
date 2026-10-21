import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {previewSupplierOrder} from '../worker/fulfillment.js';
import {readFileSync} from 'node:fs';

const id='12345678-1234-4234-8234-123456789012';
const order={
 id,
 status:'paid_supplier_pending',
 items_json:JSON.stringify([{
   id:'YUP-123456',supplierId:'james',
   title:'Camisa do São Paulo 2026',size:'M',qty:1,
   patch:true,personalize:true,customName:'KADU',customNumber:'10',
   image:'/images/produto.jpg'
 }])
};

test('prévia do fornecedor não habilita envio nem expõe dados do cliente',()=>{
 const env={
  ASAAS_SANDBOX:'true',WA_AUTOMATION_ENABLED:'false',
  STORE_PUBLIC_URL:'https://streetball-store.kpgmer.workers.dev',
  SUPPLIERS_JSON:JSON.stringify([{id:'james',phone:'8613800138000',template:'pedido_fornecedor',mediaTemplate:'pedido_fornecedor_foto'}]),
  WA_TOKEN:'token-ficticio',WA_PHONE_NUMBER_ID:'id-ficticio'
 };
 const preview=previewSupplierOrder(env,order);
 assert.equal(preview.readyForAutomaticSending,false);
 assert.equal(preview.checks.whatsappAutomationDisabled,true);
 assert.equal(preview.supplier.id,'james');
 assert.equal(preview.supplier.phoneEnding,'8000');
 assert.equal(preview.firstPhotoUrl,'https://streetball-store.kpgmer.workers.dev/images/produto.jpg');
 assert.match(preview.messageSummary,/São Paulo/);
 assert.match(preview.messageSummary,/M x1/);
 assert.equal(preview.items[0].customName,'KADU');
 assert.equal(preview.items[0].customNumber,'10');
 assert.equal(JSON.stringify(preview).includes('token-ficticio'),false);
 assert.equal(JSON.stringify(preview).includes('8613800138000'),false);
});

test('prévia mostra pendências quando não há fornecedor ou foto',()=>{
 const result=previewSupplierOrder({WA_AUTOMATION_ENABLED:'false'},order);
 assert.equal(result.supplier,null);
 assert.equal(result.firstPhotoUrl,null);
 assert.equal(result.checks.supplierConfigured,false);
 assert.equal(result.readyForAutomaticSending,false);
});

test('rota de prévia exige ADMIN_TOKEN',async()=>{
 const request=new Request('https://loja.exemplo.com/api/admin/supplier-preview?orderId='+id);
 const response=await worker.fetch(request,{ADMIN_TOKEN:'segredo-local',DB:{}});
 assert.equal(response.status,401);
});

test('rota autorizada apenas lê pedido e não envia mensagens',async()=>{
 const calls=[];
 const DB={prepare(sql){calls.push(sql);if(sql.startsWith('SELECT id,status,items_json FROM orders'))return {bind(value){assert.equal(value,id);return {first:async()=>order}}};return {bind(){return {all:async()=>({results:[]})}}}}};
 const request=new Request('https://loja.exemplo.com/api/admin/supplier-preview?orderId='+id,{
  headers:{authorization:'Bearer segredo-local'}
 });
 const response=await worker.fetch(request,{ADMIN_TOKEN:'segredo-local',DB,WA_AUTOMATION_ENABLED:'false'});
 assert.equal(response.status,200);
 const preview=await response.json();
 assert.equal(preview.status,'paid_supplier_pending');
 assert.equal(preview.readyForAutomaticSending,false);
 assert.equal(calls.length,2);
 assert.match(calls[0],/^SELECT id,status,items_json FROM orders/);
 assert.match(calls[1],/^SELECT product_id, supplier_id FROM supplier_product_map/);
});

test('painel administrativo inclui prévia com JavaScript válido',()=>{
 const html=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
 const match=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(match);
 assert.doesNotThrow(()=>new Function(match[1]));
 assert.match(html,/data-preview=/);
 assert.match(html,/PRÉVIA SEM ENVIO/);
});
