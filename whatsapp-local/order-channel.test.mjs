import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createOrderChannel,downloadOrderImage} from './order-channel.mjs';
import {statePaths,prepareState,readJson,writePrivateJson} from './state.mjs';
import {pixFixture} from '../tests/support/pix-fixture.mjs';

const id='lo_'+'a'.repeat(32)+'_0',lease='11111111-1111-4111-8111-111111111111',account='5511999999999@s.whatsapp.net';
const settled=async()=>{for(let n=0;n<15;n++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(t,{preview=true,allowLive=false,payload={type:'text',text:{body:'Fixed example'}}}={}){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'local-order-channel-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const paths=statePaths(home,'darwin');prepareState(paths);const sent=[],calls=[];let claimed=false;
 const recipient=preview?account:'8613800138000@s.whatsapp.net';
 const job={id,lease,kind:'order_message_v1',accountJid:account,recipientJid:recipient,preview,groupId:'lg_'+'a'.repeat(32),payload};
 const socket={user:{id:account},ev:new EventEmitter(),async sendMessage(...args){sent.push(args);return {key:{id:'OUTGOING_MESSAGE_ID'}};}};
 const call=async(action,data)=>{calls.push({action,data});if(action==='orders-claim'){if(claimed)return {ok:true,job:null};claimed=true;return {ok:true,job};}return {ok:true};};
 const options={socket,account,config:{storeUrl:'https://loja.example',ordersEnabled:allowLive},paths,call,log:()=>{}};
 return {paths,sent,calls,job,socket,call,options};
}
test('preview replies quote the exact outgoing photo and only the expected own account is forwarded',async t=>{
 const h=fixture(t),channel=createOrderChannel(h.options);await channel.tick();
 assert.equal(h.sent.length,1);assert.equal(h.sent[0][0],account);
 h.socket.ev.emit('messages.upsert',{type:'notify',messages:[{key:{id:'INCOMING_REPLY_ID',fromMe:true,remoteJid:account},message:{extendedTextMessage:{text:'sim',contextInfo:{stanzaId:'OUTGOING_MESSAGE_ID'}}}}]});
 await settled();await channel.tick();await channel.stop();
 const inbound=h.calls.find(c=>c.action==='orders-inbound');assert.equal(inbound.data.text,'sim');assert.equal(inbound.data.contextId,'OUTGOING_MESSAGE_ID');
 assert.deepEqual(readJson(h.paths.ordersInbox),{});
 assert.equal(fs.statSync(h.paths.ordersJournal).mode&0o777,0o600);
});
test('preview refuses any recipient other than the authenticated secondary number',async t=>{
 const h=fixture(t);h.job.recipientJid='8613800138000@s.whatsapp.net';const channel=createOrderChannel(h.options);
 await assert.rejects(channel.tick(),/Tarefa/);assert.equal(h.sent.length,0);await channel.stop();
});
test('a very fast quoted reply is saved while the outgoing send is still awaiting acknowledgement',async t=>{
 const h=fixture(t);let complete;
 h.socket.sendMessage=()=>new Promise(resolve=>{complete=resolve;});
 const channel=createOrderChannel(h.options),sending=channel.tick();await settled();
 h.socket.ev.emit('messages.upsert',{type:'notify',messages:[{key:{id:'FAST_INCOMING_REPLY',fromMe:true,remoteJid:account},message:{extendedTextMessage:{text:'sim',contextInfo:{stanzaId:'FAST_OUTGOING_MESSAGE'}}}}]});
 await settled();assert.equal(Object.keys(readJson(h.paths.ordersInbox)).length,1);
 complete({key:{id:'FAST_OUTGOING_MESSAGE'}});await sending;await channel.tick();await channel.stop();
 assert.equal(h.calls.find(c=>c.action==='orders-inbound').data.contextId,'FAST_OUTGOING_MESSAGE');
});
test('live jobs require explicit local activation even if the server supplies a job',async t=>{
 const h=fixture(t,{preview:false}),channel=createOrderChannel(h.options);
 await assert.rejects(channel.tick(),/Tarefa/);assert.equal(h.sent.length,0);await channel.stop();
});
test('LID sender addresses resolve to the registered phone before correlating a reply',async t=>{
 const h=fixture(t,{preview:false,allowLive:true});const channel=createOrderChannel(h.options);await channel.tick();
 h.socket.ev.emit('messages.upsert',{type:'notify',messages:[{key:{id:'VENDOR_REPLY_ID',fromMe:false,remoteJid:'123456789@lid',remoteJidAlt:h.job.recipientJid},message:{extendedTextMessage:{text:'sim',contextInfo:{stanzaId:'OUTGOING_MESSAGE_ID'}}}}]});
 await settled();await channel.tick();await channel.stop();
 assert.equal(h.calls.find(c=>c.action==='orders-inbound').data.fromJid,h.job.recipientJid);
});
test('a crash with unknown delivery never causes a second send',async t=>{
 const h=fixture(t);writePrivateJson(h.paths.ordersJournal,{[id]:{phase:'sending',lease,at:new Date().toISOString()}});
 const call=async(action,data)=>action==='orders-claim'?{ok:true,job:null}:h.call(action,data);
 const channel=createOrderChannel({...h.options,call});await channel.tick();await channel.stop();
 assert.equal(h.sent.length,0);assert.ok(h.calls.some(c=>c.action==='orders-uncertain'));
});
test('history, groups and unrelated conversations are not forwarded or stored',async t=>{
 const h=fixture(t),channel=createOrderChannel(h.options);
 const message={key:{id:'UNRELATED_REPLY',remoteJid:'5511888888888@s.whatsapp.net'},message:{conversation:'personal conversation'}};
 h.socket.ev.emit('messages.upsert',{type:'append',messages:[message]});
 h.socket.ev.emit('messages.upsert',{type:'notify',messages:[message,{...message,key:{...message.key,remoteJid:'123@g.us'}}]});
 await settled();await channel.stop();assert.ok(!fs.existsSync(h.paths.ordersInbox));assert.ok(!h.calls.some(c=>c.action==='orders-inbound'));
});
test('images are downloaded only from allowed origins without redirects and are size bounded',async()=>{
 let options;
 const fetcher=async(_url,args)=>{options=args;return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/webp'}});};
 const photo=await downloadOrderImage('https://loja.example/images/demo.webp','https://loja.example',fetcher);
 assert.equal(photo.length,3);assert.equal(options.redirect,'error');
 await assert.rejects(downloadOrderImage('http://127.0.0.1/private.jpg','https://loja.example',fetcher),/Origem/);
 await assert.rejects(downloadOrderImage('https://evil.example/photo.jpg','https://loja.example',fetcher),/Origem/);
 const huge=async()=>new Response(new Uint8Array(8*1024*1024+1),{headers:{'content-type':'image/png'}});
 await assert.rejects(downloadOrderImage('https://loja.example/images/demo.png','https://loja.example',huge),/limite/);
});
test('a failed photo download is not transmitted and requests review',async t=>{
 const h=fixture(t,{payload:{type:'image',image:{link:'https://evil.example/image.png',caption:'Example'}}});
 const channel=createOrderChannel(h.options);await channel.tick();await channel.stop();
 assert.equal(h.sent.length,0);assert.ok(h.calls.some(c=>c.action==='orders-failed'));
});

test('long supplier bills keep the entire Pix and an unquoted provider change is sent only from a known live contact',async t=>{
 const h=fixture(t,{preview:false,allowLive:true}),channel=createOrderChannel(h.options);await channel.tick();
 const pix=pixFixture(),body='INVOICE 1234abcd\nTotal BRL: 76.80\n'+('Item description. '.repeat(30))+'\n'+pix;
 assert.ok(body.length>400);
 h.socket.ev.emit('messages.upsert',{type:'notify',messages:[
  {key:{id:'LONG_SUPPLIER_BILL',remoteJid:h.job.recipientJid},message:{extendedTextMessage:{text:body,contextInfo:{stanzaId:'OUTGOING_MESSAGE_ID'}}}},
  {key:{id:'UNQUOTED_NEW_PROVIDER',remoteJid:h.job.recipientJid},message:{conversation:'https://changed.example.invalid/invoice'}},
  {key:{id:'UNRELATED_PROVIDER',remoteJid:'8613700137000@s.whatsapp.net'},message:{conversation:'https://other.example.invalid/invoice'}}
 ]});
 await settled();await channel.tick();await channel.stop();
 const inbound=h.calls.filter(c=>c.action==='orders-inbound');assert.equal(inbound.length,2);
 assert.equal(inbound[0].data.text,body);assert.ok(inbound[0].data.text.endsWith(pix));assert.equal(inbound[1].data.contextId,'');
});

test('attachment captions and type are forwarded without file URLs, keys, downloads or execution',async t=>{
 const h=fixture(t,{preview:false,allowLive:true}),channel=createOrderChannel({...h.options,fetcher:()=>assert.fail('No media download')});await channel.tick();
 for(const type of ['image','document','audio','video'])h.socket.ev.emit('messages.upsert',{type:'notify',messages:[{
  key:{id:'BILL_MEDIA_'+type,remoteJid:h.job.recipientJid},message:{[type+'Message']:{caption:'',url:'https://private-media.example.invalid',mediaKey:'private-media-key',contextInfo:{stanzaId:'OUTGOING_MESSAGE_ID'}}}
 }]});
 await settled();await channel.tick();await channel.stop();
 const inbound=h.calls.filter(c=>c.action==='orders-inbound');assert.equal(inbound.length,4);
 for(const c of inbound){assert.ok(c.data.mediaType);assert.equal(c.data.text,'');assert.ok(!JSON.stringify(c.data).includes('private-media'));}
});

test('unquoted billing is ignored while local live orders are disabled, including after a previous live session',async t=>{
 const h=fixture(t,{preview:false,allowLive:true});let channel=createOrderChannel(h.options);await channel.tick();await channel.stop();
 channel=createOrderChannel({...h.options,config:{...h.options.config,ordersEnabled:false}});
 h.socket.ev.emit('messages.upsert',{type:'notify',messages:[{key:{id:'DISABLED_BILLING',remoteJid:h.job.recipientJid},message:{conversation:'Total BRL: 76.80\nhttps://changed.example.invalid'}}]});
 await settled();await channel.stop();assert.ok(!h.calls.some(c=>c.action==='orders-inbound'));
});
