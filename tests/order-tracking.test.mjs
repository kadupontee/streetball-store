import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTrackingKey,verifyTrackingKey,customerTrackingLink} from '../worker/order-tracking-access.js';
import {formatProgress,STAGES,safeTrackingCode} from '../worker/order-progress.js';
import worker from '../worker/index.js';
import {readFileSync} from 'node:fs';

const secret='abc123-very-long-local-test-secret-never-used-in-production';
const id='12345678-1234-4234-8234-123456789012';
const env={TRACKING_LINK_SECRET:secret,STORE_PUBLIC_URL:'https://streetball-store.kpgmer.workers.dev'};
test('assinatura de rastreamento exige segredo distinto e rejeita adulteração',async()=>{
 const token=await makeTrackingKey(secret,id);
 assert.match(token,/^[a-f0-9]{64}$/);
 assert.equal(await verifyTrackingKey(secret,id,token),true);
 assert.equal(await verifyTrackingKey(secret,id+'x',token),false);
 assert.equal(await verifyTrackingKey(secret,id,'a'.repeat(64)),false);
 assert.equal(await makeTrackingKey('',id),null);
 const link=await customerTrackingLink(env,id);
 assert.match(link,/\/track\.html#12345678/);
 assert.equal(link.includes(secret),false);
 assert.equal(await customerTrackingLink({},id),null);
});

test('a linha do tempo pública nunca inclui CPF, nome, telefone ou endereço',()=>{
 const result=formatProgress({id,status:'paid_supplier_pending'},{carrier:'correios',tracking_code:'LB123456789CN'},[
 {stage:'tax_payment_due',evidence_source:'correios',created_at:'2026-10-21T12:00:00Z'},
 {stage:'shipped',evidence_source:'supplier',created_at:'2026-10-20T12:00:00Z'}]);
 assert.equal(result.orderId,'12345678');
 assert.equal(result.payTaxesAtOfficialCorreios,true);
 assert.equal(result.events.length,2);
 assert.equal(result.events[0].label,STAGES.tax_payment_due);
 assert.equal(JSON.stringify(result).includes('CPF'),false);
 assert.equal(safeTrackingCode('LB123456789CN'),true);
 assert.equal(safeTrackingCode('javascript:alert(1)'),false);
});

test('endpoint público exige chave mesmo com ID completo',async()=>{
 const body={orderId:id,access:'a'.repeat(64)};
 const response=await worker.fetch(new Request('https://example.com/api/track',{
 method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),
 {DB:{prepare(){throw Error('Não consultar banco sem chave válida')}},TRACKING_LINK_SECRET:secret});
 assert.equal(response.status,403);
});

test('link autorizado lê somente status e eventos verificados, sem PII',async()=>{
 const token=await makeTrackingKey(secret,id);
 const queries=[];
 const DB={prepare(sql){
  queries.push(sql);
  return {bind(){return {first:async()=>sql.includes('FROM orders')?{id,status:'paid_supplier_pending'}:
   sql.includes('FROM order_tracking_meta')?{carrier:'correios',tracking_code:'LB123456789CN'}:null,
   all:async()=>({results:[{stage:'tax_payment_due',evidence_source:'correios',created_at:'2026-10-21T12:00:00Z'}]})}}};
 }};
 const result=await worker.fetch(new Request('https://example.com/api/track',{
 method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({orderId:id,access:token})}),
 {...env,DB});
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.payTaxesAtOfficialCorreios,true);
 assert.equal(data.trackingCode,'LB123456789CN');
 assert.equal(queries.length,3);
 assert.ok(!('name' in data)&&!('address' in data)&&!('cpf' in data));
});

test('admin só aceita progresso se etapa e fonte foram verificadas',async()=>{
 const updates=[],DB={prepare(sql){
  let args=[];const q={
   bind(...vals){args=vals;return q},
   async first(){
    if(sql.startsWith('SELECT id,status FROM orders'))return {id,status:'paid_supplier_pending'};
    if(sql.startsWith('SELECT stage FROM order_tracking_events'))return null;
    return null;
   },
   async run(){updates.push({sql,args});return {meta:{changes:1}}}
  };return q;
 },async batch(states){for(const st of states)await st.run()}};
 const request=(verified,code)=>new Request('https://example.com/api/admin/order-progress',{method:'POST',
  headers:{authorization:'Bearer secret-admin','content-type':'application/json'},
  body:JSON.stringify({orderId:id,stage:'tax_payment_due',carrier:'correios',trackingCode:code,source:'correios',verified})});
 assert.equal((await worker.fetch(request(false,'LB123456789CN'),{DB,ADMIN_TOKEN:'secret-admin',...env})).status,400);
 assert.equal((await worker.fetch(request(true,''),{DB,ADMIN_TOKEN:'secret-admin',...env})).status,400);
 const accepted=await worker.fetch(request(true,'LB123456789CN'),{DB,ADMIN_TOKEN:'secret-admin',...env});
 assert.equal(accepted.status,200);
 assert.equal(updates.length,2);
 assert.ok(updates.some(x=>x.sql.startsWith('INSERT INTO order_tracking_events')));
});

test('interface cliente e estimador de tributos têm JavaScript válido',()=>{
 for(const name of ['track','imports']){
  const html=readFileSync(new URL('../public/'+name+'.html',import.meta.url),'utf8');
  const script=html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script,name);
  assert.doesNotThrow(()=>new Function(script[1]),name);
 }
});
