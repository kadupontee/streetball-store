import {getCustomerSession} from './customer-accounts.js';
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const cents=x=>Math.round((Number(x)+Number.EPSILON)*100);
const stamp=()=>new Date().toISOString();
const schema=[
`CREATE TABLE IF NOT EXISTS sales_sellers(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL UNIQUE,email TEXT NOT NULL UNIQUE,nickname TEXT NOT NULL,coupon TEXT NOT NULL UNIQUE,commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 2500),active INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS sales_attributions(order_id TEXT PRIMARY KEY REFERENCES orders(id),seller_id TEXT NOT NULL REFERENCES sales_sellers(id),coupon TEXT NOT NULL,commission_bps INTEGER NOT NULL,gross_cents INTEGER NOT NULL,discount_cents INTEGER NOT NULL,net_cents INTEGER NOT NULL,commission_cents INTEGER NOT NULL,created_at TEXT NOT NULL)`,
`CREATE INDEX IF NOT EXISTS sales_attributions_seller ON sales_attributions(seller_id)`,
`CREATE TABLE IF NOT EXISTS sales_commission_settlements(order_id TEXT PRIMARY KEY REFERENCES sales_attributions(order_id),paid_cents INTEGER NOT NULL,paid_at TEXT NOT NULL)`
];
export async function sellerSchema(env){
 await env.DB.batch(schema.map(sql=>env.DB.prepare(sql)));
 const columns=(await env.DB.prepare('PRAGMA table_info(sales_sellers)').all()).results||[];
 if(!columns.some(c=>c.name==='deleted_at'))try{await env.DB.prepare('ALTER TABLE sales_sellers ADD COLUMN deleted_at TEXT').run()}catch(e){
  const current=(await env.DB.prepare('PRAGMA table_info(sales_sellers)').all()).results||[];
  if(!current.some(c=>c.name==='deleted_at'))throw e;
 }
}
async function ready(env){return !!env.DB&&!!await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sales_sellers'").first();}
export async function sellerCoupon(env,code,subtotal){
 if(!code)return null;
 if(typeof code!=='string'||!/^[-A-Za-z0-9_]{2,32}$/.test(code)||!await ready(env))throw Error('Cupom inválido ou indisponível.');
 const seller=await env.DB.prepare('SELECT id,coupon,commission_bps FROM sales_sellers WHERE coupon=? AND active=1').bind(code.toUpperCase()).first();
 if(!seller)throw Error('Cupom inválido ou indisponível.');
 const gross=cents(subtotal),discount=Math.round(gross*0.05),net=gross-discount;
 return {sellerId:seller.id,coupon:seller.coupon,commissionBps:seller.commission_bps,grossCents:gross,discountCents:discount,netCents:net,commissionCents:Math.round(net*seller.commission_bps/10000)};
}
export async function attachSeller(env,orderId,quote){
 if(!quote)return;
 await env.DB.prepare('INSERT INTO sales_attributions(order_id,seller_id,coupon,commission_bps,gross_cents,discount_cents,net_cents,commission_cents,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(orderId,quote.sellerId,quote.coupon,quote.commissionBps,quote.grossCents,quote.discountCents,quote.netCents,quote.commissionCents,stamp()).run();
}
async function rows(env,sellerId){
 const hasEvents=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_sale_events'").first();
 if(!hasEvents)return [];
 const result=await env.DB.prepare(`SELECT a.*,o.status,p.paid_cents,p.paid_at,EXISTS(SELECT 1 FROM admin_sale_events e WHERE e.order_id=a.order_id AND e.kind='PAYMENT_RECEIVED') AS received FROM sales_attributions a JOIN orders o ON o.id=a.order_id LEFT JOIN sales_commission_settlements p ON p.order_id=a.order_id ${sellerId?'WHERE a.seller_id=?':''} ORDER BY a.created_at DESC`).bind(...(sellerId?[sellerId]:[])).all();
 return result.results||[];
}
export function sellerTotals(orders){
 let revenue=0,earned=0,paid=0,sales=0;
 for(const row of orders){paid+=row.paid_cents||0;if(row.received&&!['payment_refunded','payment_disputed'].includes(row.status)){revenue+=row.net_cents;earned+=row.commission_cents;sales++;}}
 return {revenueCents:revenue,earnedCents:earned,paidCents:paid,dueCents:earned-paid,sales};
}
export async function sellerAdmin(request,env,action){
 if(!['sellers','sellers/save','sellers/delete','sellers/settle'].includes(action))return null;
 await sellerSchema(env);
 if(action==='sellers'&&request.method==='GET'){
  const sellers=(await env.DB.prepare('SELECT id,email,nickname,coupon,commission_bps,active,deleted_at FROM sales_sellers').all()).results||[];
  const all=await rows(env);
  return json({sellers:sellers.map(s=>({...s,...sellerTotals(all.filter(a=>a.seller_id===s.id))})).sort((a,b)=>b.revenueCents-a.revenueCents||b.sales-a.sales||a.nickname.localeCompare(b.nickname)),orders:all,discountPercent:5});
 }
 if(request.method!=='POST')return json({error:'Método inválido.'},405);
 const raw=await request.text();if(raw.length>4000)return json({error:'Dados muito grandes.'},413);
 let body;try{body=JSON.parse(raw);}catch{return json({error:'Dados inválidos.'},400);}
 if(action==='sellers/delete'){
  const seller=await env.DB.prepare('SELECT id FROM sales_sellers WHERE id=?').bind(String(body.id||'')).first();
  if(!seller)return json({error:'Vendedor não encontrado.'},404);
  // Preserve frozen order attributions and settlement history; revoke coupon and seller access.
  await env.DB.prepare('UPDATE sales_sellers SET active=0,deleted_at=?,updated_at=? WHERE id=?').bind(stamp(),stamp(),seller.id).run();
  return json({ok:true});
 }
 if(action==='sellers/save'){
  const email=String(body.email||'').trim().toLowerCase(),nickname=String(body.nickname||'').trim(),coupon=String(body.coupon||'').trim().toUpperCase(),bps=Number(body.commissionPercent)*100;
  if(!/^\S+@\S+\.\S+$/.test(email)||email.length>180||nickname.length<2||nickname.length>60||!/^[-A-Z0-9_]{2,32}$/.test(coupon)||!Number.isInteger(bps)||bps<0||bps>2500||typeof body.active!=='boolean')return json({error:'Confira e-mail, apelido, cupom e comissão de 0% a 25%.'},400);
  if(body.id&&!await env.DB.prepare('SELECT id FROM sales_sellers WHERE id=?').bind(body.id).first())return json({error:'Vendedor não encontrado.'},404);
  let account;try{account=await env.DB.prepare('SELECT id FROM customer_accounts WHERE email=?').bind(email).first()}catch{}
  if(!account)return json({error:'O vendedor precisa criar sua conta na loja antes do cadastro.'},400);
  const id=body.id||crypto.randomUUID();
  try{await env.DB.prepare('INSERT INTO sales_sellers(id,customer_id,email,nickname,coupon,commission_bps,active,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,email=excluded.email,nickname=excluded.nickname,coupon=excluded.coupon,commission_bps=excluded.commission_bps,active=excluded.active,deleted_at=NULL,updated_at=excluded.updated_at').bind(id,account.id,email,nickname,coupon,bps,body.active?1:0,stamp()).run();}catch{return json({error:'E-mail ou cupom já cadastrado.'},409);}
  return json({ok:true,id});
 }
 if(action==='sellers/settle'){
  const order=(await rows(env)).find(r=>r.order_id===body.orderId);
  if(!order||!order.received||['payment_refunded','payment_disputed'].includes(order.status))return json({error:'Comissão não disponível para baixa.'},409);
  await env.DB.prepare('INSERT OR IGNORE INTO sales_commission_settlements(order_id,paid_cents,paid_at) VALUES(?,?,?)').bind(order.order_id,order.commission_cents,stamp()).run();
  return json({ok:true});
 }
 return json({error:'Método inválido.'},405);
}
export async function sellerRoute(request,env){
 const path=new URL(request.url).pathname;
 if(path==='/api/seller/coupon'&&request.method==='POST'){
  const raw=await request.text();if(raw.length>1000)return json({error:'Dados inválidos.'},413);
  try{const b=JSON.parse(raw),q=await sellerCoupon(env,b.coupon,100);return q?json({coupon:q.coupon,discountPercent:5}):json({error:'Informe o cupom.'},400);}catch{return json({error:'Cupom inválido ou indisponível.'},400);}
 }
 if(path!=='/api/seller/me'||request.method!=='GET')return json({error:'Endereço inválido.'},404);
 let user;try{user=await getCustomerSession(request,env);}catch{}
 if(!user)return json({error:'Entre na sua conta para consultar as comissões.'},401);
 if(!await ready(env))return json({error:'Acesso de vendedor não cadastrado.'},403);
 const seller=await env.DB.prepare('SELECT id,nickname,coupon,commission_bps FROM sales_sellers WHERE customer_id=? AND active=1').bind(user.id).first();
 if(!seller)return json({error:'Acesso de vendedor não cadastrado.'},403);
 const orders=await rows(env,seller.id);
 return json({seller,...sellerTotals(orders),orders:orders.map(r=>({orderId:r.order_id,createdAt:r.created_at,status:r.status,received:!!r.received,revenueCents:r.net_cents,commissionCents:r.commission_cents,commissionPercent:r.commission_bps/100,paidCents:r.paid_cents||0}))});
}
