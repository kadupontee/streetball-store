/** Customer account authentication for Cloudflare Workers + D1. Session cookies are HttpOnly.
 * Existing purchases can only be linked with a buyer-held private tracking token.
 */
import {verifyTrackingKey,customerTrackingLink} from './order-tracking-access.js';
import {verifyGoogleIdToken,googleClientIdValid} from './google-identity.js';
const COOKIE='__Host-streetball_session';
const GOOGLE_NONCE_COOKIE='__Host-streetball_google_nonce';
const result=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const safeError=(reason,status=400)=>result({error:reason},status);
const encoder=new TextEncoder();
const bytesToHex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const normalizeEmail=email=>String(email??'').trim().toLowerCase().slice(0,180);
const goodEmail=email=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=180;
const goodPassword=p=>typeof p==='string'&&p.length>=12&&p.length<=128;
const makeRandom=()=>bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
const sha=async text=>bytesToHex(await crypto.subtle.digest('SHA-256',encoder.encode(text)));
const hashedPassword=async(password,salt)=>{
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:140000,hash:'SHA-256'},key,256);
 return bytesToHex(bits);
};
const sameHash=(a,b)=>{
 if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
};
const csrfOk=req=>{
 const origin=req.headers.get('origin');
 return origin&&origin===new URL(req.url).origin;
};
async function parseBody(req){if(Number(req.headers.get('content-length')||0)>4500)return null;return req.json().catch(()=>null)}
const cookieSession=req=>{
 const cookie=req.headers.get('cookie')||'';
 const match=cookie.match(/(?:^|;\s*)__Host-streetball_session=([0-9a-f]{64})(?:;|$)/);
 return match?.[1]||null;
};
export async function getCustomerSession(req,env){
 if(!env.DB)return null;
 const cookie=cookieSession(req);if(!cookie)return null;
 const digest=await sha(cookie);
 const current=await env.DB.prepare('SELECT s.customer_id,u.email,u.display_name,u.id FROM customer_sessions s JOIN customer_accounts u ON u.id=s.customer_id WHERE s.token_sha256=? AND s.expires_at>?').bind(digest,new Date().toISOString()).first();
 return current||null;
}
const liveCookie=token=>COOKIE+'='+token+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800';
const clearCookie=()=>COOKIE+'=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';

