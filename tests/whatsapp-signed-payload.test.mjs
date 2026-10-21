import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import worker from '../worker/index.js';

const endpoint='https://loja.exemplo.com/api/webhooks/whatsapp';
const secret='chave_de_teste_que_nao_e_real';
const payload={
 object:'whatsapp_business_account',
 entry:[{id:'conta-ficticia',changes:[{field:'messages',value:{
  messaging_product:'whatsapp',
  metadata:{display_phone_number:'000000000',phone_number_id:'numero-ficticio'},
  messages:[{id:'wamid.fake.123',from:'8613800138000',
   context:{id:'wamid.consulta.ficticia'},timestamp:'1792620000',
   type:'text',text:{body:'não temos'}}]
 }}]}]
};
const raw=JSON.stringify(payload);
const signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
const env={
 WA_APP_SECRET:secret,
 WA_AUTOMATION_ENABLED:'false',
 ASAAS_SANDBOX:'true',
 DB:{prepare(){throw Error('O webhook não pode consultar o banco quando WhatsApp está desligado')}}
};
test('webhook fictício assinado é reconhecido mas não processado quando envio está desligado',async()=>{
 const response=await worker.fetch(new Request(endpoint,{method:'POST',
  headers:{'content-type':'application/json','x-hub-signature-256':signature},
  body:raw
 }),env);
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{ok:true});
});

test('webhook falso sem assinatura válida é rejeitado',async()=>{
 const response=await worker.fetch(new Request(endpoint,{method:'POST',
  headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+'0'.repeat(64)},
  body:raw
 }),env);
 assert.equal(response.status,403);
});

test('webhook adulterado depois de assinar é rejeitado',async()=>{
 const altered=raw.replace('não temos','temos em estoque');
 const response=await worker.fetch(new Request(endpoint,{method:'POST',
  headers:{'content-type':'application/json','x-hub-signature-256':signature},
  body:altered
 }),env);
 assert.equal(response.status,403);
});
