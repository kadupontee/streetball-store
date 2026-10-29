import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {assertAssetVersion} from './support/asset-version.mjs';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function setup(){
 const listeners={},nodes={};
 const document={activeElement:null,addEventListener(type,fn){(listeners[type]??=[]).push(fn)},querySelector(selector){assert.equal(selector,'.desktop-nav');return nodes.collectionsMenu}};
 const dispatch=(type,event)=>{for(const fn of listeners[type]||[])fn(event)};
 function node(id,parent=null,tagName='BUTTON'){
  const classes=new Set(),events={},attrs={};
  return nodes[id]={id,parent,tagName,hidden:id==='accountDropdown',classList:{contains:c=>classes.has(c),toggle(c,force){const enabled=force??!classes.has(c);enabled?classes.add(c):classes.delete(c)},remove:c=>classes.delete(c)},
   setAttribute(k,v){attrs[k]=v},getAttribute:k=>attrs[k],
   addEventListener(type,fn){(events[type]??=[]).push(fn)},fire(type,event){for(const fn of events[type]||[])fn(event)},
   contains(other){for(let p=other;p;p=p.parent)if(p===this)return true;return false},
   closest(selector){if(selector==='.search-box')return nodes.headerSearch;for(let p=this;p;p=p.parent)if(selector==='a'&&p.tagName==='A')return p;return null},
   focus(){document.activeElement=this;dispatch('focusin',{target:this})}
  };
 }
 for(const id of ['menuToggle','mobileSearch','accountTrigger','favoriteTrigger'])node(id);
 node('collectionsMenu',null,'NAV');node('headerSearch',null,'LABEL');node('accountDropdown',null,'NAV');
 node('globalSearch',nodes.headerSearch,'INPUT');node('accountLink',nodes.accountDropdown,'A');node('outside',null,'MAIN');
 const context={document,$:id=>nodes[id],state:{},catalogRender(){}};
 context.openUI=()=>context.closeHeaderPanels();
 const block=app.split('// Header panels share a single open state: collections, search or account.')[1].split('// End header panels.')[0];
 runInNewContext(block,context);
 const keyboard=app.slice(app.indexOf("document.addEventListener('keydown',e=>{"),app.indexOf("$('year').textContent"));
 runInNewContext(keyboard,context);
 const click=id=>{const target=nodes[id];target.fire('click',{target});dispatch('click',{target})};
 return {nodes,document,click,dispatch};
}
test('opening account, search and collections never leaves two header panels open',()=>{
 const{nodes:n,click}=setup();
 click('accountTrigger');assert.equal(n.accountDropdown.hidden,false);assert.equal(n.accountTrigger.getAttribute('aria-expanded'),'true');
 click('menuToggle');assert.equal(n.accountDropdown.hidden,true);assert.ok(n.collectionsMenu.classList.contains('mobile-open'));
 click('mobileSearch');assert.ok(!n.collectionsMenu.classList.contains('mobile-open'));assert.ok(n.headerSearch.classList.contains('open'));
 click('accountTrigger');assert.ok(!n.headerSearch.classList.contains('open'));assert.equal(n.accountDropdown.hidden,false);
 click('accountTrigger');assert.equal(n.accountDropdown.hidden,true);assert.equal(n.accountTrigger.getAttribute('aria-expanded'),'false');
});
test('outside clicks, selected links and leaving the header by keyboard close its panels',()=>{
 const{nodes:n,click}=setup();
 click('accountTrigger');click('outside');assert.equal(n.accountDropdown.hidden,true);
 click('accountTrigger');click('accountLink');assert.equal(n.accountDropdown.hidden,true);
 click('menuToggle');n.outside.focus();assert.ok(!n.collectionsMenu.classList.contains('mobile-open'));
});
test('Escape closes the panel and returns focus, while slash opens search alone',()=>{
 const{nodes:n,click,document,dispatch}=setup();
 click('accountTrigger');dispatch('keydown',{key:'Escape'});assert.equal(n.accountDropdown.hidden,true);assert.equal(document.activeElement,n.accountTrigger);
 click('menuToggle');let prevented=false;dispatch('keydown',{key:'/',preventDefault(){prevented=true}});
 assert.ok(prevented);assert.ok(!n.collectionsMenu.classList.contains('mobile-open'));assert.equal(document.activeElement,n.globalSearch);assert.ok(n.headerSearch.classList.contains('open'));
 dispatch('keydown',{key:'Escape'});assert.ok(!n.headerSearch.classList.contains('open'));assert.equal(document.activeElement,n.mobileSearch);
 n.globalSearch.focus();dispatch('keydown',{key:'/',preventDefault(){assert.fail('Do not intercept text input')}});
});
test('seller link appears once inside the account navigation; header has no loose seller link',()=>{
 const account=readFileSync(new URL('../public/account.html',import.meta.url),'utf8');
 const header=account.match(/<header\b[^>]*>[\s\S]*?<\/header>/)[0];
 const links=account.match(/<nav class="account-side-links"[\s\S]*?<\/nav>/)[0];
 assert.doesNotMatch(header,/vendedor\.html/);assert.match(links,/href="\/vendedor\.html" id="menuSeller"/);
 assert.equal((account.match(/href="\/vendedor\.html"/g)||[]).length,1);
 assertAssetVersion(account,'account-ui.css','20261028');
 for(const name of ['index.html','account.html']){
  const html=readFileSync(new URL('../public/'+name,import.meta.url),'utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size,'Duplicate ID in '+name);
 }
});
