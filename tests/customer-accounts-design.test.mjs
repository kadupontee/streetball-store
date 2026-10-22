import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {makeTrackingKey} from '../worker/order-tracking-access.js';
import {readFileSync} from 'node:fs';

const BASE='https://streetball-store.kpgmer.workers.dev';
const ORDER='12345678-1234-4234-8234-123456789012';
const SECRET='unit-test-only-tracking-secret-of-forty-chars';
const order={id:ORDER,status:'paid_supplier_pending',created_at:'2026-10-22T10:00:00Z',total:199.9,items_json:JSON.stringify([{title:'Camisa Real Madrid retrô',qty:1,size:'P'}])};

function mockedDb(){
 const accounts=new Map(),sessions=new Map(),attempts=new Map(),links=new Map();
 return {accounts,sessions,links,
  prepare(sql){
   let p=[];const stmt={
    bind(...v){p=v;return stmt},
    async first(){
     if(sql==='SELECT id FROM customer_accounts WHERE email=?')return accounts.get(p[0])?{id:accounts.get(p[0]).id}:null;
     if(sql.startsWith('SELECT s.customer_id,u.email,u.display_name')){const ses=sessions.get(p[0]);const ac=ses&&accounts.get(ses.email);return ac&&ses.expires_at>p[1]?{customer_id:ac.id,email:ac.email,display_name:ac.display_name,id:ac.id}:null}
     if(sql.startsWith('SELECT attempts,window_started_at FROM customer_login_attempts'))return attempts.get(p[0])||null;
     if(sql.startsWith('SELECT id,email,display_name,password_salt,password_hash FROM customer_accounts'))return accounts.get(p[0])||null;
     if(sql==='SELECT id FROM orders WHERE id=?')return p[0]===ORDER?{id:ORDER}:null;
     throw Error('Unknown .first SQL '+sql);
    },
    async run(){
     if(sql.startsWith('INSERT INTO customer_accounts')){const [id,email,display_name,password_salt,password_hash]=p;accounts.set(email,{id,email,display_name,password_salt,password_hash});return {meta:{changes:1}}}
     if(sql.startsWith('INSERT INTO customer_sessions')){const [digest,customer_id,created_at,expires_at]=p;const ac=[...accounts.values()].find(x=>x.id===customer_id);sessions.set(digest,{email:ac.email,expires_at});return {meta:{changes:1}}}
     if(sql.startsWith('DELETE FROM customer_login_attempts')){attempts.delete(p[0]);return {meta:{changes:1}}}
     if(sql.startsWith('INSERT INTO customer_login_attempts')){attempts.set(p[0],{attempts:1,window_started_at:p[2]});return {meta:{changes:1}}}
     if(sql.startsWith('DELETE FROM customer_sessions')){sessions.delete(p[0]);return {meta:{changes:1}}}
     if(sql.startsWith('INSERT OR IGNORE INTO customer_order_links')){const [user,orderId]=p;links.set(user+'|'+orderId,{user,orderId});return {meta:{changes:1}}}
     throw Error('Unknown .run SQL '+sql);
    },
    async all(){
     if(sql.startsWith('SELECT o.id,o.status,o.total')){const owned=[...links.values()].some(x=>x.user===p[0]&&x.orderId===ORDER);return {results:owned?[{...order,tracking_code:null,carrier:null}]:[]}}
     throw Error('Unknown .all SQL '+sql);
    }
   };return stmt;
  }
 };
}
function request(path,method='GET',data=null,cookie=null,origin=BASE){
 const headers={'accept':'application/json'};
 if(data!==null){headers['content-type']='application/json';if(origin)headers.origin=origin;}
 if(cookie)headers.cookie=cookie;
 return new Request(BASE+path,{method,headers,...(data!==null?{body:JSON.stringify(data)}:{})});
}
test('cadastro real define sessão HttpOnly/Secure e só permite consulta dos próprios pedidos',async()=>{
 const DB=mockedDb(),env={DB,TRACKING_LINK_SECRET:SECRET,STORE_PUBLIC_URL:BASE};
 const signup=await worker.fetch(request('/api/account/register','POST',{
  displayName:'Cliente Teste',email:'cliente@example.com',password:'uma-senha-mais-forte-1234'
 }),env);
 assert.equal(signup.status,200);
 const setCookie=signup.headers.get('set-cookie');
 assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);assert.match(setCookie,/SameSite=Lax/);
 assert.ok(!setCookie.includes('uma-senha'));
 const cookie=setCookie.split(';')[0];
 let response=await worker.fetch(request('/api/account/me','GET',null,cookie),env);
 assert.equal((await response.json()).authenticated,true);
 response=await worker.fetch(request('/api/account/orders','GET',null,cookie),env);
 assert.deepEqual((await response.json()).orders,[]);
 response=await worker.fetch(request('/api/account/orders'),env);
 assert.equal(response.status,401);
 const privateKey=await makeTrackingKey(SECRET,ORDER);
 response=await worker.fetch(request('/api/account/claim','POST',{orderId:ORDER,access:privateKey},cookie),env);
 assert.equal(response.status,200);
 response=await worker.fetch(request('/api/account/orders','GET',null,cookie),env);
 const orders=(await response.json()).orders;
 assert.equal(orders.length,1);
 assert.equal(orders[0].id,'12345678');
 assert.match(orders[0].trackingUrl,/track.html#/);
 assert.equal(orders[0].items[0].title,'Camisa Real Madrid retrô');
 assert.ok(!('email' in orders[0]));
 response=await worker.fetch(request('/api/account/logout','POST',{},cookie),env);
 assert.equal(response.status,200);
 assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
 response=await worker.fetch(request('/api/account/me','GET',null,cookie),env);
 assert.equal((await response.json()).authenticated,false);
});
test('proteção de origem, senha mínima e vínculo secreto inválido',async()=>{
 const DB=mockedDb(),env={DB,TRACKING_LINK_SECRET:SECRET};
 let response=await worker.fetch(request('/api/account/register','POST',{displayName:'Teste',email:'t@example.com',password:'curta'}),env);
 assert.equal(response.status,400);
 response=await worker.fetch(request('/api/account/register','POST',{displayName:'Teste',email:'t@example.com',password:'password-strong-123'},null,'https://outro-site.example'),env);
 assert.equal(response.status,403);
 response=await worker.fetch(request('/api/account/register','POST',{displayName:'Teste',email:'t@example.com',password:'password-strong-123'}),env);
 const cookie=response.headers.get('set-cookie').split(';')[0];
 response=await worker.fetch(request('/api/account/claim','POST',{orderId:ORDER,access:'a'.repeat(64)},cookie),env);
 assert.equal(response.status,403);
 assert.equal(DB.links.size,0);
 response=await worker.fetch(request('/api/account/login','POST',{email:'t@example.com',password:'senha-totalmente-errada'}),env);
 assert.equal(response.status,401);
});
test('cabeçalho, carrossel, criação de conta, pedidos e checkout preservados',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/editorial.css',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const account=readFileSync(new URL('../public/account.html',import.meta.url),'utf8');
 const accountJs=readFileSync(new URL('../public/account.js',import.meta.url),'utf8');
 const schema=readFileSync(new URL('../worker/schema.sql',import.meta.url),'utf8');
 assert.match(html,/id="accountDropdown"/);
 assert.match(html,/Criar conta/);
 assert.match(html,/id="editorialHeroScenes"/);
 assert.match(html,/hero-slider-controls/);
 assert.match(html,/id="productsGrid"/);
 assert.match(html,/id="checkoutForm"/);
 assert.match(css,/#818bd5/i);
 assert.match(css,/editorial-frame/);
 assert.match(app,/renderEditorialHero/);
 assert.doesNotThrow(()=>new Function(app));
 assert.match(account,/id="registerForm"/);
 assert.match(account,/id="ordersList"/);
 assert.match(account,/id="claimForm"/);
 assert.doesNotThrow(()=>new Function(accountJs));
 assert.match(schema,/CREATE TABLE IF NOT EXISTS customer_accounts/);
 assert.match(schema,/CREATE TABLE IF NOT EXISTS customer_order_links/);
});
