/** Verificação no servidor dos ID tokens Google Identity Services.
 * Não aceita tokens sem assinatura, audiences alternativos nem email não verificado.
 * O botão é inicializado somente quando GOOGLE_CLIENT_ID é configurado.
 * Google OIDC: https://developers.google.com/identity/openid-connect/openid-connect
 */
const KEYS_URL='https://www.googleapis.com/oauth2/v3/certs';
const textDecoder=new TextDecoder();
function decodePart(segment){
 if(!/^[A-Za-z0-9_-]+$/.test(segment)||segment.length>12000)throw Error('Invalid JWT encoding');
 const text=atob(segment.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-segment.length%4)%4));
 return Uint8Array.from(text,c=>c.charCodeAt(0));
}
function parseJson(bytes){
 try{return JSON.parse(textDecoder.decode(bytes))}catch{throw Error('Invalid JWT JSON')}
}
export function googleClientIdValid(value){
 return typeof value==='string'&&/^[0-9]{6,30}-[a-zA-Z0-9_-]{12,120}\.apps\.googleusercontent\.com$/.test(value);
}
export async function verifyGoogleIdToken(token,clientId,expectedNonce,{getKeys=undefined,currentTime=undefined}={}){
 if(!googleClientIdValid(clientId)||typeof expectedNonce!=='string'||!/^[a-f0-9]{64}$/.test(expectedNonce))
  throw Error('Google sign-in not configured or nonce unavailable');
 if(typeof token!=='string'||token.length<200||token.length>9500)throw Error('Invalid Google credential');
 const parts=token.split('.');
 if(parts.length!==3)throw Error('Invalid JWT structure');
 const [headerSegment,payloadSegment,signatureSegment]=parts;
 const header=parseJson(decodePart(headerSegment)),claims=parseJson(decodePart(payloadSegment));
 if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>180)throw Error('Google JWT algorithm rejected');
 const current=Math.floor((currentTime??Date.now())/1000);
 if(!['https://accounts.google.com','accounts.google.com'].includes(claims.iss)||
    claims.aud!==clientId||claims.nonce!==expectedNonce||
    claims.email_verified!==true||
    typeof claims.sub!=='string'||!/^[0-9]{8,40}$/.test(claims.sub)||
    typeof claims.email!=='string'||claims.email.length>180||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)||
    !Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||
    claims.iat>current+60||claims.exp<=current||claims.exp>current+7200||
    (claims.nbf!==undefined&&(typeof claims.nbf!=='number'||claims.nbf>current+60))||
    (claims.azp!==undefined&&claims.azp!==clientId))
  throw Error('Invalid Google token claims');
 const keys=getKeys?await getKeys():await (async()=>{
  const response=await fetch(KEYS_URL,{headers:{accept:'application/json'}});
  if(!response.ok)throw Error('Google certificate service unavailable');
  return response.json();
 })();
 const jwk=keys?.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.use==='sig'&&(!k.alg||k.alg==='RS256'));
 if(!jwk)throw Error('Google signing key not found');
 const cryptoKey=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 const signed=new TextEncoder().encode(headerSegment+'.'+payloadSegment);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',cryptoKey,decodePart(signatureSegment),signed))
  throw Error('Invalid Google JWT signature');
 return {sub:claims.sub,email:claims.email.trim().toLowerCase(),name:String(claims.name||claims.given_name||'Cliente').trim().slice(0,70)};
}
