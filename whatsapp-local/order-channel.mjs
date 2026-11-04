import fs from 'node:fs';
import {ownJid} from './connection.mjs';
import {readJson,writePrivateJson} from './state.mjs';
import {BILLING_TEXT_LIMIT,isSupplierBilling,billingOrderReferences} from '../worker/supplier-billing-format.js';

const validJob=id=>typeof id==='string'&&/^lo_[a-f0-9]{32}_\d{1,2}$/.test(id);
const validMessage=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{4,180}$/.test(id);
const validLease=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id);
function savedObject(file){
  const data=readJson(file);
  if(fs.existsSync(file)&&(!data||typeof data!=='object'||Array.isArray(data)))throw new Error('Histórico de pedidos inválido; confira o diagnóstico local.');
  return data||{};
}

export async function downloadOrderImage(link,storeUrl,fetcher=fetch){
  const url=new URL(link),origin=new URL(storeUrl).origin;
  const local=url.origin===origin&&/^\/images\/[A-Za-z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname);
  const supplier=url.hostname==='photo.yupoo.com'&&/^\/james66jersey\/[A-Za-z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname.includes('..')||(!local&&!supplier))throw new Error('Origem de foto inválida.');
  const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok||!/^image\//i.test(response.headers.get('content-type')||''))throw new Error('Foto indisponível.');
  const reader=response.body?.getReader();
  if(!reader)throw new Error('Foto vazia.');
  const chunks=[];let total=0;
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;
    if(total>8*1024*1024){await reader.cancel();throw new Error('Foto excede o limite.');}chunks.push(Buffer.from(value));}
  if(!total)throw new Error('Foto vazia.');
  return Buffer.concat(chunks);
}

