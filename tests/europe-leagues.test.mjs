import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('public/europe-clubs.js','utf8');
const sandbox={window:{}};
vm.runInNewContext(source,sandbox);
const Europe=sandbox.window.STREETBALL_EUROPE;
const sample=(title,category='europa')=>({title,supplierTitle:title,category,image:'/images/yupoo/test.webp'});
const team=(title,category)=>Europe.teamFor(sample(title,category));
test('as 5 ligas da temporada 26/27 e seus clubes existem',()=>{
 assert.deepEqual(Array.from(Europe.leagues,([id])=>id),['premier','laliga','seriea','bundesliga','ligue1']);
 assert.deepEqual(Array.from(Europe.leagues,([,, ,clubs])=>clubs.length),[20,20,20,18,18]);
 assert.equal(new Set(Europe.leagues.flatMap(([id,,,clubs])=>clubs.map(([club])=>id+':'+club))).size,96);
});
test('clubes correspondem a paises e ligas corretos',()=>{
 const cases=[
  ['Arsenal Home','premier','arsenal'],['Manchester City Home','premier','manchester-city'],
  ['Manchester United Home','premier','manchester-united'],['Coventry City Home','premier','coventry'],
  ['Real Madrid Retro','laliga','real-madrid'],['Barcelona Home','laliga','barcelona'],
  ['Atletico Madrid','laliga','atletico'],['Sevilla Home','laliga','sevilla'],
  ['Inter Milan 2026','seriea','inter'],['AC Milan Retro','seriea','milan'],
  ['Juventus Home','seriea','juventus'],['Frosinone Home','seriea','frosinone'],
  ['Bayern Munich Home','bundesliga','bayern'],
  ['Borussia Dortmund Home','bundesliga','dortmund'],
  ['Borussia Monchengladbach Home','bundesliga','gladbach'],
  ['Paris FC Home','ligue1','paris-fc'],['Paris Saint Germain Home','ligue1','psg'],
  ['Paris 2026 Home','ligue1','psg'],['Olympique Marseille 2026','ligue1','marseille'],
  ['SC Braga Away','outros','braga'],['Sporting Braga 2026','outros','braga'],
  ['Benfica Home','outros','benfica'],['Porto Home','outros','porto'],
  ['Ajax Retro','outros','ajax']
 ];
 for(const [name,league,club] of cases){
  const value=team(name);
  assert.equal(value?.league,league,name+' liga');
  assert.equal(value?.club,club,name+' clube');
 }
});
test('sem misturar selecoes, brasileiros ou clubes homonimos',()=>{
 assert.equal(team('Sao Paulo Home','brasileirao'),null);
 assert.equal(team('Germany Bayern training','selecoes'),null);
 assert.equal(team('Arsenal de Sarandi Jersey','retro'),null);
 assert.equal(team('Liverpool Montevideo Jersey','retro'),null);
 assert.equal(team('Inter Miami Home','retro'),null);
 assert.equal(team('Barcelona SC Ecuador','retro'),null);
 assert.equal(team('Newcastle Jets','retro'),null);
 assert.equal(team('Sporting Gijon','retro'),null);
 assert.equal(Europe.isEuropeProduct(sample('Brasil Portugal','selecoes')),false);
});
test('retrôs entram no clube europeu certo e outros nao somem',()=>{
 assert.equal(Europe.leagueFor(sample('Real Madrid 1998 Retro','retro')),'laliga');
 assert.equal(Europe.clubFor(sample('Real Madrid 1998 Retro','retro')),'real-madrid');
 assert.equal(Europe.leagueFor(sample('SC Braga 2019 Retro','retro')),'outros');
 assert.equal(Europe.leagueFor(sample('Clube europeu sem liga encontrada')),'outros');
});
test('navegação da loja tem dois níveis, eventos delegados e estilos mobile',()=>{
 const html=fs.readFileSync('public/index.html','utf8');
 const app=fs.readFileSync('public/app.js','utf8');
 const css=fs.readFileSync('public/styles.css','utf8');
 for(const id of ['europeLeagues','europeLeagueGrid','europeClubSection','europeClubGrid','europeClubHeading'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html, /<script src="app\.js\?v=/, 'o navegador carrega o app principal');
 assert.ok(!html.includes('europe-clubs.js'), 'uma única requisição JS para a navegação');
 const begin=app.indexOf('const EUROPE='); const end=app.indexOf('const BR_CLUBS=',begin);
 assert.ok(begin>=0&&end>begin,'a lista de ligas deve estar incluída no app.js');
 const InlineEurope=vm.runInNewContext(app.slice(begin,end)+'\nEUROPE');
 assert.deepEqual(Array.from(InlineEurope.leagues,([id])=>id),['premier','laliga','seriea','bundesliga','ligue1']);
 assert.deepEqual(JSON.parse(JSON.stringify(InlineEurope.leagues)), JSON.parse(JSON.stringify(Europe.leagues)),'o app deve ter todos os clubes definidos');
 for(const token of ['renderEuropeNavigation()','selectEuropeLeague(','selectEuropeClub(','state.europeLeague','state.europeClub','data-euro-league','data-euro-club','europeLeagueFor(p)'])assert.ok(app.includes(token),'faltou '+token);
 assert.ok(css.includes('@media(max-width:510px)')&&css.includes('.europe-league-grid'));
});
test('catálogo real é classificado nas cinco ligas',()=>{
 const catalog=JSON.parse(fs.readFileSync('public/catalog.json','utf8'));
 assert.ok(catalog.length>10000,'não usar catálogo reduzido');
 const counts=Object.fromEntries(Europe.leagues.map(([id])=>[id,0]));
 for(const p of catalog){
  const league=Europe.leagueFor(p);
  if(Object.hasOwn(counts,league))counts[league]++;
 }
 for(const [league,total] of Object.entries(counts)) assert.ok(total>5,league+' sem produtos identificados');
});
