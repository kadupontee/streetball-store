// Use a distinct Cloudflare secret; never expose order IDs as a form of authentication.
export async function makeTrackingKey(secret,orderId){
 if(typeof secret!=='string'||secret.length<32)return null;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('tracking-v1:'+orderId));
 return [...new Uint8Array(signed)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function verifyTrackingKey(secret,orderId,provided){
 if(!/^[a-f0-9-]{36}$/i.test(String(orderId))||!/^[a-f0-9]{64}$/i.test(String(provided)))return false;
 const expected=await makeTrackingKey(secret,orderId);
 if(!expected)return false;
 let delta=0;
 for(let i=0;i<64;i++)delta|=expected.charCodeAt(i)^provided.charCodeAt(i);
 return delta===0;
}
export async function customerTrackingLink(env,orderId){
 const key=await makeTrackingKey(env.TRACKING_LINK_SECRET,orderId);
 const base=String(env.STORE_PUBLIC_URL||'').replace(/\/+$/,'');
 return key&&/^https:\/\//.test(base)?base+'/track.html#'+orderId+'.'+key:null;
}
