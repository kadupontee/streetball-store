// RFC 8291 (aes128gcm) and RFC 8292 (VAPID), using Workers Web Crypto.
const utf8=new TextEncoder();
export class WebPushError extends Error{
 constructor(code,phase,message){super(message);this.name='WebPushError';this.code=code;this.phase=phase;}
}
const providerReasons=new Set(['BadJwtToken','ExpiredJwtToken','BadVapidPublicKey','BadWebPushRequest','BadTtl','MissingTtl','PayloadTooLarge','TooManyRequests','Unregistered','NotFound','BadPath','Forbidden','Unauthorized']);
export const base64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function fromBase64url(value){
 if(typeof value!=='string'||!value||!/^[-_A-Za-z0-9]+$/.test(value))throw Error('Chave de notificação inválida.');
 return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0));
}
const join=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
export function validatePushSubscription(raw){
 let url;try{url=new URL(raw?.endpoint);}catch{throw Error('Endereço de notificação inválido.');}
 // A subscription must never become an arbitrary server-side fetch or redirect.
 const host=url.hostname;
 const allowed=host==='web.push.apple.com'||host.endsWith('.push.apple.com')||host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.notify.windows.com');
 if(!allowed||url.protocol!=='https:'||url.port||url.username||url.password||url.hash||url.href.length>2048)throw Error('Serviço de notificação não reconhecido.');
 const publicKey=fromBase64url(raw?.keys?.p256dh),auth=fromBase64url(raw?.keys?.auth);
 if(publicKey.length!==65||publicKey[0]!==4||auth.length!==16)throw Error('Chaves de notificação inválidas.');
 return {endpoint:url.href,keys:{p256dh:base64url(publicKey),auth:base64url(auth)}};
}
export async function generateVapidKeys(){
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 return {publicKey:base64url(await crypto.subtle.exportKey('raw',pair.publicKey)),privateJwk:await crypto.subtle.exportKey('jwk',pair.privateKey)};
}
async function hkdf(secret,salt,info,bits){
 const key=await crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,bits));
}
export async function encryptPushPayload(subscription,payload){
 const plain=utf8.encode(JSON.stringify(payload));
 if(plain.length>3000)throw Error('Notificação muito grande.');
 const ua=fromBase64url(subscription.keys.p256dh),auth=fromBase64url(subscription.keys.auth);
 const server=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const serverPublic=new Uint8Array(await crypto.subtle.exportKey('raw',server.publicKey));
 const clientPublic=await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const secret=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:clientPublic},server.privateKey,256));
 const ikm=await hkdf(secret,auth,join(utf8.encode('WebPush: info\0'),ua,serverPublic),256);
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const cek=await hkdf(ikm,salt,utf8.encode('Content-Encoding: aes128gcm\0'),128);
 const nonce=await hkdf(ikm,salt,utf8.encode('Content-Encoding: nonce\0'),96);
 const aes=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},aes,join(plain,new Uint8Array([2]))));
 const recordSize=new Uint8Array(4);new DataView(recordSize.buffer).setUint32(0,4096);
 return join(salt,recordSize,new Uint8Array([65]),serverPublic,ciphertext);
}
export async function vapidAuthorization(endpoint,keys,subject){
 const claims={aud:new URL(endpoint).origin,exp:Math.floor(Date.now()/1000)+12*3600,sub:subject};
 const unsigned=base64url(utf8.encode(JSON.stringify({typ:'JWT',alg:'ES256'})))+'.'+base64url(utf8.encode(JSON.stringify(claims)));
 const key=await crypto.subtle.importKey('jwk',keys.privateJwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,utf8.encode(unsigned));
 return 'vapid t='+unsigned+'.'+base64url(sig)+', k='+keys.publicKey;
}
export async function sendWebPush(raw,payload,keys,{subject='https://lojastreetball.com.br',topic,request=fetch}={}){
 let subscription,body,authorization;
 try{subscription=validatePushSubscription(raw);}catch{throw new WebPushError('PUSH_SUBSCRIPTION_INVALID','subscription','O cadastro de notificações deste aparelho precisa ser renovado.');}
 try{body=await encryptPushPayload(subscription,payload);}catch{throw new WebPushError('PUSH_ENCRYPTION_FAILED','encryption','Não foi possível preparar o aviso para este aparelho.');}
 try{authorization=await vapidAuthorization(subscription.endpoint,keys,subject);}catch{throw new WebPushError('PUSH_SIGNING_FAILED','authentication','A configuração de envio da loja precisa ser conferida.');}
 const headers={authorization,'content-encoding':'aes128gcm','content-type':'application/octet-stream',TTL:'86400',Urgency:'high'};
 if(topic)headers.Topic=topic;
 let response;
 try{response=await request(subscription.endpoint,{method:'POST',headers,body,redirect:'manual',signal:AbortSignal.timeout(12000)});}
 catch(error){
  const timeout=['AbortError','TimeoutError'].includes(error?.name);
  throw new WebPushError(timeout?'PUSH_TIMEOUT':'PUSH_CONNECTION_FAILED','transport',timeout?'O serviço de notificações demorou para responder. Tente enviar o teste novamente.':'A loja não conseguiu se conectar ao serviço de notificações. Tente novamente.');
 }
 if(response.status>=300&&response.status<400){
  try{await response.body?.cancel();}catch{}
  throw new WebPushError('PUSH_UNEXPECTED_REDIRECT','provider','O serviço de notificações retornou um redirecionamento inesperado. O envio foi interrompido.');
 }
 const accepted=response.status>=200&&response.status<300;
 let reason=null;
 // An HTTP acceptance is definitive. Cleanup must not turn it into an unknown
 // network failure or trigger another delivery. Never expose raw provider bodies.
 if(!accepted&&response.body){
  let reader;
  try{
   reader=response.body.getReader();let size=0,text='';const decoder=new TextDecoder();
   while(size<2048){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;text+=decoder.decode(chunk.value,{stream:true});}
   const data=JSON.parse(text);if(providerReasons.has(data?.reason))reason=data.reason;
  }catch{}finally{try{await reader?.cancel();}catch{}}
 }else{try{await response.body?.cancel();}catch{}}
 return {accepted,gone:[404,410].includes(response.status),status:response.status,...(reason?{reason}:{})};
}