export function createOrderChannel({socket,account,config,paths,call,log=console.log,
  normalizeMessageContent=value=>value,fetcher=fetch}){
  const journal=savedObject(paths.ordersJournal),inbox=savedObject(paths.ordersInbox);
  const pendingEvents=new Set();let active=true,warned=false;
  function remember(id,data){
    journal[id]=data;
    const limit=Date.now()-7*86400000;
    for(const [key,value]of Object.entries(journal))if(value.phase==='acked'&&Date.parse(value.at)<limit)delete journal[key];
    if(Object.keys(journal).length>10000)throw new Error('Histórico de pedidos requer revisão.');
    writePrivateJson(paths.ordersJournal,journal);
  }
  async function reconcile(){
    for(const [id,entry]of Object.entries(journal)){
      if(entry.phase==='acked')continue;
      if(entry.phase==='sent')await call('orders-ack',{jobId:id,lease:entry.lease,messageId:entry.messageId});
      else await call(entry.phase==='failed'?'orders-failed':'orders-uncertain',{jobId:id,lease:entry.lease});
      remember(id,{...entry,phase:'acked'});
    }
  }
  async function receive(message){
    if(!message?.key?.id||!validMessage(message.key.id))return;
    let from=String(message.key.remoteJid||'');
    if(from.endsWith('@g.us')||from.endsWith('@broadcast'))return;
    if(from.endsWith('@lid')){
      if(message.key.remoteJidAlt?.endsWith('@s.whatsapp.net'))from=message.key.remoteJidAlt;
      else from=await socket.signalRepository?.lidMapping?.getPNForLID(from)||from;
    }
    try{from=ownJid({id:from});}catch{return;}
    const content=normalizeMessageContent(message.message)||{};
    // Only metadata/captions cross the bridge. Media is never downloaded or executed.
    const mediaType=Object.entries({image:'imageMessage',document:'documentMessage',audio:'audioMessage',video:'videoMessage'}).find(([,key])=>content[key])?.[0]||'';
    const media=mediaType?content[{image:'imageMessage',document:'documentMessage',audio:'audioMessage',video:'videoMessage'}[mediaType]]:null;
    const text=content.extendedTextMessage?.text??content.conversation??media?.caption??'';
    const context=content.extendedTextMessage?.contextInfo?.stanzaId||media?.contextInfo?.stanzaId||'';
    if(typeof text!=='string'||(!text.trim()&&!mediaType)||text.length>BILLING_TEXT_LIMIT)return;
    const quoted=Object.values(journal).find(entry=>entry.messageId===context&&entry.recipientJid===from);
    const pending=context?Object.values(journal).find(entry=>entry.phase==='sending'&&entry.recipientJid===from):null;
    if(message.key.fromMe&&!((quoted?.preview||pending?.preview)&&from===account))return;
    const explicit=/^(?:sem[_ -]?estoque|indispon[ií]vel|esgotado|dispon[ií]vel|temos|confirmar|preparando|detalhes)\s+[a-f0-9]{8}$/i.test(text.trim());
    const billing=isSupplierBilling(text,mediaType)||billingOrderReferences(text).length>0;
    const known=Object.values(journal).some(entry=>!entry.preview&&entry.recipientJid===from);
    if(!quoted&&!pending&&(!(explicit||billing)||!known||config.ordersEnabled!==true))return;
    if(Object.keys(inbox).length>=5000){log('A fila local de respostas requer atenção. Confira o diagnóstico.');return;}
    const id=from+':'+message.key.id;
    if(inbox[id])return;
    inbox[id]={messageId:message.key.id,fromJid:from,text,contextId:(quoted||pending)?context:'',...(mediaType?{mediaType}:{}),at:new Date().toISOString()};
    writePrivateJson(paths.ordersInbox,inbox);
  }
  const listener=event=>{
    if(!active||event?.type!=='notify')return;
    for(const message of event.messages||[]){
      const task=receive(message).catch(()=>log('Uma resposta não pôde ser registrada. Confira o diagnóstico.'));
      pendingEvents.add(task);task.finally(()=>pendingEvents.delete(task));
    }
  };
  socket.ev?.on('messages.upsert',listener);
  async function tick(){
    if(!active)return;
    await reconcile();
    for(const [id,entry]of Object.entries(inbox)){
      try{await call('orders-inbound',entry);delete inbox[id];writePrivateJson(paths.ordersInbox,inbox);warned=false;}
      catch{if(!warned)log('Uma resposta aguarda confirmação no site. Confira npm run status-loja.');warned=true;}
    }
    if(!active)return;
    const {job}=await call('orders-claim',{allowLive:config.ordersEnabled===true});
    if(!job||!active)return;
    if(!validJob(job.id)||!validLease(job.lease)||job.kind!=='order_message_v1'||job.accountJid!==account||
      !/^\d+@(s\.whatsapp\.net|lid)$/.test(job.recipientJid)||
      (job.preview?job.recipientJid!==account:config.ordersEnabled!==true))throw new Error('Tarefa de pedido inválida.');
    const entry={lease:job.lease,recipientJid:job.recipientJid,preview:job.preview===true,groupId:job.groupId,at:new Date().toISOString()};
    remember(job.id,{...entry,phase:'prepared'});
    let content;
    try{
      if(job.payload?.type==='image'&&typeof job.payload.image?.caption==='string'&&job.payload.image.caption.length<=3900){
        content={image:await downloadOrderImage(job.payload.image.link,config.storeUrl,fetcher),caption:job.payload.image.caption};
      }else if(job.payload?.type==='text'&&typeof job.payload.text?.body==='string'&&job.payload.text.body.length>0&&job.payload.text.body.length<=3900){
        content={text:job.payload.text.body};
      }else throw new Error('Conteúdo inválido.');
    }catch{remember(job.id,{...entry,phase:'failed'});await reconcile();log('A foto ou mensagem do pedido requer revisão.');return;}
    await call('orders-sending',{jobId:job.id,lease:job.lease});
    if(!active)return;
    remember(job.id,{...entry,phase:'sending'});
    try{
      const result=await socket.sendMessage(job.recipientJid,content);
      if(!validMessage(result?.key?.id))throw new Error('Envio não confirmado.');
      remember(job.id,{...entry,phase:'sent',messageId:result.key.id});
    }catch{remember(job.id,{...entry,phase:'uncertain'});await reconcile();log('Um envio de pedido requer revisão; não será repetido automaticamente.');return;}
    await reconcile();
    log(job.preview?'Foto de teste enviada para o próprio número. Responda usando Responder na foto.':'Mensagem do pedido enviada e confirmada no site.');
  }
  return {tick,async stop(){active=false;socket.ev?.off('messages.upsert',listener);await Promise.allSettled([...pendingEvents]);}};
}
