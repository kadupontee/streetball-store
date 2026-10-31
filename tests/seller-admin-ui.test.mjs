import {sellerCoupon,attachSeller} from '../worker/seller-sales.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {JSDOM,VirtualConsole} from 'jsdom';
import worker from '../worker/index.js';

const page=readFileSync(new URL('../public/ops/index.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../public/seller-admin.js',import.meta.url),'utf8');
const referralScript=readFileSync(new URL('../public/seller-referral.js',import.meta.url),'utf8');
const opsScript=readFileSync(new URL('../public/ops/sales.js',import.meta.url),'utf8');
const base='https://store.example.invalid';
function database(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(readFileSync(new URL('../worker/schema.sql',import.meta.url),'utf8'));
 sql.prepare("INSERT INTO customer_accounts(id,email,display_name,password_salt,password_hash,created_at) VALUES('seller-account','seller@example.invalid','Seller','fake','fake','x')").run();
 const DB={prepare(query){let args=[];return {bind(...values){args=values;return this},async first(){return sql.prepare(query).get(...args)||null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){if(/^\s*(SELECT|PRAGMA)\b/i.test(query))return {results:sql.prepare(query).all(...args)};return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}}}}},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results}catch(error){sql.exec('ROLLBACK');throw error}}};
 return {sql,env:{DB,ADMIN_TOKEN:'unit-test-only'}};
}
async function until(check){for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5))}assert.fail('UI condition did not complete');}
async function setup(t,env,options={}){
 const errors=[],requests=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error));
 const dom=new JSDOM(page,{url:base+'/ops/?tab=vendedores',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});t.after(()=>dom.window.close());
 let cookie='';if(options.fullOps){const session=await worker.fetch(new Request(base+'/api/admin/sales/session',{method:'POST',headers:{authorization:'Bearer unit-test-only',origin:base,'content-type':'application/json'},body:'{}'}),env);assert.equal(session.status,200);cookie=session.headers.get('set-cookie').split(';')[0];}
 const {window}=dom,document=window.document;window.matchMedia=()=>({matches:false});window.AbortSignal=globalThis.AbortSignal;window.HTMLElement.prototype.scrollIntoView=function(){};window.confirm=()=>true;
 window.fetch=async(path,config={})=>{
  requests.push({path,...config});
  if(options.failList?.()&&path==='/api/admin/sales/sellers')throw Error('Conexão interrompida');
  const headers=new Headers(config.headers);headers.set('authorization','Bearer unit-test-only');headers.set('origin',base);if(cookie)headers.set('cookie',cookie);
  const response=await worker.fetch(new Request(new URL(path,base),{method:config.method||'GET',headers,...(config.body?{body:config.body}:{})}),env);
  if(path.endsWith('/save')&&response.ok)options.saved?.();return response;
 };
 window.eval(referralScript);window.eval(script);if(options.fullOps)window.eval(opsScript);else{document.getElementById('app').hidden=false;document.getElementById('nav').hidden=false;document.dispatchEvent(new window.Event('streetball:ops-ready'));}
 await until(()=>document.getElementById('sellerList'));
 return {window,document,requests,errors,click:selector=>{const el=document.querySelector(selector);assert.ok(el,selector);el.click()}};
}
function fill(ui,values={}){
 const form=ui.document.getElementById('sellerEdit');assert.ok(form);
 const data={nickname:'Nick Teste',email:'seller@example.invalid',coupon:'SEM-VENDAS',commissionPercent:'25',...values};
 for(const [key,value] of Object.entries(data))form.elements.namedItem(key).value=value;
 form.elements.namedItem('active').checked=true;return form;
}
function submit(ui,form){const event=new ui.window.Event('submit',{bubbles:true,cancelable:true});form.dispatchEvent(event);assert.ok(event.defaultPrevented,'The browser must not navigate away with a native GET form submission');}

