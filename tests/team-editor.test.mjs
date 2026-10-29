import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {RETAIL_PRICES_BRL,emptySettings,normalizeSettings,applyProductOverride} from '../public/store-settings.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const slice=(begin,end)=>{const a=app.indexOf(begin),b=app.indexOf(end,a);assert.ok(a>=0&&b>a,begin+' not found');return app.slice(a,b)};
const code=[
 slice('const EUROPE=','const BR_CLUBS='),
 slice('const BR_CLUBS=','function renderBrazilClubNavigation(){'),
 slice('const TEAM_NAMES=','// Proteção visual:'),
 slice('function assignTeam(product){','function prepareCatalog(data){'),
 '({findBrazilClub,isBrazilProduct,assignTeam,displayTitle})'
].join('\n');
const rules=vm.runInNewContext(code);
const item=(title,category='outras')=>({id:'YUP-123456',title,supplierTitle:title,category,kind:'fan'});

test('Corinthian de fornecedor vira Corinthians e o clube é identificado',()=>{
 const p=item('Corinthian Home 2026');
 assert.equal(rules.findBrazilClub(p),'corinthians');
 assert.match(rules.displayTitle(p),/^Corinthians/);
 assert.doesNotMatch(rules.displayTitle(p),/^Corinthian /);
 const glued=item('SantosHome 2026');
 assert.equal(rules.findBrazilClub(glued),'santos');
 assert.match(rules.displayTitle(glued),/^Santos 2026/);
});
test('clubes homônimos estrangeiros não entram em Corinthians nem Santos',()=>{
 for(const name of ['Corinthian Casuals Home','Santos Laguna Third']){
  const p=item(name);
  assert.equal(rules.findBrazilClub(p),'',name);
  assert.doesNotMatch(rules.displayTitle(p),/^Corinthians /);
 }
});
test('alteração manual de time domina nomes antigos do fornecedor',()=>{
 const old=item('Corinthian Home 2026');
 const s=emptySettings();s.products[old.id]={team:'brasileirao:santos',category:'brasileirao'};
 const clean=normalizeSettings(s);
 const edited=rules.assignTeam(applyProductOverride(old,clean.products[old.id]));
 assert.equal(edited.brazilClub,'santos');
 assert.equal(edited.europeClub,'');
 assert.equal(rules.isBrazilProduct(edited),true);
 const madrid=rules.assignTeam(applyProductOverride(old,{team:'europa:real-madrid',category:'europa'}));
 assert.equal(madrid.brazilClub,'');
 assert.equal(madrid.europeClub,'real-madrid');
 assert.equal(madrid.europeLeague,'laliga');
 assert.equal(rules.isBrazilProduct(madrid),false);
 const other=rules.assignTeam(applyProductOverride(old,{team:'brasileirao:outros'}));
 assert.equal(other.brazilClub,'');
 assert.equal(rules.isBrazilProduct(other),true);
});
test('o modelo valida a seleção manual do clube antes de publicar',()=>{
 const settings=emptySettings();settings.products['YUP-123456']={team:'brasileirao:corinthians'};
 assert.equal(normalizeSettings(settings).products['YUP-123456'].team,'brasileirao:corinthians');
 settings.products['YUP-123456'].team='europa:<script>';
 assert.throws(()=>normalizeSettings(settings));
});
test('tabela de varejo altera preço quando troca camisa por blusa',()=>{
 assert.equal(RETAIL_PRICES_BRL.fan,159.90);
 assert.equal(RETAIL_PRICES_BRL.blouse,379.80);
 assert.equal(RETAIL_PRICES_BRL.coat,379.80);
 assert.equal(RETAIL_PRICES_BRL.jacket,379.80);
 const editor=readFileSync(new URL('../public/editor.js',import.meta.url),'utf8');
 for(const token of ['setSuggestedPrice(input.value)','id="productTeam"','chosenTeam','onlyUnassigned'])assert.ok(editor.includes(token),token);
});
test('auditoria do catálogo integral: nomes e categorias com indícios de time incorreto',()=>{
 const all=JSON.parse(readFileSync(new URL('../public/catalog.json',import.meta.url),'utf8'));
 assert.ok(all.length>10000,'auditar o catálogo completo, não uma amostra');
 const result={total:all.length,corinthian:0,corinthianCasuals:0,corinthianOutros:0,santos:0,santosCategoriaOutras:0,outrosComClubeBrasileiro:0,exemplos:[]};
 for(const p of all){
  const title=String(p.supplierTitle||p.title||'');
  const club=rules.findBrazilClub(p);
  if(/\bcorinthian\b/i.test(title)){
   if(/\bcorinthian[ -]+casuals\b/i.test(title))result.corinthianCasuals++;else{
    result.corinthian++;
    if(p.category==='outras')result.corinthianOutros++;
   }
  }
  if(/\bsantos\b/i.test(title)&&!/\bsantos laguna\b/i.test(title)){
   result.santos++;
   if(p.category==='outras')result.santosCategoriaOutras++;
  }
  if(p.category==='outras'&&club){
   result.outrosComClubeBrasileiro++;
   if(result.exemplos.length<12)result.exemplos.push({id:p.id,clube:club,titulo:title.slice(0,70)});
  }
 }
 console.log('AUDITORIA_COMPLETA_DE_TIMES: '+JSON.stringify(result));
});
