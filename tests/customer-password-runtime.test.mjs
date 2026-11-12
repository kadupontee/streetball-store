import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import worker from '../worker/index.js';
import {localD1} from './support/local-d1.mjs';

const ORIGIN='https://lojastreetball.com.br';
const PASSWORD='Senha-de-teste-segura-2026';
function request(action,data,cookie){
 const headers={origin:ORIGIN,'content-type':'application/json'};
 if(cookie)headers.cookie=cookie;
 return new Request(ORIGIN+'/api/account/'+action,{
  method:data===undefined?'GET':'POST',headers,
  ...(data===undefined?{}:{body:JSON.stringify(data)})
 });
}
function cloudflarePbkdf2Limit(t){
 const deriveBits=crypto.subtle.deriveBits.bind(crypto.subtle);
 t.mock.method(crypto.subtle,'deriveBits',(algorithm,key,length)=>{
  if(algorithm.name==='PBKDF2'&&algorithm.iterations>100000){
   throw new DOMException('Pbkdf2 failed: iteration counts above 100000 are not supported (requested '+algorithm.iterations+')','NotSupportedError');
  }
  return deriveBits(algorithm,key,length);
 });
}

test('cadastro, sessão e novo login funcionam com o limite PBKDF2 de produção',async t=>{
 cloudflarePbkdf2Limit(t);
 const {db,query}=localD1(t),env={DB:db};
 const email='teste-cadastro@example.com';
 const registered=await worker.fetch(request('register',{displayName:'Cliente Teste',email,password:PASSWORD}),env);
 assert.equal(registered.status,200,await registered.clone().text());
 const cookie=registered.headers.get('set-cookie').split(';')[0];
 assert.match(registered.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
 const row=query({sql:'SELECT password_salt,password_hash FROM customer_accounts WHERE email=?',args:[email]}).results[0];
 assert.match(row.password_hash,/^pbkdf2-sha256\$100000\$[a-f0-9]{64}$/);
 assert.equal(row.password_hash.split('$')[2],pbkdf2Sync(PASSWORD,row.password_salt,100000,32,'sha256').toString('hex'));
 assert.ok(!JSON.stringify(row).includes(PASSWORD));
 let response=await worker.fetch(request('me',undefined,cookie),env);
 assert.equal((await response.json()).authenticated,true);
 response=await worker.fetch(request('register',{displayName:'Duplicado',email,password:PASSWORD}),env);
 assert.equal(response.status,409);
 response=await worker.fetch(request('logout',{},cookie),env);
 assert.equal(response.status,200);
 response=await worker.fetch(request('me',undefined,cookie),env);
 assert.equal((await response.json()).authenticated,false);
 response=await worker.fetch(request('login',{email,password:PASSWORD}),env);
 assert.equal(response.status,200);
 assert.ok(response.headers.get('set-cookie'));
 response=await worker.fetch(request('login',{email,password:'Senha-incorreta-2026'}),env);
 assert.equal(response.status,401);
 response=await worker.fetch(request('login',{email:'inexistente@example.com',password:PASSWORD}),env);
 assert.equal(response.status,401);
});

test('senhas antigas de 140 mil iterações continuam válidas sob o limite de produção',async t=>{
 cloudflarePbkdf2Limit(t);
 const {db,query}=localD1(t),env={DB:db};
 const email='legado@example.com',salt='a'.repeat(64),password='Senha-antiga-com-acentuação-2026';
 const hash=pbkdf2Sync(password,salt,140000,32,'sha256').toString('hex');
 query({sql:'INSERT INTO customer_accounts(id,email,display_name,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?)',args:['legacy-customer',email,'Cliente Existente',salt,hash,new Date().toISOString()]});
 let response=await worker.fetch(request('login',{email,password:'Senha-antiga-incorreta'}),env);
 assert.equal(response.status,401);
 response=await worker.fetch(request('login',{email,password}),env);
 assert.equal(response.status,200,await response.clone().text());
 assert.equal((await response.json()).user.email,email);
 assert.ok(response.headers.get('set-cookie'));
 assert.equal(query({sql:'SELECT password_hash FROM customer_accounts WHERE email=?',args:[email]}).results[0].password_hash,hash);
});

test('limitação de tentativas e bloqueio de outra origem continuam ativos',async t=>{
 cloudflarePbkdf2Limit(t);
 const {db}=localD1(t),env={DB:db};
 const req=request('register',{displayName:'Teste',email:'teste@example.com',password:PASSWORD});
 req.headers.set('origin','https://outra-origem.example');
 assert.equal((await worker.fetch(req,env)).status,403);
 for(let i=0;i<8;i++){
  assert.equal((await worker.fetch(request('login',{email:'sem-conta@example.com',password:PASSWORD}),env)).status,401);
 }
 assert.equal((await worker.fetch(request('login',{email:'sem-conta@example.com',password:PASSWORD}),env)).status,429);
});
