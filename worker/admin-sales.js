import {sellerAdmin} from './seller-sales.js';
import {base64url,generateVapidKeys,validatePushSubscription,sendWebPush,fromBase64url,WebPushError} from './web-push.js';
import {salesProgress} from './admin-sales-progress.js';
import {STAGES} from './order-progress.js';

export const SALES_NOTIFICATIONS_VERSION='iphone-sales-v3';
const PREFIX='/api/admin/sales/',COOKIE='__Host-streetball_ops';
const now=()=>new Date().toISOString();
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const idValid=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id);
const hash=async value=>base64url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const cookieHeader=(token,age=15552000)=>`${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
const attemptsSchema=`CREATE TABLE IF NOT EXISTS admin_push_attempt_results(subscription_id TEXT PRIMARY KEY REFERENCES admin_push_subscriptions(id),kind TEXT NOT NULL,state TEXT NOT NULL,phase TEXT NOT NULL,error_code TEXT,provider_status INTEGER,provider_reason TEXT,attempt_id TEXT NOT NULL,attempted_at TEXT NOT NULL)`;
const schema=[
 `CREATE TABLE IF NOT EXISTS admin_sales_config(id INTEGER PRIMARY KEY CHECK(id=1),public_key TEXT NOT NULL,private_jwk TEXT NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS admin_sales_sessions(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,expires_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS admin_push_subscriptions(id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES admin_sales_sessions(id),subscription_json TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS admin_sale_events(order_id TEXT NOT NULL REFERENCES orders(id),kind TEXT NOT NULL,occurred_at TEXT NOT NULL,PRIMARY KEY(order_id,kind))`,
 `CREATE TABLE IF NOT EXISTS admin_sale_notifications(order_id TEXT PRIMARY KEY REFERENCES orders(id),created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS admin_push_deliveries(order_id TEXT NOT NULL REFERENCES admin_sale_notifications(order_id),subscription_id TEXT NOT NULL REFERENCES admin_push_subscriptions(id),state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,lease_until TEXT,next_attempt_at TEXT,last_status INTEGER,updated_at TEXT NOT NULL,PRIMARY KEY(order_id,subscription_id))`,
 `CREATE INDEX IF NOT EXISTS idx_admin_push_pending ON admin_push_deliveries(state,next_attempt_at)`,
 attemptsSchema
];
async function saveAttempt(env,subscriptionId,result){
 // Diagnostics are additive and best effort. A logging failure must not alter
 // whether a push was accepted or cause a duplicate send.
 try{
  await env.DB.prepare(attemptsSchema).run();
  await env.DB.prepare('INSERT INTO admin_push_attempt_results(subscription_id,kind,state,phase,error_code,provider_status,provider_reason,attempt_id,attempted_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET kind=excluded.kind,state=excluded.state,phase=excluded.phase,error_code=excluded.error_code,provider_status=excluded.provider_status,provider_reason=excluded.provider_reason,attempt_id=excluded.attempt_id,attempted_at=excluded.attempted_at')
   .bind(subscriptionId,result.kind,result.state,result.phase,result.code||null,result.status??null,result.reason||null,result.id,now()).run();
 }catch{}
}
function pushFailure(result){
 if(result.gone)return {code:'PUSH_SUBSCRIPTION_EXPIRED',phase:'subscription',message:'O cadastro de notificações expirou. Toque em Reconectar notificações para renovar o acesso deste aparelho.'};
 if([401,403].includes(result.status))return {code:'PUSH_PROVIDER_AUTH_REJECTED',phase:'authentication',message:'O serviço de notificações recusou a identificação da loja. A configuração de envio precisa ser conferida.'};
 if(result.status===429)return {code:'PUSH_RATE_LIMITED',phase:'provider',message:'O serviço de notificações limitou os testes. Aguarde um pouco e tente novamente.'};
 return {code:'PUSH_PROVIDER_REJECTED',phase:'provider',message:'O serviço de notificações não aceitou o teste agora. Tente novamente.'};
}
async function tables(env){return new Set((await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(r=>r.name));}
export async function salesNotificationsReady(env){
 if(!env.DB)return false;
 return !!await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_sales_config'").first();
}
export async function prepareSalesNotifications(env){
 await env.DB.batch(schema.map(sql=>env.DB.prepare(sql)));
 let saved=await env.DB.prepare('SELECT public_key,private_jwk FROM admin_sales_config WHERE id=1').first();
 if(!saved){
  const keys=await generateVapidKeys();
  await env.DB.prepare('INSERT OR IGNORE INTO admin_sales_config(id,public_key,private_jwk,created_at) VALUES(1,?,?,?)').bind(keys.publicKey,JSON.stringify(keys.privateJwk),now()).run();
  saved=await env.DB.prepare('SELECT public_key,private_jwk FROM admin_sales_config WHERE id=1').first();
 }
 return {publicKey:saved.public_key,privateJwk:JSON.parse(saved.private_jwk)};
}
async function keysFor(env){
 const row=await env.DB.prepare('SELECT public_key,private_jwk FROM admin_sales_config WHERE id=1').first();
 return row?{publicKey:row.public_key,privateJwk:JSON.parse(row.private_jwk)}:null;
}
async function isAdmin(request,env){
 const value=request.headers.get('authorization')||'';
 if(!env.ADMIN_TOKEN||value.length>1024)return false;
 // Hash both values before comparison so the secret is not compared character by character.
 return await hash(value)===await hash('Bearer '+env.ADMIN_TOKEN);
}
async function deviceSession(request,env){
 const token=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
 if(!token||!/^[-_A-Za-z0-9]{43}$/.test(token)||!await salesNotificationsReady(env))return null;
 return await env.DB.prepare('SELECT id,expires_at FROM admin_sales_sessions WHERE token_hash=? AND expires_at>?').bind(await hash(token),now()).first();
}
async function bodyFor(request){
 if(Number(request.headers.get('content-length')||0)>6000)throw Error('Dados muito grandes.');
 const raw=await request.text();if(raw.length>6000)throw Error('Dados muito grandes.');
 try{return JSON.parse(raw);}catch{throw Error('Dados inválidos.');}
}
function sameOrigin(request){
 const origin=request.headers.get('origin');
 return (!origin||origin===new URL(request.url).origin)&&request.headers.get('sec-fetch-site')!=='cross-site';
}
export async function handleAdminSales(request,env,ctx){
 const url=new URL(request.url);
 if(url.pathname==='/api/health/notifications')return json({version:SALES_NOTIFICATIONS_VERSION,available:true});
 if(!url.pathname.startsWith(PREFIX))return null;
 if(!env.DB)return json({error:'Banco de pedidos indisponível.'},503);
 const action=url.pathname.slice(PREFIX.length),method=request.method;
 if(!['GET','POST'].includes(method))return json({error:'Método inválido.'},405);
 if(method==='POST'&&!sameOrigin(request))return json({error:'Origem inválida.'},403);
 try{
  const admin=await isAdmin(request,env);
  if(action==='session'&&method==='POST'){
   if(!admin)return json({error:'Confira sua chave administrativa.'},401);
   await prepareSalesNotifications(env);
   await env.DB.prepare("DELETE FROM admin_sales_sessions WHERE expires_at<? AND id NOT IN (SELECT device_id FROM admin_push_subscriptions)").bind(now()).run();
   const existing=await deviceSession(request,env);
   if(existing)return json({ok:true,version:SALES_NOTIFICATIONS_VERSION});
   const token=base64url(crypto.getRandomValues(new Uint8Array(32))),deviceId=crypto.randomUUID();
   await env.DB.prepare('INSERT INTO admin_sales_sessions(id,token_hash,created_at,expires_at) VALUES(?,?,?,?)').bind(deviceId,await hash(token),now(),new Date(Date.now()+180*86400000).toISOString()).run();
   return json({ok:true,version:SALES_NOTIFICATIONS_VERSION},200,{'set-cookie':cookieHeader(token)});
  }
  const session=await deviceSession(request,env);
  if(!session&&!admin)return json({error:'Entre com sua chave administrativa para acompanhar as vendas.'},401);
  const sellerResponse=await sellerAdmin(request,env,action);if(sellerResponse)return sellerResponse;
  if(action==='session'&&method==='GET')return json({ok:true,deviceReady:!!session,version:SALES_NOTIFICATIONS_VERSION});
  if(action==='logout'&&method==='POST'){
   if(session){
    // Keep delivery history; disabling the subscription prevents further pushes.
    await env.DB.prepare('UPDATE admin_push_subscriptions SET disabled=1,updated_at=? WHERE device_id=?').bind(now(),session.id).run();
    await env.DB.prepare('UPDATE admin_sales_sessions SET expires_at=? WHERE id=?').bind(now(),session.id).run();
   }
   return json({ok:true},200,{'set-cookie':cookieHeader('',0)});
  }
  if(action==='orders'&&method==='GET'){
   const data=await env.DB.prepare('SELECT o.id,o.created_at,o.status,o.name,o.total,j.status AS supplier_status,d.state AS dispatch_state FROM orders o LEFT JOIN supplier_jobs j ON j.order_id=o.id LEFT JOIN supplier_dispatch d ON d.order_id=o.id ORDER BY o.created_at DESC LIMIT 75').all();
   return json({orders:data.results||[],observedAt:now()});
  }
  if(action==='order'&&method==='GET'){
   const id=url.searchParams.get('orderId');if(!idValid(id))return json({error:'Pedido inválido.'},400);
   const result=await readSale(env,id);return result?json(result):json({error:'Pedido não encontrado.'},404);
  }
  if(!action.startsWith('notifications'))return json({error:'Endereço não encontrado.'},404);
  if(!session)return json({error:'Entre neste aparelho antes de ativar as notificações.'},401);
  if(action==='notifications'&&method==='GET'){
   const keys=await keysFor(env);
   const active=await env.DB.prepare('SELECT COUNT(*) AS count FROM admin_push_subscriptions WHERE device_id=? AND disabled=0').bind(session.id).first();
   let lastAttempt=null;
   try{lastAttempt=await env.DB.prepare('SELECT r.kind,r.state,r.phase,r.error_code AS code,r.provider_status AS providerStatus,r.provider_reason AS providerReason,r.attempt_id AS id,r.attempted_at AS attemptedAt FROM admin_push_attempt_results r JOIN admin_push_subscriptions s ON s.id=r.subscription_id WHERE s.device_id=? ORDER BY r.attempted_at DESC LIMIT 1').bind(session.id).first();}catch{}
   return json({publicKey:keys?.publicKey,active:!!active?.count,lastAttempt,expiresAt:session.expires_at,version:SALES_NOTIFICATIONS_VERSION});
  }
  if(action==='notifications/subscribe'&&method==='POST'){
   const raw=await bodyFor(request),subscription=validatePushSubscription(raw.subscription);
   await crypto.subtle.importKey('raw',fromBase64url(subscription.keys.p256dh),{name:'ECDH',namedCurve:'P-256'},false,[]);
   const endpointHash=await hash(subscription.endpoint),t=now();
   await env.DB.prepare('INSERT INTO admin_push_subscriptions(id,device_id,subscription_json,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET device_id=excluded.device_id,subscription_json=excluded.subscription_json,disabled=0,updated_at=excluded.updated_at')
    .bind(endpointHash,session.id,JSON.stringify(subscription),t,t).run();
   return json({ok:true});
  }
  if(action==='notifications/unsubscribe'&&method==='POST'){
   await env.DB.prepare('UPDATE admin_push_subscriptions SET disabled=1,updated_at=? WHERE device_id=?').bind(now(),session.id).run();
   return json({ok:true});
  }
  if(action==='notifications/test'&&method==='POST'){
   let sub,keys;const attemptId=crypto.randomUUID();
   try{sub=await env.DB.prepare('SELECT id,subscription_json FROM admin_push_subscriptions WHERE device_id=? AND disabled=0 ORDER BY updated_at DESC LIMIT 1').bind(session.id).first();keys=await keysFor(env);}
   catch{return json({error:'Não foi possível consultar o cadastro de notificações deste aparelho. Atualize o painel e tente novamente.',code:'PUSH_REGISTRATION_UNAVAILABLE',phase:'registration',attemptId},503);}
   if(!sub)return json({error:'Ative as notificações neste aparelho primeiro.'},409);
   try{
    let subscription;try{subscription=JSON.parse(sub.subscription_json);}catch{throw new WebPushError('PUSH_SUBSCRIPTION_INVALID','subscription','O cadastro de notificações deste aparelho precisa ser renovado.');}
    const sent=await sendWebPush(subscription,{title:'Streetball · Teste de notificação',body:'Os avisos de venda estão prontos neste aparelho. Toque para abrir suas vendas.',url:'/ops/',tag:'streetball-test'},keys);
    const failure=sent.accepted?null:pushFailure(sent);
    await saveAttempt(env,sub.id,{kind:'test',state:sent.accepted?'accepted':'failed',phase:failure?.phase||'provider',code:failure?.code,status:sent.status,reason:sent.reason,id:attemptId});
    if(sent.gone)await env.DB.prepare('UPDATE admin_push_subscriptions SET disabled=1,updated_at=? WHERE id=?').bind(now(),sub.id).run().catch(()=>{});
    return sent.accepted?json({ok:true,acceptedByPushService:true,attemptId}):json({error:failure.message,code:failure.code,phase:failure.phase,providerStatus:sent.status,providerReason:sent.reason||null,attemptId},502);
   }catch(error){
    const safe=error instanceof WebPushError?error:new WebPushError('PUSH_TEST_FAILED','preparation','Não foi possível preparar o teste de notificação. Atualize o painel e tente novamente.');
    await saveAttempt(env,sub.id,{kind:'test',state:'failed',phase:safe.phase,code:safe.code,id:attemptId});
    return json({error:safe.message,code:safe.code,phase:safe.phase,attemptId},503);
   }
  }
  return json({error:'Endereço não encontrado.'},404);
 }catch(error){
  if(/inválid|grandes|reconhecido/.test(error.message||''))return json({error:'Confira os dados de ativação das notificações.'},400);
  if(action==='notifications/test')return json({error:'Não foi possível conferir o acesso deste aparelho para enviar o teste. Atualize o painel e tente novamente.',code:'PUSH_SESSION_UNAVAILABLE',phase:'session'},503);
  if(action==='notifications')return json({error:'Não foi possível carregar a configuração dos avisos deste aparelho. Atualize o painel e tente novamente.',code:'PUSH_SETTINGS_UNAVAILABLE',phase:'settings'},503);
  return json({error:'Não foi possível consultar as vendas agora. Tente novamente.'},503);
 }
}

export async function readSale(env,id){
 const order=await env.DB.prepare('SELECT id,created_at,updated_at,status,name,city,state,items_json,total FROM orders WHERE id=?').bind(id).first();
 if(!order)return null;
 const available=await tables(env),reads=[];
 const first=(name,sql,args=[id])=>{if(available.has(name))reads.push({name,all:false,statement:env.DB.prepare(sql).bind(...args)});};
 const all=(name,sql,args=[id])=>{if(available.has(name))reads.push({name,all:true,statement:env.DB.prepare(sql).bind(...args)});};
 first('supplier_jobs','SELECT status,updated_at FROM supplier_jobs WHERE order_id=?');
 first('supplier_dispatch','SELECT state,sent_at,responded_at,details_sent_at,updated_at FROM supplier_dispatch WHERE order_id=?');
 first('order_payment_environments','SELECT environment,received_at FROM order_payment_environments WHERE order_id=?');
 first('supplier_payout_intents','SELECT state,bank_status,amount_cents,receipt_url,last_error,created_at,updated_at FROM supplier_payout_intents WHERE order_id=?');
 first('supplier_paid_order_records','SELECT source,recorded_at FROM supplier_paid_order_records WHERE order_id=?');
 first('supplier_payout_settings','SELECT enabled FROM supplier_payout_settings WHERE id=1',[]);
 first('supplier_billing_messages','SELECT state,created_at FROM supplier_billing_messages WHERE order_id=? AND linked=1 ORDER BY seq DESC LIMIT 1');
 first('wa_local_bridge','SELECT heartbeat_at FROM wa_local_bridge WHERE id=1',[]);
 all('admin_sale_events','SELECT kind,occurred_at FROM admin_sale_events WHERE order_id=?');
 all('supplier_attempts','SELECT a.supplier_id,a.state,a.updated_at,d.display_name FROM supplier_attempts a LEFT JOIN supplier_directory d ON d.id=a.supplier_id WHERE a.order_id=? ORDER BY a.created_at');
 all('order_tracking_events','SELECT id,stage,created_at FROM order_tracking_events WHERE order_id=? ORDER BY created_at DESC LIMIT 50');
 if(available.has('wa_local_groups'))all('wa_local_outbox',"SELECT g.id,g.purpose,g.created_at,COUNT(*) AS total,SUM(CASE WHEN o.state='sent' THEN 1 ELSE 0 END) AS sent,SUM(CASE WHEN o.state='uncertain' THEN 1 ELSE 0 END) AS uncertain,SUM(CASE WHEN o.state IN ('failed','cancelled','expired') THEN 1 ELSE 0 END) AS failed,MAX(o.updated_at) AS last_at FROM wa_local_groups g JOIN wa_local_outbox o ON o.group_id=g.id WHERE g.order_id=? AND g.preview=0 GROUP BY g.id ORDER BY g.created_at DESC LIMIT 50");
 // Coupon and commission are read from the order's frozen attribution, even if the seller is edited or excluded later.
 if(available.has('sales_attributions'))first('sales_attributions',`SELECT a.seller_id,a.coupon,a.commission_bps,a.commission_cents,a.discount_cents,a.net_cents,${available.has('sales_sellers')?'s.nickname,s.active AS seller_active,s.coupon AS seller_current_coupon':'NULL AS nickname,NULL AS seller_active,NULL AS seller_current_coupon'} FROM sales_attributions a ${available.has('sales_sellers')?'LEFT JOIN sales_sellers s ON s.id=a.seller_id':''} WHERE a.order_id=?`);
 const results=await env.DB.batch(reads.map(r=>r.statement));
 const data=Object.fromEntries(reads.map((r,i)=>[r.name,r.all?results[i].results:results[i].results[0]||null]));
 const progress=salesProgress({order,job:data.supplier_jobs,dispatch:data.supplier_dispatch,payment:data.order_payment_environments,
  payout:data.supplier_payout_intents,paidRecord:data.supplier_paid_order_records,billing:data.supplier_billing_messages,bridge:data.wa_local_bridge,
  events:data.admin_sale_events,messages:data.wa_local_outbox,attempts:data.supplier_attempts,payoutEnabled:data.supplier_payout_settings?data.supplier_payout_settings.enabled===1:null,tracking:(data.order_tracking_events||[]).map(t=>({...t,label:STAGES[t.stage]||t.stage})),localTransport:env.WA_TRANSPORT==='local'});
 const attribution=data.sales_attributions;
 return {...progress,sellerAttribution:attribution?{sellerId:attribution.seller_id,nickname:attribution.nickname||'Vendedor não disponível',coupon:attribution.coupon,commissionPercent:attribution.commission_bps/100,commissionCents:attribution.commission_cents,discountCents:attribution.discount_cents,revenueCents:attribution.net_cents,couponActive:attribution.seller_active===1&&attribution.seller_current_coupon===attribution.coupon}:null};
}

/** Store before acknowledging a payment webhook; retries reuse the same order event and deliveries. */
export async function recordSalePaymentEvent(env,orderId,eventName){
 if(env.ASAAS_SANDBOX==='true'||!['PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE'].includes(eventName))return false;
 if(!await salesNotificationsReady(env))return false;
 const t=now(),statements=[env.DB.prepare('INSERT OR IGNORE INTO admin_sale_events(order_id,kind,occurred_at) VALUES(?,?,?)').bind(orderId,eventName,t)];
 if(['PAYMENT_CONFIRMED','PAYMENT_RECEIVED'].includes(eventName)){
  statements.push(env.DB.prepare('INSERT OR IGNORE INTO admin_sale_notifications(order_id,created_at) VALUES(?,?)').bind(orderId,t));
  statements.push(env.DB.prepare("INSERT OR IGNORE INTO admin_push_deliveries(order_id,subscription_id,state,updated_at) SELECT n.order_id,s.id,'pending',? FROM admin_sale_notifications n JOIN orders o ON o.id=n.order_id JOIN admin_push_subscriptions s ON s.created_at<=n.created_at JOIN admin_sales_sessions d ON d.id=s.device_id WHERE n.order_id=? AND s.disabled=0 AND d.expires_at>? AND o.status NOT IN ('payment_refunded','payment_disputed')").bind(t,orderId,t));
 }
 if(['PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE'].includes(eventName))statements.push(env.DB.prepare("UPDATE admin_push_deliveries SET state='cancelled',updated_at=? WHERE order_id=? AND state='pending'").bind(t,orderId));
 await env.DB.batch(statements);return true;
}

export async function deliverSaleNotifications(env,{request=fetch,orderId}={}){
 if(!env.DB||env.ASAAS_SANDBOX==='true'||!await salesNotificationsReady(env))return;
 const keys=await keysFor(env);if(!keys)return;
 const t=now();
 await env.DB.prepare("UPDATE admin_push_deliveries SET state='pending',lease_until=NULL WHERE state='sending' AND lease_until<?").bind(t).run();
 const rows=(await env.DB.prepare("SELECT d.order_id,d.subscription_id,s.subscription_json FROM admin_push_deliveries d JOIN admin_push_subscriptions s ON s.id=d.subscription_id JOIN admin_sales_sessions a ON a.id=s.device_id JOIN orders o ON o.id=d.order_id WHERE d.state='pending' AND s.disabled=0 AND a.expires_at>? AND o.status NOT IN ('payment_refunded','payment_disputed') AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=?) AND (? IS NULL OR d.order_id=?) ORDER BY d.updated_at LIMIT 5").bind(t,t,orderId||null,orderId||null).all()).results;
 for(const row of rows){
  const claimed=await env.DB.prepare("UPDATE admin_push_deliveries SET state='sending',attempts=attempts+1,lease_until=?,updated_at=? WHERE order_id=? AND subscription_id=? AND state='pending' RETURNING attempts").bind(new Date(Date.now()+120000).toISOString(),now(),row.order_id,row.subscription_id).first();
  if(!claimed)continue;
  try{
   const topic=(await hash(row.order_id)).slice(0,32);
   const sent=await sendWebPush(JSON.parse(row.subscription_json),{title:'Streetball · Nova venda',body:'Pagamento confirmado. Toque para acompanhar o pedido '+row.order_id.slice(0,8)+'.',url:'/ops/?orderId='+row.order_id,tag:'sale-'+row.order_id},keys,{topic,request});
   const state=sent.accepted?'accepted':sent.gone?'unsubscribed':'pending';
   await env.DB.prepare('UPDATE admin_push_deliveries SET state=?,last_status=?,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE order_id=? AND subscription_id=?')
    .bind(state,sent.status,new Date(Date.now()+Math.min(3600,60*2**Math.min(claimed.attempts,6))*1000).toISOString(),now(),row.order_id,row.subscription_id).run();
   if(sent.gone)await env.DB.prepare('UPDATE admin_push_subscriptions SET disabled=1,updated_at=? WHERE id=?').bind(now(),row.subscription_id).run();
   const failure=sent.accepted?null:pushFailure(sent);
   await saveAttempt(env,row.subscription_id,{kind:'sale',state:sent.accepted?'accepted':'failed',phase:failure?.phase||'provider',code:failure?.code,status:sent.status,reason:sent.reason,id:crypto.randomUUID()});
  }catch(error){
   await env.DB.prepare("UPDATE admin_push_deliveries SET state='pending',lease_until=NULL,next_attempt_at=?,updated_at=? WHERE order_id=? AND subscription_id=?").bind(new Date(Date.now()+300000).toISOString(),now(),row.order_id,row.subscription_id).run();
   await saveAttempt(env,row.subscription_id,{kind:'sale',state:'failed',phase:error instanceof WebPushError?error.phase:'preparation',code:error instanceof WebPushError?error.code:'PUSH_DELIVERY_FAILED',id:crypto.randomUUID()});
  }
 }
}
