import test from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,hkdfSync,createDecipheriv,createPublicKey,verify} from 'node:crypto';
import {base64url,validatePushSubscription,generateVapidKeys,encryptPushPayload,vapidAuthorization,sendWebPush,WebPushError} from '../worker/web-push.js';

function client(){const ecdh=createECDH('prime256v1');ecdh.generateKeys();return {ecdh,auth:crypto.getRandomValues(new Uint8Array(16)),subscription:null};}
function subscription(c){return {endpoint:'https://web.push.apple.com/example-token',keys:{p256dh:base64url(c.ecdh.getPublicKey()),auth:base64url(c.auth)}};}
test('RFC8291 payload decrypts independently with Node ECDH/HKDF/AES and a fresh salt per message',async()=>{
 const c=client(),sub=subscription(c),payload={title:'Streetball · Nova venda',url:'/ops/?orderId=ficticio'};
 const encrypted=Buffer.from(await encryptPushPayload(sub,payload));
 assert.equal(encrypted.readUInt32BE(16),4096);assert.equal(encrypted[20],65);
 const pub=encrypted.subarray(21,86),secret=c.ecdh.computeSecret(pub);
 const ikm=hkdfSync('sha256',secret,c.auth,Buffer.concat([Buffer.from('WebPush: info\0'),c.ecdh.getPublicKey(),pub]),32);
 const cek=hkdfSync('sha256',ikm,encrypted.subarray(0,16),Buffer.from('Content-Encoding: aes128gcm\0'),16);
 const nonce=hkdfSync('sha256',ikm,encrypted.subarray(0,16),Buffer.from('Content-Encoding: nonce\0'),12);
 const cipher=encrypted.subarray(86),decipher=createDecipheriv('aes-128-gcm',cek,nonce);decipher.setAuthTag(cipher.subarray(-16));
 const plain=Buffer.concat([decipher.update(cipher.subarray(0,-16)),decipher.final()]);
 assert.equal(plain.at(-1),2);assert.deepEqual(JSON.parse(plain.subarray(0,-1)),payload);
 assert.notDeepEqual(encrypted.subarray(0,16),Buffer.from(await encryptPushPayload(sub,payload)).subarray(0,16));
});
test('VAPID uses the push origin, a bounded expiry and a valid P256 ES256 signature',async()=>{
 const keys=await generateVapidKeys(),header=await vapidAuthorization('https://web.push.apple.com/path',keys,'https://lojastreetball.com.br');
 const jwt=header.match(/^vapid t=([^,]+)/)[1],parts=jwt.split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
 assert.equal(claims.aud,'https://web.push.apple.com');assert.equal(claims.sub,'https://lojastreetball.com.br');assert.ok(claims.exp>Date.now()/1000&&claims.exp<=Date.now()/1000+43201);
 const publicJwk={...keys.privateJwk};delete publicJwk.d;delete publicJwk.key_ops;
 assert.equal(verify('sha256',Buffer.from(parts.slice(0,2).join('.')),{key:createPublicKey({key:publicJwk,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')),true);
});
test('subscriptions cannot fetch private hosts, arbitrary origins, credentials, ports or lookalike push hosts',()=>{
 const c=client(),sub=subscription(c);assert.equal(validatePushSubscription(sub).endpoint,sub.endpoint);
 for(const endpoint of ['http://web.push.apple.com/a','https://127.0.0.1/a','https://web.push.apple.com.attacker.invalid/a','https://user:password@web.push.apple.com/a','https://web.push.apple.com:444/a','https://example.invalid/a','https://web.push.apple.com/a#fragment'])assert.throws(()=>validatePushSubscription({...sub,endpoint}));
 assert.throws(()=>validatePushSubscription({...sub,keys:{...sub.keys,auth:'AA'}}));
});
test('push is encrypted, never follows redirects and distinguishes expired subscriptions from temporary failures',async()=>{
 const sub=subscription(client()),keys=await generateVapidKeys(),calls=[];
 const send=status=>sendWebPush(sub,{title:'Teste',url:'/ops/'},keys,{topic:'fake-topic',request:async(url,options)=>{calls.push({url,options});return new Response(null,{status});}});
 assert.deepEqual(await send(201),{accepted:true,gone:false,status:201});assert.equal((await send(410)).gone,true);assert.equal((await send(503)).gone,false);
 const options=calls[0].options;assert.equal(options.redirect,'manual');assert.equal(options.headers['content-encoding'],'aes128gcm');assert.equal(options.headers.Topic,'fake-topic');assert.ok(!Buffer.from(options.body).includes(Buffer.from('Teste')));
});
test('response cleanup cannot turn an accepted push into a failed delivery',async()=>{
 const sub=subscription(client()),keys=await generateVapidKeys();
 const response=new Response('accepted',{status:201}),locked=response.body.getReader();
 try{assert.equal((await sendWebPush(sub,{title:'Teste'},keys,{request:async()=>response})).accepted,true);}
 finally{await locked.cancel();}
});
test('transport failures expose a stable safe code instead of endpoint tokens or raw provider errors',async()=>{
 const sub=subscription(client()),keys=await generateVapidKeys();
 for(const [name,code]of [['TimeoutError','PUSH_TIMEOUT'],['Error','PUSH_CONNECTION_FAILED']]){
  await assert.rejects(sendWebPush(sub,{title:'Teste'},keys,{request:async()=>{const error=Error('private endpoint token and network internals');error.name=name;throw error;}}),error=>{
   assert.ok(error instanceof WebPushError);assert.equal(error.code,code);assert.equal(error.phase,'transport');assert.ok(!error.message.includes('private'));return true;
  });
 }
});
test('only allowlisted provider reason codes are returned and broken response bodies preserve the HTTP result',async()=>{
 const sub=subscription(client()),keys=await generateVapidKeys();
 const valid=await sendWebPush(sub,{title:'Teste'},keys,{request:async()=>Response.json({reason:'BadJwtToken'},{status:403})});assert.equal(valid.reason,'BadJwtToken');
 const unsafe=await sendWebPush(sub,{title:'Teste'},keys,{request:async()=>Response.json({reason:'private endpoint token',endpoint:sub.endpoint},{status:403})});assert.equal(unsafe.reason,undefined);
 const locked=new Response('ignored',{status:410}),reader=locked.body.getReader();
 try{const sent=await sendWebPush(sub,{title:'Teste'},keys,{request:async()=>locked});assert.equal(sent.gone,true);assert.equal(sent.status,410);}finally{await reader.cancel();}
});
test('a push redirect is rejected after one request without forwarding VAPID credentials or encrypted content',async()=>{
 const sub=subscription(client()),keys=await generateVapidKeys();let calls=0;
 await assert.rejects(sendWebPush(sub,{title:'Teste'},keys,{request:async(url,options)=>{calls++;assert.equal(url,sub.endpoint);assert.equal(options.redirect,'manual');return new Response(null,{status:307,headers:{location:'https://unexpected.example.invalid/'}});}}),error=>error.code==='PUSH_UNEXPECTED_REDIRECT');
 assert.equal(calls,1);
});
