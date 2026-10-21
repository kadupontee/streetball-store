import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';

const env={ADMIN_TOKEN:'segredo-ficticio',DB:{prepare(){throw Error('O simulador jamais deve consultar o D1')}}};
const endpoint='https://loja.exemplo.com/api/admin/whatsapp-dry-run';
async function submit(text,linked=true,auth=true){
 const response=await worker.fetch(new Request(endpoint,{
  method:'POST',
  headers:{'content-type':'application/json',...(auth?{authorization:'Bearer segredo-ficticio'}:{})},
  body:JSON.stringify({text,linked})
 }),env);
 return {status:response.status,result:await response.json()};
}

test('simulação exige ADMIN_TOKEN',async()=>{
 const response=await submit('não temos',true,false);
 assert.equal(response.status,401);
});

test('resposta com contexto fictício classifica falta de estoque sem DB',async()=>{
 const r=await submit('não temos',true);
 assert.equal(r.status,200);
 assert.equal(r.result.replyKind,'unavailable');
 assert.match(r.result.nextAction,/próximo fornecedor/);
 assert.equal(r.result.sent,false);
 assert.equal(r.result.databaseModified,false);
});

test('texto solto sem contexto ou ID não identifica pedidos',async()=>{
 const r=await submit('não temos',false);
 assert.equal(r.result.replyKind,'unlinked_or_unrecognized');
 assert.match(r.result.nextAction,/timeout de 12h/);
});

test('resposta ambígua vinculada avança; disponibilidade aguarda confirmação',async()=>{
 const doubtful=await submit('talvez semana que vem',true);
 assert.equal(doubtful.result.replyKind,'ambiguous');
 const available=await submit('temos em estoque',true);
 assert.equal(available.result.replyKind,'available');
 assert.match(available.result.nextAction,/conferir modelo, tamanho e preço/);
});

test('ID curto explícito é reconhecido sem contexto',async()=>{
 const r=await submit('SEM_ESTOQUE 1234abcd',false);
 assert.equal(r.result.replyKind,'unavailable');
 assert.equal(r.result.correlation,'ID curto presente');
});

test('teste rejeita mensagens extensas e entrada inválida',async()=>{
 assert.equal((await submit('a'.repeat(401))).status,400);
 const r=await worker.fetch(new Request(endpoint,{method:'POST',headers:{authorization:'Bearer segredo-ficticio','content-type':'application/json'},body:'{"text":12,"linked":true}'}),env);
 assert.equal(r.status,400);
});

test('interface contém laboratório independente de contatos reais',()=>{
 const html=readFileSync(new URL('../public/suppliers.html',import.meta.url),'utf8');
 assert.match(html,/Laboratório de respostas do WhatsApp/);
 assert.match(html,/waLabForm/);
 assert.doesNotThrow(()=>new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
});
