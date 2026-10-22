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
