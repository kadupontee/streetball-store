import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {customerTrackingLink,verifyTrackingKey} from '../worker/order-tracking-access.js';

const origin='https://lojastreetball.com.br';
const clientId='123456789012-abcde12345xyz.apps.googleusercontent.com';

test('o domínio novo mantém a navegação da conta e o client ID Google existente',async()=>{
 const env={DB:{},GOOGLE_CLIENT_ID:clientId};
 for(const host of [origin,'https://www.lojastreetball.com.br','https://streetball-store.kpgmer.workers.dev']){
  const route=await worker.fetch(new Request(host+'/criar-conta'),env);
  assert.equal(route.status,302);
  assert.equal(route.headers.get('location'),host+'/account.html#criar-conta');
  const config=await worker.fetch(new Request(host+'/api/account/google/config'),env);
  assert.deepEqual(await config.json(),{enabled:true,clientId});
  const nonce=await worker.fetch(new Request(host+'/api/account/google/nonce'),env);
  assert.equal(nonce.status,200);
  const cookie=nonce.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly; Secure; SameSite=Lax; Path=\//);
  assert.doesNotMatch(cookie,/Domain=/i);
 }
});

test('requisições de outros domínios não alteram a conta no domínio novo',async()=>{
 for(const attacker of ['https://streetballstore.com.br','https://outro.exemplo.com']){
  const response=await worker.fetch(new Request(origin+'/api/account/google/login',{
   method:'POST',headers:{origin:attacker,'content-type':'application/json'},body:'{}'
  }),{DB:{},GOOGLE_CLIENT_ID:clientId});
  assert.equal(response.status,403);
 }
});

test('novos links de rastreio usam o domínio novo com a mesma verificação privada',async()=>{
 const id='b40f5778-d2b9-4662-b29a-a513b0e97d42';
 const env={STORE_PUBLIC_URL:origin,TRACKING_LINK_SECRET:'chave-apenas-de-teste-'.repeat(3)};
 const url=new URL(await customerTrackingLink(env,id));
 assert.equal(url.origin,origin);
 assert.equal(url.pathname,'/track.html');
 const [orderId,key]=url.hash.slice(1).split('.');
 assert.equal(orderId,id);
 assert.equal(await verifyTrackingKey(env.TRACKING_LINK_SECRET,id,key),true);
});