test('owner form saves to the real worker and reload shows a zero-sale seller, including a shadowed form.id',async t=>{
 const{sql,env}=database(t),ui=await setup(t,env);
 ui.click('[data-new]');const form=fill(ui);
 assert.equal(form.elements.namedItem('id'),null,'Control names must not shadow form identity');
 // jsdom lacks HTMLFormElement LegacyOverrideBuiltIns. Model the browser property collision explicitly.
 Object.defineProperty(form,'id',{value:form.elements.namedItem('sellerId')});
 submit(ui,form);await until(()=>ui.document.querySelector('[data-seller-card]'));
 const row=sql.prepare('SELECT * FROM sales_sellers').get();assert.equal(row.nickname,'Nick Teste');assert.equal(row.commission_bps,2500);
 assert.equal(ui.document.querySelectorAll('[data-seller-card]').length,1);
 assert.match(ui.document.querySelector('[data-seller-card]').textContent,/Ainda sem vendas/);
 assert.match(ui.document.getElementById('sellerNotice').textContent,/salvo e disponível/);
 assert.ok(ui.requests.some(r=>r.path.endsWith('/save')&&JSON.parse(r.body).id===''));
 assert.ok(!ui.document.getElementById('sellerEdit'));
 const fresh=await setup(t,env);assert.equal(fresh.document.querySelectorAll('[data-seller-card]').length,1);
 assert.match(fresh.document.querySelector('[data-seller-card]').textContent,/Nick Teste/);
 assert.deepEqual(ui.errors,[]);assert.deepEqual(fresh.errors,[]);
});
test('missing customer account returns an inline error without discarding the entered data or announcing success',async t=>{
 const{sql,env}=database(t),ui=await setup(t,env);ui.click('[data-new]');const form=fill(ui,{email:'missing@example.invalid'});submit(ui,form);
 await until(()=>ui.document.getElementById('sellerSaveStatus').textContent.includes('precisa criar sua conta'));
 assert.equal(sql.prepare('SELECT count(*) AS n FROM sales_sellers').get().n,0);
 assert.equal(ui.document.getElementById('sellerEdit').elements.namedItem('email').value,'missing@example.invalid');
 assert.equal(ui.document.getElementById('sellerNotice').getAttribute('role'),'alert');
 assert.deepEqual(ui.errors,[]);
});
test('editing updates the existing seller and deletion revokes the coupon; the owner can restore the record',async t=>{
 const{sql,env}=database(t),ui=await setup(t,env);ui.click('[data-new]');submit(ui,fill(ui));await until(()=>ui.document.querySelector('[data-seller-card]'));
 const id=sql.prepare('SELECT id FROM sales_sellers').get().id;
 ui.click('[data-edit]');const form=fill(ui,{nickname:'Nome atualizado',coupon:'NOVO',commissionPercent:'20.15'});assert.equal(form.elements.namedItem('sellerId').value,id);submit(ui,form);
 await until(()=>ui.document.querySelector('[data-seller-card]')?.textContent.includes('Nome atualizado'));
 assert.equal(sql.prepare('SELECT count(*) AS n FROM sales_sellers').get().n,1);assert.equal(sql.prepare('SELECT commission_bps FROM sales_sellers').get().commission_bps,2015);
 ui.click('[data-delete]');await until(()=>ui.document.querySelectorAll('[data-seller-card]').length===0);
 assert.equal(sql.prepare('SELECT active FROM sales_sellers').get().active,0);
 const checkbox=ui.document.getElementById('showArchived');checkbox.checked=true;checkbox.dispatchEvent(new ui.window.Event('change',{bubbles:true}));
 assert.equal(ui.document.querySelectorAll('[data-seller-card]').length,1);ui.click('[data-edit]');submit(ui,fill(ui,{nickname:'Restaurado',coupon:'NOVO',commissionPercent:'20'}));
 await until(()=>ui.document.querySelector('[data-seller-card]')?.textContent.includes('Restaurado'));
 assert.equal(sql.prepare('SELECT active FROM sales_sellers').get().active,1);assert.equal(sql.prepare('SELECT deleted_at FROM sales_sellers').get().deleted_at,null);
 assert.deepEqual(ui.errors,[]);
});
test('a list refresh failure after saving is distinguished from a failed save and retry recovers the stored seller',async t=>{
 const{sql,env}=database(t);let fail=false;
 const ui=await setup(t,env,{failList:()=>fail,saved:()=>{fail=true}});ui.click('[data-new]');submit(ui,fill(ui));
 await until(()=>ui.document.getElementById('sellerNotice').textContent.includes('Cadastro salvo. Não foi possível atualizar'));
 assert.equal(sql.prepare('SELECT count(*) AS n FROM sales_sellers').get().n,1);assert.equal(ui.document.getElementById('sellerEdit'),null);
 fail=false;ui.click('[data-reload]');await until(()=>ui.document.querySelector('[data-seller-card]'));
 assert.equal(ui.document.querySelectorAll('[data-seller-card]').length,1);assert.deepEqual(ui.errors,[]);
});

