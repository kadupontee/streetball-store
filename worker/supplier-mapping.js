/**
 * Streetball Store — vinculação segura dos produtos a fornecedores.
 * Fonte da verdade: D1; nunca deduza fornecedor só por nome de clube, foto ou preço.
 * Sem envios externos, segredos ou números de WhatsApp neste módulo.
 */
export const supplierIdValid = id => /^[a-z][a-z0-9_-]{1,39}$/.test(String(id||''));
export const productIdValid = id => /^[a-zA-Z0-9_-]{3,90}$/.test(String(id||''));

export async function resolveMappedItems(env,items){
  if(!Array.isArray(items)||!items.length||!env?.DB)return items;
  const ids=[...new Set(items.map(i=>String(i.id||'')).filter(productIdValid))];
  if(!ids.length)return items;
  // Se as tabelas ainda não estiverem migradas, não deduza um destinatário.
  let rows;
  try{
    rows=await env.DB.prepare(
      'SELECT product_id, supplier_id FROM supplier_product_map WHERE product_id IN ('+
      ids.map(()=>'?').join(',')+')'
    ).bind(...ids).all();
  }catch(e){
    console.error('Supplier mapping unavailable:',e?.message);
    return items.map(i=>({...i,supplierId:''}));
  }
  const matched=new Map((rows.results||[]).map(r=>[r.product_id,r.supplier_id]));
  // Apenas a associação revisada no D1 pode designar fornecedor.
  return items.map(item=>({...item,supplierId:matched.get(String(item.id))||''}));
}
