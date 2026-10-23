import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const names=['hero-maradona.png','hero-ronaldo-inter.png','hero-juventus-pb.png',
 'hero-manchester-united.png','hero-arara-camisas.png',
 'card-retro.png','card-atuais.png','card-personalizadas.png','card-todas-colecoes.png'];

test('se imagem da Cloudflare falhar, tenta os mesmos PNGs originais via GitHub e jsDelivr',()=>{
 assert.match(app,/editorialLocalSource/);
 assert.match(app,/EDITORIAL_ASSET_COMMIT/);
 assert.match(app,/raw\.githubusercontent\.com\/kadupontee\/streetball-store/);
 assert.match(app,/cdn\.jsdelivr\.net\/gh\/kadupontee\/streetball-store/);
 assert.match(app,/img\.dataset\.editorialSource='github'/);
 assert.match(app,/img\.dataset\.editorialSource='cdn'/);
 assert.match(app,/Object\.values\(EDITORIAL_ASSETS\)\.includes\(path\)/);
 assert.doesNotMatch(app,/editorialFallback|data-editorial-fallback/);
 assert.doesNotThrow(()=>new Function(app));
 for(const name of names)assert.ok(app.includes('/images/editorial/'+name),name);
 assert.match(html,/app\.js\?v=20261022-coat-blouse-v12/);
});
test('os nove PNGs publicados no GitHub existem e têm cabeçalho PNG válido',()=>{
 for(const filename of names){
  const png=readFileSync(new URL('../public/images/editorial/'+filename,import.meta.url));
  assert.ok(png.length>1024,filename+' está vazio');
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a',filename+' não é PNG');
  assert.equal(png.subarray(12,16).toString('ascii'),'IHDR',filename+' sem IHDR');
  assert.ok(png.readUInt32BE(16)>30,filename+' largura inválida');
  assert.ok(png.readUInt32BE(20)>30,filename+' altura inválida');
 }
});
test('diagnóstico de mídia distingue imagem real de página HTML de erro',async()=>{
 const requests=[];
 const env={ASSETS:{fetch:async req=>{
  const u=new URL(req.url);
  requests.push(u.pathname);
  return new Response('example PNG',{status:200,headers:{'content-type':'image/png'}});
 }}};
 const req=new Request('https://streetball-store.kpgmer.workers.dev/api/health/editorial');
 const response=await worker.fetch(req,env);
 assert.equal(response.status,200);
 const info=await response.json();
 assert.equal(info.ok,true);
 assert.equal(info.available,9);
 assert.equal(info.total,9);
 assert.equal(requests.length,9);
 assert.ok(requests.every(x=>x.startsWith('/images/editorial/')));
});
test('diagnóstico não marca como imagem um HTML 200 do Cloudflare',async()=>{
 const env={ASSETS:{fetch:async req=>new Response('<html>not found</html>',{status:200,headers:{'content-type':'text/html'}})}};
 const response=await worker.fetch(new Request('https://streetball-store.kpgmer.workers.dev/api/health/editorial'),env);
 const info=await response.json();
 assert.equal(info.ok,false);
 assert.equal(info.available,0);
});
