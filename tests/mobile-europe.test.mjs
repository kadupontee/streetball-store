import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('atalhos de navegação aparecem no mobile e acessam as categorias reais',()=>{
 const html=fs.readFileSync('public/index.html','utf8');
 const css=fs.readFileSync('public/editorial.css','utf8');
 assert.match(html, /class="mobile-collection-nav"/);
 assert.match(html, /data-category="europa" data-mobile-europe/);
 assert.match(html, /data-category="brasileirao"/);
 assert.match(css, /@media\(max-width:890px\)/);
 assert.match(css, /\.mobile-collection-nav\{display:block/);
 assert.match(css, /\.mobile-collection-inner\{display:flex/);
 assert.match(css, /\.europe-league-grid\{display:grid;grid-template-columns:repeat\(2/);
 assert.match(css, /#europeClubGrid\{display:grid;grid-template-columns:repeat\(2/);
});
test('o script principal contém a navegação de cinco ligas e seus eventos',()=>{
 const app=fs.readFileSync('public/app.js','utf8');
 const html=fs.readFileSync('public/index.html','utf8');
 assert.match(app,/function renderEuropeNavigation\(/);
 assert.match(app,/function selectEuropeLeague\(/);
 assert.match(app,/function selectEuropeClub\(/);
 assert.match(app, /\[data-euro-league\]/);
 assert.match(app, /\[data-euro-club\]/);
 assert.match(app, /const EUROPE=\(\(\)=>/);
 assert.match(html,/app\.js\?v=20261023-mobile-europe-v3/);
});
test('headers mantêm o HTML atualizado e revalidam os estilos',()=>{
 const headers=fs.readFileSync('public/_headers','utf8');
 assert.match(headers, /\/index\.html\n\s+Cache-Control: no-store/);
 assert.match(headers, /\/styles\.css\n\s+Cache-Control: public, max-age=0, must-revalidate/);
});
