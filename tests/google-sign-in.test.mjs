import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyGoogleIdToken,googleClientIdValid} from '../worker/google-identity.js';
import worker from '../worker/index.js';
import {readFileSync} from 'node:fs';

const clientId='123456789012-abcde12345xyz.apps.googleusercontent.com';
const nonce='f'.repeat(64);
const origin='https://streetball-store.kpgmer.workers.dev';
const email='jogador@example.com';
let jwks,key;
const b64=x=>Buffer.from(x).toString('base64url');
async function signGoogleToken(override={}){
 const t=Math.floor(Date.now()/1000);
 const header=b64(JSON.stringify({kid:'fixture-1',alg:'RS256',typ:'JWT'}));
 const payload=b64(JSON.stringify({iss:'https://accounts.google.com',aud:clientId,sub:'104958729103948572910',
  email,email_verified:true,name:'Cliente Retro',nonce,iat:t-30,exp:t+300,...override}));
 const signed=header+'.'+payload;
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key.privateKey,new TextEncoder().encode(signed));
 return signed+'.'+b64(new Uint8Array(sig));
}
async function setupKeys(){
 key=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 jwks={keys:[{...(await crypto.subtle.exportKey('jwk',key.publicKey)),kid:'fixture-1',alg:'RS256',use:'sig'}]};
}
test('Google JWT checks real signature, audience, issuer, verified email, nonce and expiry',async()=>{
 await setupKeys();
 assert.equal(googleClientIdValid(clientId),true);
 const token=await signGoogleToken();
 const options={getKeys:async()=>jwks};
 const user=await verifyGoogleIdToken(token,clientId,nonce,options);
 assert.equal(user.email,email);assert.equal(user.sub,'104958729103948572910');
 await assert.rejects(()=>verifyGoogleIdToken(token,clientId,'a'.repeat(64),options),/claims/);
 await assert.rejects(()=>verifyGoogleIdToken(token.replace(/.$/,token.at(-1)==='A'?'B':'A'),clientId,nonce,options),/signature|Invalid/);
 await assert.rejects(()=>verifyGoogleIdToken(token,clientId+'x',nonce,options),/configured|nonce/);
 for(const claims of [{email_verified:false},{iss:'https://fake-google.com'},{aud:'another-app'},{exp:10},{sub:'123'},{nbf:Math.floor(Date.now()/1000)+1000}]){
  await assert.rejects(async()=>verifyGoogleIdToken(await signGoogleToken(claims),clientId,nonce,options));
 }
});
test('Google config hidden until real client ID set and nonce cookie is secure',async()=>{
 const DB={};
 let response=await worker.fetch(new Request(origin+'/api/account/google/config'),{DB});
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{enabled:false});
 response=await worker.fetch(new Request(origin+'/api/account/google/nonce'),{DB});
 assert.equal(response.status,503);
 response=await worker.fetch(new Request(origin+'/api/account/google/config'),{DB,GOOGLE_CLIENT_ID:clientId});
 assert.deepEqual(await response.json(),{enabled:true,clientId});
 response=await worker.fetch(new Request(origin+'/api/account/google/nonce'),{DB,GOOGLE_CLIENT_ID:clientId});
 const cookie=response.headers.get('set-cookie');
 assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);
 assert.match(cookie,/Max-Age=600/);
 const {nonce:n}=await response.json();assert.match(n,/^[a-f0-9]{64}$/);
 assert.ok(cookie.includes(n));
});
function mockDb(){
 const accounts=new Map(),identities=new Map(),sessions=new Map(),attempts=new Map();
 const stmtFactory=sql=>{
  let args=[];
  return {
   bind(...p){args=p;return this},
   async first(){
    if(sql.startsWith('SELECT id FROM customer_accounts WHERE email='))return accounts.has(args[0])?{id:accounts.get(args[0]).id}:null;
    if(sql.startsWith('SELECT g.customer_id,a.id,a.email,a.display_name')){
     const owner=identities.get(args[0]);if(!owner)return null;
     const a=[...accounts.values()].find(x=>x.id===owner.customer_id);
     return a?{customer_id:a.id,id:a.id,email:a.email,display_name:a.display_name}:null;
    }
    if(sql.startsWith('SELECT s.customer_id,u.email,u.display_name')){
     const session=sessions.get(args[0]);
     if(!session||session.expires_at<=args[1])return null;
     const a=[...accounts.values()].find(x=>x.id===session.customer_id);
     return a?{customer_id:a.id,id:a.id,email:a.email,display_name:a.display_name}:null;
    }
    if(sql.startsWith('SELECT google_sub FROM customer_google_identities WHERE customer_id=')){
     const entry=[...identities].find(([k,v])=>v.customer_id===args[0]);return entry?{google_sub:entry[0]}:null;
    }
    throw Error('Unexpected SQL first: '+sql);
   },
   async run(){
    if(sql.startsWith('INSERT INTO customer_accounts')){
     const [id,mail,display_name,password_salt,password_hash]=args;
     if(accounts.has(mail))throw Error('duplicate email');
     accounts.set(mail,{id,email:mail,display_name,password_salt,password_hash});return;
    }
    if(sql.startsWith('INSERT INTO customer_google_identities')){
     const [google_sub,customer_id,email_at_link,linked_at]=args;
     if(identities.has(google_sub))throw Error('duplicate identity');
     identities.set(google_sub,{customer_id,email_at_link,linked_at});return;
    }
    if(sql.startsWith('INSERT INTO customer_sessions')){
     const [token_sha256,customer_id,created_at,expires_at]=args;
     sessions.set(token_sha256,{customer_id,expires_at});return;
    }
    throw Error('Unexpected SQL run: '+sql);
   }
  }
 };
 return {accounts,identities,sessions,prepare:stmtFactory,async batch(statements){for(const st of statements)await st.run()}};
}
function req(path,method='GET',body=null,cookie=''){
 const headers={accept:'application/json'};
 if(method==='POST'){headers.origin=origin;headers['content-type']='application/json';}
 if(cookie)headers.cookie=cookie;
 return new Request(origin+path,{method,headers,...(body!==null?{body:JSON.stringify(body)}:{})});
}
test('Google-only account gets a private session; existing email cannot be silently taken over',async()=>{
 if(!key)await setupKeys();
 const old=globalThis.fetch;
 globalThis.fetch=async url=>{
  assert.equal(url,'https://www.googleapis.com/oauth2/v3/certs');
  return new Response(JSON.stringify(jwks),{status:200,headers:{'content-type':'application/json'}});
 };
 try{
  const DB=mockDb(),env={DB,GOOGLE_CLIENT_ID:clientId};
  let response=await worker.fetch(req('/api/account/google/login','POST',{credential:await signGoogleToken()}),env);
  assert.equal(response.status,401); // nonce obrigatório
  const nonceResponse=await worker.fetch(req('/api/account/google/nonce'),env);
  const sessionNonce=(await nonceResponse.json()).nonce;
  const googleToken=await signGoogleToken({nonce:sessionNonce});
  const cookie=nonceResponse.headers.get('set-cookie').split(';')[0];
  response=await worker.fetch(req('/api/account/google/login','POST',{credential:googleToken},cookie),env);
  assert.equal(response.status,200);
  assert.match(response.headers.get('set-cookie'),/HttpOnly/);
  const signedIn=await response.json();assert.equal(signedIn.user.email,email);
  assert.equal(DB.accounts.size,1);assert.equal(DB.identities.size,1);
  const authCookie=response.headers.get('set-cookie').match(/__Host-streetball_session=[a-f0-9]{64}/)?.[0];
  assert.ok(authCookie,'Sessão retornada via cookie HttpOnly');
  response=await worker.fetch(req('/api/account/me','GET',null,authCookie),env);
  assert.equal((await response.json()).authenticated,true);

  // Conta já criada com e-mail sem vínculo Google: não conectar automaticamente.
  const otherDB=mockDb();
  otherDB.accounts.set(email,{id:'existing-owner',email,display_name:'Cliente Existente'});
  const anotherNonce=await worker.fetch(req('/api/account/google/nonce'),{DB:otherDB,GOOGLE_CLIENT_ID:clientId});
  const {nonce:nonce2}=await anotherNonce.json();
  const cookie2=anotherNonce.headers.get('set-cookie').split(';')[0];
  response=await worker.fetch(req('/api/account/google/login','POST',{credential:await signGoogleToken({nonce:nonce2})},cookie2),{DB:otherDB,GOOGLE_CLIENT_ID:clientId});
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/senha/);
  assert.equal(otherDB.identities.size,0);
 }finally{globalThis.fetch=old;}
});
test('cliente com senha pode conectar sua própria Conta Google e depois entrar por ela',async()=>{
 if(!key)await setupKeys();
 const previousFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify(jwks),{status:200,headers:{'content-type':'application/json'}});
 try{
  const DB=mockDb(),env={DB,GOOGLE_CLIENT_ID:clientId};
  const registration=await worker.fetch(req('/api/account/register','POST',{
   displayName:'Cliente Retro',email,password:'senha-exclusiva-de-teste-2026'
  }),env);
  assert.equal(registration.status,200);
  const privateCookie=registration.headers.get('set-cookie').split(';')[0];
  const issued=await worker.fetch(req('/api/account/google/nonce'),env);
  const {nonce:issuedNonce}=await issued.json();
  const nonceCookie=issued.headers.get('set-cookie').split(';')[0];
  const credential=await signGoogleToken({nonce:issuedNonce});
  const linked=await worker.fetch(req('/api/account/google/connect','POST',
    {credential},privateCookie+'; '+nonceCookie),env);
  assert.equal(linked.status,200);
  assert.equal((await linked.json()).connected,true);
  assert.equal(DB.accounts.size,1);
  assert.equal(DB.identities.size,1);
  const fresh=await worker.fetch(req('/api/account/google/nonce'),env);
  const {nonce:freshNonce}=await fresh.json();
  const freshCookie=fresh.headers.get('set-cookie').split(';')[0];
  const signed=await worker.fetch(req('/api/account/google/login','POST',
    {credential:await signGoogleToken({nonce:freshNonce})},freshCookie),env);
  assert.equal(signed.status,200);
  assert.equal((await signed.json()).user.email,email);
  assert.equal(DB.accounts.size,1);
 }finally{globalThis.fetch=previousFetch;}
});
test('cards show full authorized square art and CTA icons no longer use emoji arrows',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/editorial.css',import.meta.url),'utf8');
 const account=readFileSync(new URL('../public/account.html',import.meta.url),'utf8');
 const accountJs=readFileSync(new URL('../public/account.js',import.meta.url),'utf8');
 assert.match(css,/Editorial cards V4/);
 assert.ok(css.includes('aspect-ratio:1/1'));
 assert.match(css,/object-fit:contain/);
 assert.match(html,/ui-arrow-up-right/);
 assert.equal(html.includes('CRIAR CONTA <span>↗</span>'),false);
 assert.equal(html.includes('VER TODAS AS COLEÇÕES <span>↗</span>'),false);
 assert.match(account,/id="googleSignInButton"/);
 assert.match(account,/id="googleConnectButton"/);
 assert.ok(accountJs.includes('accounts.id.initialize'));
 assert.doesNotThrow(()=>new Function(accountJs));
 assert.match(readFileSync(new URL('../worker/schema.sql',import.meta.url),'utf8'),/customer_google_identities/);
});
