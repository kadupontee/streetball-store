import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const client=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../worker/index.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

function extract(source,start,end,name){
 const body=source.split(start)[1]?.split(end)[0];
 assert.ok(body, 'Função '+name+' precisa existir');
 return runInNewContext(start+body+'; '+name);
}

const onClient=extract(client,'function playerShortsReprice(p){','function prepareCatalog','playerShortsReprice');
const onServer=extract(server,'function playerShortsRepriceServer(product){','async function catalogFor','playerShortsRepriceServer');

test('calção versão jogador custa R$143,90 na vitrine e no checkout',()=>{
 const existing={id:'TEST-123',title:'Sao Paulo 26-27 Player Shorts',kind:'shorts',price:119.90};
 for(const transform of [onClient,onServer]){
  const adjusted=transform(existing);
  assert.equal(adjusted.kind,'shorts_player');
  assert.equal(adjusted.price,143.90);
 }
 assert.equal(existing.kind,'shorts');
 assert.equal(existing.price,119.90);
 assert.ok(html.includes('<script src="app.js?v=') && html.includes(' defer></script>'), 'A vitrine deve carregar um app.js versionado');
});

test('calção comum continua R$119,90 e camisa jogador não muda',()=>{
 for(const transform of [onClient,onServer]){
  assert.equal(transform({title:'Brasil Calção 2026',kind:'shorts',price:119.90}).price,119.90);
  assert.equal(transform({title:'Real Madrid Player Jersey 26-27',kind:'player_adidas',price:209.90}).price,209.90);
 }
});

test('calção jogador também é reconhecido em português e preços manuais são preservados',()=>{
 for(const transform of [onClient,onServer]){
  assert.equal(transform({title:'Calção versão jogador Brasil',kind:'shorts',price:119.90}).price,143.90);
  assert.equal(transform({title:'Calção versão jogador Brasil',kind:'shorts',price:119.90,priceLocked:true}).price,119.90);
  assert.equal(transform({title:'Player Shorts',kind:'shorts',price:159.90}).price,159.90);
  assert.equal(transform({title:'Player Shorts',kind:'shorts_player',price:143.90}).price,143.90);
 }
});

test('renderização inicial e carrinho usam preços atualizados e a cobrança confere',()=>{
 assert.match(client,/catalog=prepareCatalog\(catalog\);/);
 assert.match(client,/const clean=playerShortsReprice\(retroProduct\(/);
 assert.match(server,/products\.map\(p=>playerShortsRepriceServer\(retroRepriceServer\(p\)\)\)/);
 assert.match(client,/isShort=p.kind==='shorts'\|\|p.kind==='shorts_player'/);
});
