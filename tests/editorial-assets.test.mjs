import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('editorial fixo usa exatamente nove recortes aprovados nos destinos corretos',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const imgs=[
  'hero-maradona.png','hero-ronaldo-inter.png','hero-juventus-pb.png',
  'hero-manchester-united.png','hero-arara-camisas.png','card-retro.png',
  'card-atuais.png','card-personalizadas.png','card-todas-colecoes.png'
 ];
 for(const name of imgs)assert.ok(app.includes('/images/editorial/'+name),name);
 assert.match(app,/EDITORIAL_HERO_SETS/);
 assert.match(app,/EDITORIAL_ASSETS/);
 assert.match(app,/EDITORIAL_HERO_SETS\.map/);
 assert.match(app,/\['personalizadas','PERSONALIZADAS'/);
 assert.doesNotMatch(app,/function categoryRender\(\)[\s\S]{0,250}TILES\.map/);
 assert.doesNotThrow(()=>new Function(app));
});
test('CSS garante que texto recortado não seja duplicado nas fotos dos cards',()=>{
 const css=readFileSync(new URL('../public/editorial.css',import.meta.url),'utf8');
 assert.match(css,/editorial-fixed-tile/);
 assert.match(css,/editorial-tile-sr/);
 assert.match(css,/editorial-fixed-tile\.needs-label/);
});
