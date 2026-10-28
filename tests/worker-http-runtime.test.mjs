import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const root=fileURLToPath(new URL('../',import.meta.url));
const entry=`
import {sendWebPush,generateVapidKeys,base64url} from './web-push.js';
import {asaasRequest} from './asaas.js';
export default {async fetch(request){
 try{
  if(new URL(request.url).pathname==='/charge'){
   const charge=await asaasRequest('/customers',{ASAAS_SANDBOX:'true',ASAAS_API_KEY:'fake-sandbox-runtime-key'},{name:'Cliente fictício'});
   return Response.json({ok:true,id:charge.id});
  }
  const client=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const sub={endpoint:'https://web.push.apple.com/native-runtime-test-only',keys:{p256dh:base64url(await crypto.subtle.exportKey('raw',client.publicKey)),auth:base64url(crypto.getRandomValues(new Uint8Array(16)))}};
  const sent=await sendWebPush(sub,{title:'Teste fictício',url:'/ops/'},await generateVapidKeys());
  return Response.json({ok:true,...sent});
 }catch(error){return Response.json({ok:false,code:error.code||null,message:error.message},{status:502});}
}};
`;

// Keep workerd's global fetch intact. Only the outbound HTTP service is fake:
// Request construction, fetch init validation and redirects run in real workerd.
test('native Workers fetch sends push and charges, and rejects redirects before forwarding credentials', {timeout:30000},async t=>{
 let status=201;
 const calls=[];
 const mf=new Miniflare(convertV4MiniflareOptions({
  compatibilityDate:'2026-07-01',modulesRoot:path.join(root,'worker'),
  modules:[
   {type:'ESModule',path:path.join(root,'worker/native-http-regression.mjs'),contents:entry},
   {type:'ESModule',path:path.join(root,'worker/web-push.js')},
   {type:'ESModule',path:path.join(root,'worker/asaas.js')}
  ],
  outboundService:async request=>{
   const url=new URL(request.url);assert.ok(['web.push.apple.com','api-sandbox.asaas.com'].includes(url.hostname));
   const body=new Uint8Array(await request.arrayBuffer());
   calls.push({url:request.url,method:request.method,authorization:request.headers.get('authorization'),apiKey:request.headers.get('access_token'),bodyLength:body.byteLength});
   if(status===307)return new Response(null,{status:307,headers:{location:'https://unexpected.example.invalid/never-follow'}});
   return url.hostname==='web.push.apple.com'?new Response(null,{status:201}):Response.json({id:'fake-customer'});
  }
 }));
 t.after(()=>mf.dispose());
 let response=await mf.dispatchFetch('https://worker.test/push'),data=await response.json();
 assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.accepted,true);assert.equal(calls.length,1);assert.equal(calls[0].method,'POST');assert.match(calls[0].authorization,/^vapid /);assert.ok(calls[0].bodyLength>86);

 status=307;calls.length=0;
 response=await mf.dispatchFetch('https://worker.test/push');data=await response.json();
 assert.equal(data.code,'PUSH_UNEXPECTED_REDIRECT');assert.equal(calls.length,1);

 status=201;calls.length=0;
 response=await mf.dispatchFetch('https://worker.test/charge');data=await response.json();
 assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.id,'fake-customer');assert.equal(calls.length,1);assert.equal(calls[0].apiKey,'fake-sandbox-runtime-key');

 status=307;calls.length=0;
 response=await mf.dispatchFetch('https://worker.test/charge');data=await response.json();
 assert.equal(response.status,502);assert.match(data.message,/Redirecionamento inesperado/);assert.equal(calls.length,1);
});
