import table from '../scripts/costs.json' with {type:'json'};
import {apparelPriceMode} from '../public/store-settings.js';

export const SUPPLIER_COST_VERSION=table.shared_supplier_policy?.version||'unconfigured';
const approved=table.currency==='USD'&&table.shared_supplier_policy?.owner_confirmed===true&&table.shared_supplier_policy?.scope==='five_registered_suppliers';
const now=()=>new Date().toISOString();
const idValid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
const cents=value=>{
 if(!['string','number'].includes(typeof value)||String(value).length>32||!/^\d+(?:\.\d{1,2})?$/.test(String(value)))return null;
 const [whole,part='']=String(value).split('.');return BigInt(whole)*100n+BigInt(part.padEnd(2,'0'));
};
const usd=value=>value===null?null:(value/100n)+'.'+String(value%100n).padStart(2,'0');

/** Products come exclusively from the server's validated catalog, never from a supplier message. */
export function sharedSupplierCostReference(items,products){
 const result={version:SUPPLIER_COST_VERSION,currency:'USD',complete:false,items:[],quantity:0,
  goodsUsd:null,freightUsd:null,totalUsd:null,issues:[]};
 if(!approved){result.issues.push('A tabela de compra compartilhada ainda não foi confirmada.');return result;}
 if(!Array.isArray(items)||!items.length||!Array.isArray(products)){result.issues.push('Itens ou classificação de compra ausentes.');return result;}
 const catalog=new Map(products.filter(Boolean).map(p=>[p.id,p]));let goods=0n;
 for(const item of items){
  const product=catalog.get(item?.id),qty=item?.qty,kind=product?.kind;
  if(!product||!Number.isSafeInteger(qty)||qty<1||!Array.isArray(product.sizes)||!product.sizes.includes(item.size)){
   result.issues.push('Produto, quantidade ou tamanho não confirmado no catálogo do pedido.');continue;
  }
  result.quantity+=qty;
  if(!Number.isSafeInteger(result.quantity)){result.issues.push('Quantidade inválida.');continue;}
  if((product.apparelPriceReviewRequired===true&&!product.kindLocked)||
   (apparelPriceMode(product)&&!['jacket','coat','blouse'].includes(kind))){
   result.issues.push('A classificação de compra de '+item.id+' precisa ser confirmada.');continue;
  }
  let base=cents(table.supplier_usd[kind]);
  if(base===null||base<=0n){result.issues.push('O custo exato de '+item.id+' ('+String(kind||'tipo ausente')+') precisa ser confirmado.');continue;}
  if((item.patch!==undefined&&typeof item.patch!=='boolean')||(item.personalize!==undefined&&typeof item.personalize!=='boolean')){
   result.issues.push('Adicionais de compra inválidos.');continue;
  }
  const offer=items.length===1?table.promotions_usd?.find(p=>p.kind===kind&&p.quantity===qty):null;
  const promotionBase=offer?cents(offer.goods_usd):null;
  if(promotionBase!==null&&promotionBase%BigInt(qty)===0n)base=promotionBase/BigInt(qty);
  const size=cents(Object.hasOwn(table.size_extra_usd,item.size)?table.size_extra_usd[item.size]:0),patch=item.patch?cents(table.additions_usd.patch):0n;
  const personal=item.personalize?cents(table.additions_usd.personalization):0n;
  if([size,patch,personal].includes(null)){result.issues.push('Adicionais de compra não confirmados.');continue;}
  const unit=base+size+patch+personal,line=unit*BigInt(qty);goods+=line;
  result.items.push({productId:item.id,qty,kind,size:item.size,patch:item.patch===true,personalize:item.personalize===true,
   baseUnitUsd:usd(base),sizeExtraUsd:usd(size),patchUnitUsd:usd(patch),personalizationUnitUsd:usd(personal),
   unitUsd:usd(unit),lineUsd:usd(line)});
 }
 if(result.items.length!==items.length||goods>BigInt(Number.MAX_SAFE_INTEGER))return result;
 const freight=cents(result.quantity===1?table.shipping_usd.one_piece:result.quantity===2?table.shipping_usd.two_pieces:table.shipping_usd.three_or_more);
 result.goodsUsd=usd(goods);result.freightUsd=usd(freight);result.totalUsd=usd(goods+freight);
 // Bulk promotions need their eligibility confirmed; do not silently pay a regular price instead.
 if(items.length>1&&items.some(item=>catalog.get(item.id)?.kind==='fan')&&result.quantity>=10){
  result.issues.push('Conferir a aplicação da promoção em um lote com várias linhas antes de fechar o custo.');
 }
 result.complete=result.issues.length===0;
 return result;
}

export async function sharedCostSchemaAvailable(env){
 if(!env.DB)return false;
 return !!await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='supplier_order_cost_references'").first();
}

/** Optional to checkout availability; a missing reference always blocks later shared-cost auditing. */
export async function recordSharedSupplierCostReference(env,orderId,items,products){
 if(!env.DB||!idValid(orderId))return false;
 const reference=sharedSupplierCostReference(items,products);
 try{
  const saved=await env.DB.prepare('INSERT OR IGNORE INTO supplier_order_cost_references(order_id,policy_version,reference_json,created_at) VALUES(?,?,?,?)')
   .bind(orderId,SUPPLIER_COST_VERSION,JSON.stringify(reference),now()).run();
  return (saved?.meta?.changes||0)>0;
 }catch{return false;}
}

