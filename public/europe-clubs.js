/* Navegacao europeia da Streetball Store. Clubes da temporada 2026/27.
   Times fora das cinco ligas vao para "Demais clubes europeus", inclusive retro. */
(() => {
'use strict';
const leagues=[
 ['premier','Premier League','Inglaterra',[
  ['arsenal','Arsenal',['arsenal']],['aston-villa','Aston Villa',['aston villa']],
  ['bournemouth','Bournemouth',['bournemouth']],['brentford','Brentford',['brentford']],
  ['brighton','Brighton',['brighton','brighton hove']],['chelsea','Chelsea',['chelsea']],
  ['coventry','Coventry City',['coventry']],['crystal-palace','Crystal Palace',['crystal palace']],
  ['everton','Everton',['everton']],['fulham','Fulham',['fulham']],
  ['hull','Hull City',['hull city','hull']],['ipswich','Ipswich Town',['ipswich']],
  ['leeds','Leeds United',['leeds united','leeds']],['liverpool','Liverpool',['liverpool']],
  ['manchester-city','Manchester City',['manchester city','man city','mancity']],
  ['manchester-united','Manchester United',['manchester united','man united','man utd','manutd']],
  ['newcastle','Newcastle United',['newcastle united','newcastle']],
  ['nottingham','Nottingham Forest',['nottingham forest','nott forest','nottingham']],
  ['sunderland','Sunderland',['sunderland']],['tottenham','Tottenham',['tottenham','spurs']]
 ]],
 ['laliga','La Liga','Espanha',[
  ['alaves','Alavés',['deportivo alaves','alaves']],
  ['athletic','Athletic Bilbao',['athletic bilbao','athletic club']],
  ['atletico','Atlético de Madrid',['atletico madrid','atletico de madrid','atleti']],
  ['barcelona','Barcelona',['barcelona','fc barcelona','barca']],
  ['betis','Real Betis',['real betis','betis']],
  ['celta','Celta de Vigo',['celta de vigo','celta vigo','celta']],
  ['deportivo','Deportivo La Coruña',['deportivo la coruna','deportivo coruna','rc deportivo']],
  ['elche','Elche',['elche']],
  ['espanyol','Espanyol',['espanyol']],
  ['getafe','Getafe',['getafe']],
  ['levante','Levante',['levante']],
  ['malaga','Málaga',['malaga']],
  ['osasuna','Osasuna',['osasuna']],
  ['racing','Racing Santander',['racing santander','racing club santander']],
  ['rayo','Rayo Vallecano',['rayo vallecano','rayo']],
  ['real-madrid','Real Madrid',['real madrid']],
  ['real-sociedad','Real Sociedad',['real sociedad']],
  ['sevilla','Sevilla',['sevilla','seville']],
  ['valencia','Valencia',['valencia']],
  ['villarreal','Villarreal',['villarreal']]
 ]],
 ['seriea','Serie A','Itália',[
  ['atalanta','Atalanta',['atalanta']],['bologna','Bologna',['bologna']],
  ['cagliari','Cagliari',['cagliari']],['como','Como',['como 1907','como']],
  ['fiorentina','Fiorentina',['fiorentina']],['frosinone','Frosinone',['frosinone']],
  ['genoa','Genoa',['genoa']],['inter','Inter de Milão',['inter milan','internazionale','inter']],
  ['juventus','Juventus',['juventus','juve']],
  ['lazio','Lazio',['lazio']],['lecce','Lecce',['lecce']],
  ['milan','Milan',['ac milan','a c milan','milan']],
  ['monza','Monza',['monza']],['napoli','Napoli',['napoli','naples']],
  ['parma','Parma',['parma']],['roma','Roma',['as roma','roma']],
  ['sassuolo','Sassuolo',['sassuolo']],['torino','Torino',['torino']],
  ['udinese','Udinese',['udinese']],['venezia','Venezia',['venezia','venice fc']]
 ]],
 ['bundesliga','Bundesliga','Alemanha',[
  ['augsburg','Augsburg',['augsburg']],
  ['bayern','Bayern de Munique',['bayern munich','bayern munchen','bayern muenchen','bayern']],
  ['dortmund','Borussia Dortmund',['borussia dortmund','dortmund','bvb']],
  ['gladbach','Borussia Mönchengladbach',['borussia monchengladbach','monchengladbach','m gladbach','gladbach']],
  ['elversberg','Elversberg',['elversberg']],['frankfurt','Eintracht Frankfurt',['eintracht frankfurt','frankfurt']],
  ['freiburg','Freiburg',['freiburg']],['hamburg','Hamburgo',['hamburger sv','hamburg','hsv']],
  ['hoffenheim','Hoffenheim',['hoffenheim']],['koln','Colônia',['fc koln','koln','cologne']],
  ['leverkusen','Bayer Leverkusen',['bayer leverkusen','leverkusen']],
  ['leipzig','RB Leipzig',['rb leipzig','leipzig']],
  ['mainz','Mainz',['mainz']],['paderborn','Paderborn',['paderborn']],
  ['schalke','Schalke 04',['schalke']],['stuttgart','Stuttgart',['stuttgart']],
  ['union-berlin','Union Berlin',['union berlin']],['werder','Werder Bremen',['werder bremen','bremen']]
 ]],
 ['ligue1','Ligue 1','França',[
  ['angers','Angers',['angers']],['auxerre','Auxerre',['auxerre']],
  ['brest','Brest',['stade brestois','brest']],['le-havre','Le Havre',['le havre','havre ac']],
  ['le-mans','Le Mans',['le mans']],['lens','Lens',['rc lens','lens']],
  ['lille','Lille',['lille','losc']],['lorient','Lorient',['lorient']],
  ['lyon','Lyon',['olympique lyonnais','ol lyon','lyon']],
  ['marseille','Olympique de Marseille',['olympique marseille','marseille','om marseille']],
  ['monaco','Monaco',['as monaco','monaco']],
  ['nice','Nice',['ogc nice','nice']],
  ['paris-fc','Paris FC',['paris fc','paris football club']],
  ['psg','Paris Saint-Germain',['paris saint germain','paris st germain','paris s g','psg','paris']],
  ['rennes','Rennes',['stade rennais','rennes']],
  ['strasbourg','Strasbourg',['strasbourg']],
  ['toulouse','Toulouse',['toulouse']],['troyes','Troyes',['troyes']]
 ]]
];
const otherClubs=[
 ['benfica','Benfica',['benfica']],['porto','FC Porto',['fc porto','porto']],
 ['sporting','Sporting CP',['sporting cp','sporting lisbon','sporting portugal','sporting']],
 ['braga','SC Braga',['sc braga','sporting braga','braga']],
 ['ajax','Ajax',['ajax']],['psv','PSV Eindhoven',['psv','eindhoven']],
 ['feyenoord','Feyenoord',['feyenoord']],['az-alkmaar','AZ Alkmaar',['az alkmaar']],
 ['celtic','Celtic',['celtic']],['rangers','Rangers',['glasgow rangers','rangers']],
 ['galatasaray','Galatasaray',['galatasaray']],
 ['fenerbahce','Fenerbahçe',['fenerbahce','fenerbahce sk']],
 ['besiktas','Beşiktaş',['besiktas']],
 ['anderlecht','Anderlecht',['anderlecht']],
 ['club-brugge','Club Brugge',['club brugge','brugge']],
 ['salzburg','RB Salzburg',['red bull salzburg','rb salzburg','salzburg']],
 ['shakhtar','Shakhtar Donetsk',['shakhtar donetsk','shakhtar']],
 ['dynamo-kyiv','Dynamo Kyiv',['dynamo kyiv','dynamo kiev']],
 ['olympiacos','Olympiacos',['olympiacos','olympiakos']],
 ['panathinaikos','Panathinaikos',['panathinaikos']],
 ['copenhagen','Copenhagen',['fc copenhagen','copenhagen','kobenhavn']]
];
const normalize = text => String(text||'')
 .replace(/([a-zà-ÿ])([A-Z])/g,'$1 $2')
 .replace(/(madrid|barcelona|arsenal|chelsea|liverpool|juventus|bayern|psg|benfica|porto|braga|ajax|roma)(home|away|third|retro|training|long|player)/gi,'$1 $2')
 .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 .replace(/[^a-z0-9]+/g,' ').trim();
const EXCLUDED_CATEGORIES = new Set(['selecoes','brasileirao','nba']);
const allTeams = [...leagues.flatMap(([league,, ,clubs]) => clubs.map(([id,label,aliases]) => ({league,id,label,aliases}))),
 ...otherClubs.map(([id,label,aliases])=>({league:'outros',id,label,aliases}))];
function teamFor(product){
 if (!product || EXCLUDED_CATEGORIES.has(product.category))return null;
 const name=normalize(product.supplierTitle||product.title);
 if(!name)return null;
 const padded=' '+name+' ';
 for(const team of allTeams){
   if(team.id==='milan' && /\binter milan\b/.test(name))continue;
   if(team.id==='inter' && /\binter (?:miami|turku|porto alegre)\b/.test(name))continue;
   if(team.id==='psg' && /\bparis (?:fc|football club)\b/.test(name))continue;
   if(team.id==='arsenal' && /\barsenal (?:de )?sarandi\b/.test(name))continue;
   if(team.id==='liverpool' && /\bliverpool (?:montevideo|uruguay)\b/.test(name))continue;
   if(team.id==='newcastle' && /\bnewcastle jets\b/.test(name))continue;
   if(team.id==='sporting' && /\bsporting (?:braga|gijon|kc|kansas city)\b/.test(name))continue;
   if(team.id==='barcelona' && /\bbarcelona (?:sc|ecuador|guayaquil)\b/.test(name))continue;
   if(team.aliases.some(alias=>padded.includes(' '+alias+' ')))return {league:team.league,club:team.id,label:team.label};
 }
 return null;
}
function isEuropeProduct(p){
 if(!p || EXCLUDED_CATEGORIES.has(p.category))return false;
 return p.category==='europa'||Boolean(teamFor(p));
}
function leagueFor(p){
 if(!isEuropeProduct(p))return '';
 return teamFor(p)?.league||'outros';
}
function clubFor(p){return teamFor(p)?.club||'';}
window.STREETBALL_EUROPE={leagues,otherClubs,normalize,teamFor,isEuropeProduct,leagueFor,clubFor};
})();