test('full owner page restores the sellers tab on reload and notifications do not cover it',async t=>{
 const{env}=database(t),ui=await setup(t,env,{fullOps:true});
 await until(()=>ui.requests.some(r=>r.path.endsWith('/notifications')));
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(ui.document.getElementById('notificationSettings').hidden,true);
 assert.equal(ui.document.getElementById('sellersPanel').hidden,false);
 assert.equal(new URL(ui.window.location.href).searchParams.get('tab'),'vendedores');
 ui.click('#settings');assert.equal(ui.document.getElementById('sellersPanel').hidden,true);assert.equal(ui.document.getElementById('notificationSettings').hidden,false);
 ui.click('#sellersToggle');await until(()=>ui.document.getElementById('sellerList'));
 assert.equal(ui.document.getElementById('notificationSettings').hidden,true);
 assert.deepEqual(ui.errors,[]);
});

test('opening each order shows the seller coupon, while a direct sale has an explicit no-coupon state',async t=>{
 const{sql,env}=database(t),ui=await setup(t,env,{fullOps:true});
 ui.click('[data-new]');submit(ui,fill(ui));await until(()=>ui.document.querySelector('[data-seller-card]'));
 const insert=sql.prepare("INSERT INTO orders(id,created_at,updated_at,status,name,email,phone,cpf,zip,address,city,state,items_json,subtotal,shipping,total) VALUES(?,'2026-10-28T12:00:00Z','2026-10-28T12:00:00Z','awaiting_payment','Cliente','customer@example.invalid','11999999999','00000000000','00000000','Rua exemplo','São Paulo','SP','[]',180.4,0,180.4)");
 const couponOrder='11111111-1111-4111-8111-111111111111',directOrder='22222222-2222-4222-8222-222222222222';insert.run(couponOrder);insert.run(directOrder);
 await attachSeller(env,couponOrder,await sellerCoupon(env,'SEM-VENDAS',189.9));
 ui.click('#home');await until(()=>ui.document.querySelector('[data-order]'));
 ui.click('[data-order="'+couponOrder+'"]');await until(()=>ui.document.querySelector('.sale-origin'));
 let origin=ui.document.querySelector('.sale-origin');assert.match(origin.textContent,/Vendedor: Nick Teste/);assert.match(origin.textContent,/Cupom SEM-VENDAS/);assert.match(origin.textContent,/25%/);assert.match(origin.textContent,/45,10/);
 ui.click('[data-back]');await until(()=>ui.document.querySelector('[data-order]'));ui.click('[data-order="'+directOrder+'"]');await until(()=>ui.document.querySelector('.sale-origin'));
 origin=ui.document.querySelector('.sale-origin');assert.match(origin.textContent,/Sem cupom de vendedor registrado/);assert.equal(origin.querySelector('.sale-coupon'),null);assert.deepEqual(ui.errors,[]);
});

test('cada vendedor ativo recebe seu link e consegue copiá-lo no painel',async t=>{
 const {env}=database(t),ui=await setup(t,env);
 ui.click('[data-new]');submit(ui,fill(ui));await until(()=>ui.document.querySelector('[data-seller-card]'));
 const input=ui.document.querySelector('.seller-share-actions input');
 assert.equal(input?.value,'https://lojastreetball.com.br/?cupom=SEM-VENDAS');
 let copied='';
 Object.defineProperty(ui.window.navigator,'clipboard',{configurable:true,value:{writeText:async value=>{copied=value;}}});
 ui.click('[data-copy-coupon]');
 await until(()=>ui.document.getElementById('sellerNotice').textContent.includes('Link exclusivo copiado'));
 assert.equal(copied,input.value);
 ui.click('[data-delete]');
 await until(()=>ui.document.querySelectorAll('[data-seller-card]').length===0);
 ui.document.getElementById('showArchived').click();
 const removed=ui.document.querySelector('[data-seller-card]');
 assert.ok(removed,'deleted seller remains in archived history');
 assert.equal(removed.querySelector('.seller-share'),null,'archived seller cannot promote revoked coupon');
});