export async function sharedSupplierCostStatus(env){
 const available=await sharedCostSchemaAvailable(env);
 if(!available||!approved)return {available,version:SUPPLIER_COST_VERSION,configured:false,suppliers:0};
 const policy=await env.DB.prepare('SELECT policy_version FROM supplier_cost_policy_approvals WHERE policy_version=?').bind(SUPPLIER_COST_VERSION).first();
 const count=policy?await env.DB.prepare('SELECT COUNT(*) AS count FROM supplier_shared_cost_scope s JOIN supplier_contacts c ON c.supplier_id=s.supplier_id WHERE s.policy_version=? AND c.authorized=1').bind(SUPPLIER_COST_VERSION).first():null;
 return {available:true,version:SUPPLIER_COST_VERSION,configured:!!policy,suppliers:count?.count||0};
}

/** One-time enrollment of the existing authorized contacts, following the owner's shared-table instruction. */
export async function configureSharedSupplierCosts(env,version){
 if(!approved||version!==SUPPLIER_COST_VERSION||!await sharedCostSchemaAvailable(env))return null;
 const status=await sharedSupplierCostStatus(env);if(status.configured)return status;
 const contacts=await env.DB.prepare('SELECT c.supplier_id,c.phone_e164 FROM supplier_contacts c JOIN supplier_directory d ON d.id=c.supplier_id ORDER BY d.created_at,d.id LIMIT 6').all();
 if(!contacts.results?.length||contacts.results.length>5)return null;
 const t=now();
 const statements=contacts.results.map(c=>env.DB.prepare('INSERT OR IGNORE INTO supplier_shared_cost_scope(policy_version,supplier_id,supplier_phone,created_at) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM supplier_cost_policy_approvals WHERE policy_version=?)')
  .bind(SUPPLIER_COST_VERSION,c.supplier_id,c.phone_e164,t,SUPPLIER_COST_VERSION));
 statements.push(env.DB.prepare('INSERT OR IGNORE INTO supplier_cost_policy_approvals(policy_version,created_at) VALUES(?,?)').bind(SUPPLIER_COST_VERSION,t));
 await env.DB.batch(statements);return await sharedSupplierCostStatus(env);
}

/** Verify an immutable checkout reference against the current order and current authorized supplier. */
export async function loadSharedSupplierCosts(env,order){
 if(!approved||!order||!await sharedCostSchemaAvailable(env))return null;
 const scope=await env.DB.prepare('SELECT s.supplier_id FROM supplier_shared_cost_scope s JOIN supplier_cost_policy_approvals a ON a.policy_version=s.policy_version JOIN supplier_dispatch d ON d.supplier_id=s.supplier_id JOIN supplier_contacts c ON c.supplier_id=s.supplier_id WHERE d.order_id=? AND s.policy_version=? AND c.phone_e164=d.supplier_phone AND c.authorized=1').bind(order.id,SUPPLIER_COST_VERSION).first();
 if(!scope)return null;
 const saved=await env.DB.prepare('SELECT policy_version,reference_json FROM supplier_order_cost_references WHERE order_id=?').bind(order.id).first();
 if(saved?.policy_version!==SUPPLIER_COST_VERSION)return null;
 let reference,items;try{reference=JSON.parse(saved.reference_json);items=JSON.parse(order.items_json);}catch{return null;}
 if(reference.version!==SUPPLIER_COST_VERSION||reference.complete!==true||reference.issues?.length||
  !Array.isArray(items)||!Array.isArray(reference.items)||reference.items.length!==items.length)return null;
 if(!reference.items.every((line,i)=>line.productId===items[i]?.id&&line.qty===items[i].qty&&line.size===items[i].size&&
  line.patch===(items[i].patch===true)&&line.personalize===(items[i].personalize===true)))return null;
 const captured=new Map();
 for(const line of reference.items){
  const prior=captured.get(line.productId);
  if(prior&&prior.kind!==line.kind)return null;
  captured.set(line.productId,{id:line.productId,kind:line.kind,kindLocked:true,sizes:[...new Set([...(prior?.sizes||[]),line.size])]});
 }
 const expected=sharedSupplierCostReference(items,[...captured.values()]);
 if(!expected.complete||JSON.stringify(expected.items)!==JSON.stringify(reference.items)||
  ['quantity','goodsUsd','freightUsd','totalUsd'].some(key=>expected[key]!==reference[key]))return null;
 return reference;
}

/** The administrator still supplies independently checked FX, charges, other costs and payee. */
export function applySharedSupplierCosts(costs,reference){
 if(!reference?.complete||!costs||typeof costs!=='object'||Array.isArray(costs))return null;
 if(costs.items!==undefined&&(!Array.isArray(costs.items)||costs.items.length!==reference.items.length||
  !costs.items.every((line,i)=>line.productId===reference.items[i].productId&&line.qty===reference.items[i].qty&&cents(line.unitUsd)===cents(reference.items[i].unitUsd))))return null;
 if(costs.freightUsd!==undefined&&cents(costs.freightUsd)!==cents(reference.freightUsd))return null;
 return {...costs,items:reference.items.map(line=>({productId:line.productId,qty:line.qty,unitUsd:line.unitUsd})),freightUsd:reference.freightUsd};
}
