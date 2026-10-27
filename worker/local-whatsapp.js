const PREFIX='/api/local-whatsapp/';
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const instant=()=>new Date().toISOString();
const future=ms=>new Date(Date.now()+ms).toISOString();
const validId=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
const accountId=value=>typeof value==='string'&&/^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(value)?value.replace(/:\d+@/,'@'):'';

async function authenticated(request,secret){
 const header=request.headers.get('authorization')||'';
 if(typeof secret!=='string'||secret.length<32||secret.length>256||header.length>270)return false;
 const digest=value=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 const [a,b]=await Promise.all([digest(header),digest('Bearer '+secret)]);
 let different=0;
 const left=new Uint8Array(a),right=new Uint8Array(b);
 for(let i=0;i<left.length;i++)different|=left[i]^right[i];
 return different===0;
}

/** Authenticated local connector; the production inspection only reads provider settings. */
export async function handleLocalWhatsApp(request,env,callbacks={}){
 const route=new URL(request.url).pathname;
 if(!route.startsWith(PREFIX))return null;
 if(!env.DB||!env.WA_LOCAL_BRIDGE_TOKEN)return reply({error:'Ponte ainda não configurada.'},503);
 if(!await authenticated(request,env.WA_LOCAL_BRIDGE_TOKEN))return reply({error:'Autenticação inválida.'},401);
 if(request.method!=='POST')return reply({error:'Método inválido.'},405);
 const bodyLimit=route===PREFIX+'orders-inbound'?32000:4096;
 if(Number(request.headers.get('content-length')||0)>bodyLimit)return reply({error:'Requisição muito grande.'},413);
 const raw=await request.text();
 if(raw.length>bodyLimit)return reply({error:'Requisição muito grande.'},413);
 let body;
 try{body=JSON.parse(raw);}catch{return reply({error:'JSON inválido.'},400);}
 const own=accountId(body?.accountJid);
 if(!own)return reply({error:'Conta vinculada inválida.'},400);
 try{
  let binding=await env.DB.prepare('SELECT account_jid,heartbeat_at FROM wa_local_bridge WHERE id=1').first();
  const action=route.slice(PREFIX.length);
  if(action==='session'&&!binding){
   await env.DB.prepare('INSERT OR IGNORE INTO wa_local_bridge(id,account_jid,heartbeat_at) VALUES(1,?,?)').bind(own,instant()).run();
   binding=await env.DB.prepare('SELECT account_jid,heartbeat_at FROM wa_local_bridge WHERE id=1').first();
  }
  if(action==='status'&&!binding)return reply({ok:true,mode:'self_test_only',online:false,heartbeatAt:null,queue:[],latest:null});
  if(!binding||binding.account_jid!==own)return reply({error:'A ponte deve usar a mesma conta secundária cadastrada.'},409);
  if(action==='session'||action==='claim')await env.DB.prepare('UPDATE wa_local_bridge SET heartbeat_at=? WHERE id=1 AND account_jid=?').bind(instant(),own).run();
  if(action==='session')return reply({ok:true,mode:'self_test_only'});
  if(action==='production-status')return reply(await productionReadiness(env));
  if(action.startsWith('orders-'))return await handleOrderBridgeAction(action,env,body,own,callbacks);
  if(action==='status'){
   const jobs=await env.DB.prepare('SELECT state,COUNT(*) AS count FROM wa_local_test_jobs GROUP BY state').all();
   const latest=await env.DB.prepare('SELECT id,state,updated_at FROM wa_local_test_jobs ORDER BY created_at DESC LIMIT 1').first();
   let orderBridge=null;
   try{orderBridge=await orderBridgeStatus(env);}catch{/* Optional additive migration may not be installed yet. */}
   return reply({ok:true,mode:orderBridge?.enabled?'live_orders':'self_test_only',heartbeatAt:binding.heartbeat_at,
    online:Date.now()-Date.parse(binding.heartbeat_at)<60000,queue:jobs.results||[],latest:latest||null,orderBridge});
  }
  if(action==='test'){
   // Double clicks reuse the same recent job. The client cannot supply text or a recipient.
   if('to' in body||'text' in body||'recipient' in body)return reply({error:'O teste só aceita a própria conta e a mensagem fixa.'},400);
   const recent=await env.DB.prepare('SELECT id,state FROM wa_local_test_jobs WHERE created_at>=? ORDER BY created_at DESC LIMIT 1').bind(new Date(Date.now()-30000).toISOString()).first();
   if(recent)return reply({ok:true,jobId:recent.id,state:recent.state,reused:true});
   const id=crypto.randomUUID(),t=instant();
   await env.DB.prepare("INSERT OR IGNORE INTO wa_local_test_jobs(id,state,created_at,updated_at,expires_at) VALUES(?,'pending',?,?,?)")
    .bind(id,t,t,future(10*60000)).run();
   const selected=await env.DB.prepare('SELECT id,state FROM wa_local_test_jobs ORDER BY created_at DESC LIMIT 1').first();
   return reply({ok:true,jobId:selected.id,state:selected.state,reused:selected.id!==id});
  }
  if(action==='claim'){
   const t=instant();
   // A claimed job has not started transmission and can be safely claimed again.
   await env.DB.prepare("UPDATE wa_local_test_jobs SET state='pending',lease_token=NULL,lease_until=NULL,updated_at=? WHERE state='claimed' AND lease_until<?").bind(t,t).run();
   await env.DB.prepare("UPDATE wa_local_test_jobs SET state='expired',updated_at=? WHERE state='pending' AND expires_at<?").bind(t,t).run();
   // Sending without confirmation must never be replayed automatically.
   await env.DB.prepare("UPDATE wa_local_test_jobs SET state='uncertain',updated_at=? WHERE state='sending' AND lease_until<?").bind(t,t).run();
   const lease=crypto.randomUUID();
   const job=await env.DB.prepare("UPDATE wa_local_test_jobs SET state='claimed',lease_token=?,lease_until=?,updated_at=? WHERE id=(SELECT id FROM wa_local_test_jobs WHERE state='pending' AND expires_at>=? ORDER BY created_at LIMIT 1) AND state='pending' RETURNING id")
    .bind(lease,future(120000),t,t).first();
   return reply({ok:true,job:job?{id:job.id,lease,kind:'self_test_v1',accountJid:own}:null});
  }
  if(!['sending','ack','uncertain'].includes(action))return reply({error:'Endpoint não encontrado.'},404);
  if(!validId(body.jobId)||!validId(body.lease))return reply({error:'Identificação de tarefa inválida.'},400);
  const job=await env.DB.prepare('SELECT state,lease_token,lease_until,remote_message_id FROM wa_local_test_jobs WHERE id=?').bind(body.jobId).first();
  if(!job||job.lease_token!==body.lease)return reply({error:'Reserva inválida.'},409);
  if(action==='sending'){
   if(job.state==='sending')return reply({ok:true});
   const updated=await env.DB.prepare("UPDATE wa_local_test_jobs SET state='sending',updated_at=? WHERE id=? AND lease_token=? AND state='claimed' AND lease_until>=? RETURNING id")
    .bind(instant(),body.jobId,body.lease,instant()).first();
   return updated?reply({ok:true}):reply({error:'Reserva expirada ou encerrada.'},409);
  }
  if(action==='ack'){
   if(typeof body.messageId!=='string'||!/^[A-Za-z0-9_-]{4,180}$/.test(body.messageId))return reply({error:'Confirmação inválida.'},400);
   if(job.state==='sent')return job.remote_message_id===body.messageId?reply({ok:true}):reply({error:'Tarefa já confirmada com outra mensagem.'},409);
   const updated=await env.DB.prepare("UPDATE wa_local_test_jobs SET state='sent',remote_message_id=?,updated_at=? WHERE id=? AND lease_token=? AND state IN ('sending','uncertain') RETURNING id")
    .bind(body.messageId,instant(),body.jobId,body.lease).first();
   return updated?reply({ok:true}):reply({error:'Tarefa não iniciou o envio.'},409);
  }
  await env.DB.prepare("UPDATE wa_local_test_jobs SET state='uncertain',updated_at=? WHERE id=? AND lease_token=? AND state IN ('claimed','sending')").bind(instant(),body.jobId,body.lease).run();
  return reply({ok:true});
 }catch{return reply({error:'Ponte indisponível. Confira a migração do banco e a implantação.'},503);}
}
import {handleOrderBridgeAction,orderBridgeStatus} from './local-orders.js';
import {productionReadiness} from './production-readiness.js';
