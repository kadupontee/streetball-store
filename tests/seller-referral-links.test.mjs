import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script=readFileSync(new URL('../public/seller-referral.js',import.meta.url),'utf8');
function referral(){
 const context={URL,Date,encodeURIComponent};
 runInNewContext(script,context);
 return context.StreetballSellerLinks;
}
function storage(){
 const map=new Map();
 return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};
}
test('cada cupom gera link individual no dominio oficial',()=>{
 const tools=referral();
 assert.equal(tools.shareUrl('kadu_10'),'https://lojastreetball.com.br/?cupom=KADU_10');
 assert.equal(tools.shareUrl('DANIEL-5'),'https://lojastreetball.com.br/?cupom=DANIEL-5');
 assert.equal(tools.shareUrl('foo?admin=1'),'');
 assert.equal(tools.shareUrl(''),'');
});
test('link aceita codigo de vendedor mas rejeita cupom invalido',()=>{
 const tools=referral();
 const good=tools.codeFromUrl('https://lojastreetball.com.br/?cupom=Bruno10#colecao');
 assert.equal(good.present,true);assert.equal(good.code,'BRUNO10');
 const other=tools.codeFromUrl('https://lojastreetball.com.br/?ordenar=preco');
 assert.equal(other.present,false);
 const bad=tools.codeFromUrl('https://lojastreetball.com.br/?cupom=CODE%3Cscript%3E');
 assert.equal(bad.present,true);assert.equal(bad.code,'');
});
test('cupom valido permanece por 30 dias e expira',()=>{
 const tools=referral(),store=storage(),start=100000000;
 assert.equal(tools.remember(store,'nick',start),true);
 assert.equal(tools.getSaved(store,start+60*1000),'NICK');
 assert.equal(tools.getSaved(store,start+30*24*60*60*1000+1),'');
 assert.equal(tools.getSaved(store,start+2),'');
 assert.equal(tools.remember(store,'invalid&',start),false);
});
test('sem armazenamento disponivel o link continua tratavel',()=>{
 const tools=referral(),noStorage={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};
 assert.equal(tools.remember(noStorage,'BRUNO'),false);
 assert.equal(tools.getSaved(noStorage),'');
 assert.equal(tools.codeFromUrl('https://lojastreetball.com.br/?cupom=BRUNO').code,'BRUNO');
});
test('vitrine aguarda validacao e envia cupom no checkout; painel tem copiar',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const admin=readFileSync(new URL('../public/seller-admin.js',import.meta.url),'utf8');
 const seller=readFileSync(new URL('../public/seller-dashboard.js',import.meta.url),'utf8');
 assert.match(app,/loadSellerCouponFromLink\(\)/);
 assert.match(app,/await pendingSellerValidation/);
 assert.match(app,/body:JSON\.stringify\(\{coupon:valid\}\)/);
 assert.match(app,/coupon:appliedSellerCoupon\|\|undefined/);
 assert.match(admin,/data-copy-coupon/);
 assert.match(seller,/copySellerShareLink/);
});
