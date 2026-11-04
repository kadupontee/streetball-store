import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertAssetVersion} from './support/asset-version.mjs';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/editorial.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

test('desktop e celular carregam os mesmos nove arquivos editoriais aprovados',()=>{
 const assets=['hero-maradona.png','hero-ronaldo-inter.png','hero-juventus-pb.png',
  'hero-manchester-united.png','hero-arara-camisas.png','card-retro.png',
  'card-atuais.png','card-personalizadas.png','card-todas-colecoes.png'];
 for(const a of assets)assert.match(app,new RegExp('\\/images\\/editorial\\/'+a.replaceAll('.','\\.')));
 assert.match(app,/EDITORIAL_HERO_SETS\.map/);
 assert.match(app,/EDITORIAL_ASSETS/);
 assert.doesNotMatch(app,/data-editorial-fallback/);
 assert.doesNotMatch(app,/function editorialFallback\(/);
 assert.match(css,/Mobile V3/);
 assert.match(css,/object-fit:contain/);
});
test('botão Escolher opções usa uma seta SVG idêntica no desktop e no iPhone',()=>{
 assert.match(app,/<button class="quick-btn"[^>]*><span>ESCOLHER OPÇÕES<\/span><svg class="quick-btn-arrow"/);
 assert.doesNotMatch(app,/ESCOLHER OPÇÕES ↗/);
 assert.match(css,/\.quick-btn \.quick-btn-arrow/);
 assert.match(css,/@media \(max-width:600px\)/);
});
test('o navegador é forçado a obter os arquivos atualizados',()=>{
 assertAssetVersion(html,'editorial.css');
 assertAssetVersion(html,'app.js');
 assert.doesNotThrow(()=>new Function(app));
});

