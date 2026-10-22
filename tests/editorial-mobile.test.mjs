import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base=new URL('../public/',import.meta.url);
const css=readFileSync(new URL('editorial.css',base),'utf8');
const app=readFileSync(new URL('app.js',base),'utf8');
const html=readFileSync(new URL('index.html',base),'utf8');
test('celular usa arte completa com opacidade 1 em vez de fundo apagado',()=>{
 assert.match(css,/Streetball Mobile Editorial V2/);
 const mobile=css.split('Streetball Mobile Editorial V2')[1];
 assert.match(mobile,/@media \(max-width:890px\)/);
 assert.match(mobile,/\.hero-art\s*\{[^}]*opacity:1/s);
 assert.match(mobile,/\.hero-art\s*\{[^}]*position:relative/s);
 assert.match(mobile,/@media \(max-width:600px\)/);
 assert.match(mobile,/\.hero-art\s*\{[^}]*opacity:1/s);
});
test('cards no celular ocupam toda largura mantendo imagens e texto original',()=>{
 const mobile=css.split('Streetball Mobile Editorial V2')[1];
 assert.match(mobile,/\.category-grid\s*\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(mobile,/\.category-tile\.editorial-fixed-tile\s*\{[^}]*aspect-ratio:1\.39/);
 assert.match(mobile,/\.category-tile\.editorial-fixed-tile \.category-photo\s*\{[^}]*object-fit:cover/s);
});
test('desktop e celular usam as nove fotos aprovadas, com navegação do carrossel',()=>{
 for(const img of ['hero-maradona.png','hero-ronaldo-inter.png','hero-juventus-pb.png',
 'hero-manchester-united.png','hero-arara-camisas.png','card-retro.png',
 'card-atuais.png','card-personalizadas.png','card-todas-colecoes.png']){
  assert.ok(app.includes('/images/editorial/'+img),img);
 }
 assert.match(html,/id="heroSliderControls"/);
 assert.match(html,/20261022-mobile-v3/);
 assert.doesNotThrow(()=>new Function(app));
});
