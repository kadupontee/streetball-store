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
test('os quatro cards exibem as imagens inteiras com a proporção original',()=>{
 const cards=css.split('Cards editoriais V5:')[1];
 assert.ok(cards,'Falta política atual dos recortes');
 for(const [type,w] of [['retro',240],['europa',252],['personalizadas',305],['todos',295]]){
  assert.ok(cards.includes('data-category="'+type+'"]{--editorial-aspect:'+w+' / 193}'),type);
 }
 assert.match(cards,/aspect-ratio:var\(--editorial-aspect\)/);
 assert.match(cards,/position:static/);
 assert.match(cards,/object-fit:contain/);
 assert.doesNotMatch(cards,/object-fit:cover/);
 assert.match(cards,/@media\(max-width:600px\)/);
 assert.match(cards,/grid-template-columns:minmax\(0,1fr\)/);
});
test('desktop e celular usam as nove fotos aprovadas, com navegação do carrossel',()=>{
 for(const img of ['hero-maradona.png','hero-ronaldo-inter.png','hero-juventus-pb.png',
 'hero-manchester-united.png','hero-arara-camisas.png','card-retro.png',
 'card-atuais.png','card-personalizadas.png','card-todas-colecoes.png']){
  assert.ok(app.includes('/images/editorial/'+img),img);
 }
 assert.match(html,/id="heroSliderControls"/);
 assert.match(html,/20261022-new-cards-unified-v7/);
 assert.doesNotThrow(()=>new Function(app));
});


test('iPhone e Android exibem imagens completas, sem height fixo nem crop',()=>{
 const mobile=css.split('Mobile Collections V6:')[1];
 assert.ok(mobile,'Falta o ajuste específico para celulares');
 assert.match(mobile,/@media \(max-width: 780px\)/);
 assert.match(mobile,/#categoryGrid\.category-grid/);
 assert.match(mobile,/grid-template-columns:\s*minmax\(0, 1fr\)/);
 assert.match(mobile,/height:\s*auto/);
 assert.match(mobile,/aspect-ratio:\s*auto/);
 assert.match(mobile,/object-fit:\s*contain/);
 assert.match(mobile,/position:\s*relative/);
 assert.doesNotMatch(mobile,/object-fit:\s*cover/);
 for(const [name,width] of [['retro',240],['europa',252],['personalizadas',305],['todos',295]]){
  assert.ok(app.includes("['"+name+"'"),name);
  assert.ok(app.includes("EDITORIAL_ASSETS."+(name==='europa'?'atuais':name==='todos'?'colecoes':name)+",960]"),name+' dimensões');
 }
 assert.match(app,/width="'\+imageWidth\+'" height="557"/);
 assert.match(html,/editorial\.css\?v=20261022-new-cards-unified-v7/);
 assert.match(html,/app\.js\?v=20261022-new-cards-unified-v7/);
});
