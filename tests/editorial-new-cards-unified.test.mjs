import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base=new URL('../public/',import.meta.url);
for(const name of ['retro','atuais','personalizadas','todas-colecoes']){
 test('imagem unificada '+name,()=>{
  const png=readFileSync(new URL('images/editorial/card-'+name+'.png',base));
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),960);
  assert.equal(png.readUInt32BE(20),557);
 });
}
test('mobile usa altura natural sem cortar',()=>{
 const css=readFileSync(new URL('editorial.css',base),'utf8');
 const v7=css.split('Streetball unified collection cards V7:')[1];
 assert.ok(v7);
 assert.match(v7,/object-fit:contain/);
 assert.match(v7,/height:auto/);
 assert.match(v7,/max-width:780px/);
});


test('o cache do HTML no Cloudflare nao prende o mobile a versoes antigas',()=>{
 const headers=readFileSync(new URL('_headers',base),'utf8');
 const html=readFileSync(new URL('index.html',base),'utf8');
 const js=readFileSync(new URL('app.js',base),'utf8');
 const css=readFileSync(new URL('editorial.css',base),'utf8');
 assert.match(headers,/\/index\.html\s+Cache-Control: no-store/);
 assert.match(headers,/\/\s+Cache-Control: no-store/);
 assert.match(html,/editorial\.css\?v=20261022-mobile-refresh-v8/);
 assert.match(html,/app\.js\?v=20261022-session-aware-home-v9/);
 assert.match(js,/EDITORIAL_IMAGE_REVISION='20261022-mobile-refresh-v8'/);
 assert.match(js,/EDITORIAL_ASSET_COMMIT='d27a00d6bcd45c27132f445b7e214f3bc934c61a'/);
 const mobile=css.split('V8 mobile: 4 novos banners')[1];
 assert.ok(mobile);
 assert.match(mobile,/#categoryGrid\.category-grid/);
 assert.match(mobile,/grid-template-columns: minmax\(0, 1fr\)/);
 assert.match(mobile,/aspect-ratio: 960 \/ 557/);
 assert.match(mobile,/object-fit: contain/);
});