const googleNonceCookie=value=>GOOGLE_NONCE_COOKIE+'='+value+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600';
const expireGoogleNonce=()=>GOOGLE_NONCE_COOKIE+'=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
const extractGoogleNonce=req=>{
 const m=(req.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-streetball_google_nonce=([a-f0-9]{64})(?:;|$)/);
 return m?.[1]||null;
};
const googleConfigured=env=>googleClientIdValid(env.GOOGLE_CLIENT_ID);
async function googleUser(req,env){
 const body=await parseBody(req),expectedNonce=extractGoogleNonce(req);
 if(!body||!expectedNonce||typeof body.credential!=='string')
  return {error:safeError('Solicitação Google expirada. Atualize a página e tente novamente.',401)};
 try{return {identity:await verifyGoogleIdToken(body.credential,env.GOOGLE_CLIENT_ID,expectedNonce)}}
 catch{return {error:safeError('Não foi possível verificar o login do Google. Reabra a página e tente novamente.',401)}}
}
function clearGoogleNonceFromResponse(response){
 response.headers.append('set-cookie',expireGoogleNonce());
 return response;
}
async function newSession(env,account){
 const token=makeRandom(),hash=await sha(token),issued=new Date(),expires=new Date(issued.getTime()+7*86400000);
 await env.DB.prepare('INSERT INTO customer_sessions(token_sha256,customer_id,created_at,expires_at) VALUES(?,?,?,?)').bind(hash,account.id,issued.toISOString(),expires.toISOString()).run();
 return result({ok:true,user:{displayName:account.display_name,email:account.email} },200,{'set-cookie':liveCookie(token)});
}
const attemptsInfo=async(env,email)=>env.DB.prepare('SELECT attempts,window_started_at FROM customer_login_attempts WHERE email=?').bind(email).first();
const incrementAttempts=async(env,email)=>{
 const t=new Date(),win=t.toISOString(),cutoff=new Date(t.getTime()-15*60000).toISOString();
 await env.DB.prepare('INSERT INTO customer_login_attempts(email,attempts,window_started_at) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET attempts=CASE WHEN window_started_at<? THEN 1 ELSE attempts+1 END,window_started_at=CASE WHEN window_started_at<? THEN excluded.window_started_at ELSE window_started_at END').bind(email,1,win,cutoff,cutoff).run();
};
export async function handleAccountRoute(req,env){
 if(!env.DB)return safeError('Cadastro de contas indisponível no momento.',503);
 const path=new URL(req.url).pathname,method=req.method;
 const allowed=['/api/account/register','/api/account/login','/api/account/logout','/api/account/me','/api/account/orders','/api/account/claim','/api/account/google/config','/api/account/google/nonce','/api/account/google/login','/api/account/google/connect'];
 if(!allowed.includes(path))return safeError('Endpoint não encontrado.',404);
 if(method!=='GET'&&method!=='POST')return safeError('Método inválido.',405);
 if(method==='POST'&&!csrfOk(req))return safeError('Origem de solicitação inválida.',403);

 if(path==='/api/account/google/config'&&method==='GET'){
  return result({enabled:googleConfigured(env),...(googleConfigured(env)?{clientId:env.GOOGLE_CLIENT_ID}:{})});
 }
 if(path==='/api/account/google/nonce'&&method==='GET'){
  if(!googleConfigured(env))return safeError('Login com Google ainda não está configurado.',503);
  const nonce=makeRandom();
  return result({nonce},200,{'set-cookie':googleNonceCookie(nonce)});
 }
 if((path==='/api/account/google/login'||path==='/api/account/google/connect')&&method==='POST'){
  if(!googleConfigured(env))return safeError('Login com Google ainda não está configurado.',503);
  const verified=await googleUser(req,env);
  if(verified.error)return verified.error;
  const identity=verified.identity;
  const record=await env.DB.prepare('SELECT g.customer_id,a.id,a.email,a.display_name FROM customer_google_identities g JOIN customer_accounts a ON a.id=g.customer_id WHERE g.google_sub=?').bind(identity.sub).first();
  if(path==='/api/account/google/connect'){
   const user=await getCustomerSession(req,env);
   if(!user)return safeError('Entre com a senha para conectar sua conta ao Google.',401);
   if(user.email!==identity.email)return safeError('Para conectar o Google, escolha uma conta com o mesmo e-mail do cadastro Streetball.',409);
   if(record&&record.customer_id!==user.customer_id)return safeError('Esta conta Google já está associada a outro cadastro.',409);
   if(!record){
    const linked=await env.DB.prepare('SELECT google_sub FROM customer_google_identities WHERE customer_id=?').bind(user.customer_id).first();
    if(linked)return safeError('Esta conta Streetball já possui outra conta Google vinculada.',409);
    try{await env.DB.prepare('INSERT INTO customer_google_identities(google_sub,customer_id,email_at_link,linked_at) VALUES(?,?,?,?)').bind(identity.sub,user.customer_id,identity.email,new Date().toISOString()).run()}
    catch{return safeError('Não foi possível conectar a conta Google. Tente novamente.',409)}
   }
   return clearGoogleNonceFromResponse(result({ok:true,connected:true}));
  }
  if(record){
   if(record.email!==identity.email)return safeError('A conta Google mudou de e-mail. Contate o suporte para conferir o cadastro.',409);
   return clearGoogleNonceFromResponse(await newSession(env,{id:record.customer_id,display_name:record.display_name,email:record.email}));
  }
  const existing=await env.DB.prepare('SELECT id FROM customer_accounts WHERE email=?').bind(identity.email).first();
  if(existing)return safeError('Já existe cadastro com esse e-mail. Entre com sua senha e use Conectar Google na sua conta.',409);
  const account={id:crypto.randomUUID(),email:identity.email,display_name:identity.name.length>=2?identity.name:'Cliente Streetball'};
  const created=new Date().toISOString();
  try{
   // Senha aleatória não utilizável: este cadastro entra exclusivamente pelo Google.
   const salt=makeRandom(),disabledPasswordHash=makeRandom();
   await env.DB.batch([
    env.DB.prepare('INSERT INTO customer_accounts(id,email,display_name,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?)').bind(account.id,account.email,account.display_name,salt,disabledPasswordHash,created),
    env.DB.prepare('INSERT INTO customer_google_identities(google_sub,customer_id,email_at_link,linked_at) VALUES(?,?,?,?)').bind(identity.sub,account.id,identity.email,created)
   ]);
  }catch{return safeError('Não foi possível criar a conta Google. Tente novamente.',409)}
  return clearGoogleNonceFromResponse(await newSession(env,account));
 }
 if(path==='/api/account/me'&&method==='GET'){
  const user=await getCustomerSession(req,env);
  return user?result({authenticated:true,user:{displayName:user.display_name,email:user.email}}):result({authenticated:false});
 }
 if(path==='/api/account/register'&&method==='POST'){
  const body=await parseBody(req);
  const name=String(body?.displayName||'').trim().slice(0,70),email=normalizeEmail(body?.email);
  if(name.length<2||!goodEmail(email)||!goodPassword(body?.password))return safeError('Informe nome, e-mail válido e senha de 12 a 128 caracteres.');
  const existing=await env.DB.prepare('SELECT id FROM customer_accounts WHERE email=?').bind(email).first();
  if(existing)return safeError('Este e-mail já possui cadastro. Entre na sua conta.',409);
  const salt=makeRandom(),hash=await hashedPassword(body.password,salt),id=crypto.randomUUID(),created=new Date().toISOString();
  try{
   await env.DB.prepare('INSERT INTO customer_accounts(id,email,display_name,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?)').bind(id,email,name,salt,hash,created).run();
  }catch{return safeError('Não foi possível criar a conta. Confira o e-mail ou tente novamente.',409)}
  return newSession(env,{id,email,display_name:name});
 }
 if(path==='/api/account/login'&&method==='POST'){
  const body=await parseBody(req),email=normalizeEmail(body?.email);
  if(!goodEmail(email)||!goodPassword(body?.password))return safeError('Credenciais inválidas.',401);
  const failed=await attemptsInfo(env,email),limitTime=new Date(Date.now()-15*60000).toISOString();
  if(failed&&failed.window_started_at>=limitTime&&failed.attempts>=8)return safeError('Muitas tentativas. Tente novamente mais tarde.',429);
  const account=await env.DB.prepare('SELECT id,email,display_name,password_salt,password_hash FROM customer_accounts WHERE email=?').bind(email).first();
  const given=await hashedPassword(body.password,account?.password_salt||'00000000000000000000000000000000');
  if(!account||!sameHash(given,account.password_hash)){
   await incrementAttempts(env,email);return safeError('E-mail ou senha incorretos.',401);
  }
  await env.DB.prepare('DELETE FROM customer_login_attempts WHERE email=?').bind(email).run();
  return newSession(env,account);
 }
 if(path==='/api/account/logout'&&method==='POST'){
  const token=cookieSession(req);
  if(token)await env.DB.prepare('DELETE FROM customer_sessions WHERE token_sha256=?').bind(await sha(token)).run();
  return result({ok:true},200,{'set-cookie':clearCookie()});
 }
 const user=await getCustomerSession(req,env);
 if(!user)return safeError('Entre na sua conta para acessar pedidos.',401);
 if(path==='/api/account/orders'&&method==='GET'){
  const data=await env.DB.prepare('SELECT o.id,o.status,o.total,o.created_at,o.items_json,m.carrier,m.tracking_code FROM customer_order_links l JOIN orders o ON o.id=l.order_id LEFT JOIN order_tracking_meta m ON m.order_id=o.id WHERE l.customer_id=? ORDER BY o.created_at DESC LIMIT 60').bind(user.customer_id).all();
  const orders=await Promise.all((data.results||[]).map(async o=>({
   id:o.id.slice(0,8),createdAt:o.created_at,status:o.status,total:o.total,
   items:(()=>{try{return JSON.parse(o.items_json).map(i=>({title:String(i.title||'').slice(0,120),qty:i.qty,size:i.size})).slice(0,40)}catch{return []}})(),
   trackingCode:o.tracking_code||null,
   carrier:o.carrier||null,
   trackingUrl:await customerTrackingLink(env,o.id)
  })));
  return result({orders});
 }
 if(path==='/api/account/claim'&&method==='POST'){
  const body=await parseBody(req),id=String(body?.orderId||''),access=body?.access;
  if(!await verifyTrackingKey(env.TRACKING_LINK_SECRET,id,access))return safeError('Link privado de acompanhamento inválido.',403);
  const order=await env.DB.prepare('SELECT id FROM orders WHERE id=?').bind(id).first();
  if(!order)return safeError('Pedido não encontrado.',404);
  await env.DB.prepare('INSERT OR IGNORE INTO customer_order_links(customer_id,order_id,linked_at) VALUES(?,?,?)').bind(user.customer_id,id,new Date().toISOString()).run();
  return result({ok:true});
 }
 return safeError('Método não permitido.',405);
}
/** Link a new checkout order to its authenticated purchaser, never by unverified email alone. */
export async function linkAuthenticatedCheckout(req,env,orderId,buyerEmail){
 const user=await getCustomerSession(req,env);
 if(!user||user.email!==buyerEmail)return false;
 await env.DB.prepare('INSERT OR IGNORE INTO customer_order_links(customer_id,order_id,linked_at) VALUES(?,?,?)').bind(user.customer_id,orderId,new Date().toISOString()).run();
 return true;
}
