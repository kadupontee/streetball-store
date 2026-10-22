/** Texto da consulta inicial que acompanha a foto do produto (sem perguntas extras). */
const oneLine=(value,limit=100)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,limit);
const quantityLabel=q=>q===1?'1 unidade':q+' unidades';
const sizeLabel=v=>{
 const size=oneLine(v,16);
 return size.toUpperCase()==='P'||size.toUpperCase()==='S'?'P (S)':size;
};
export const TEMPLATE_BODY_FEWER_THAN_3=`Produto: {{1}}

Detalhes:

* Foto do produto: enviada em anexo
* Tamanho: {{2}}
* Quantidade: {{3}}
* Personalização: {{4}}
* Patch: {{5}}
* Entrega: {{6}}

Sei que vocês oferecem frete grátis para pedidos de 3 peças ou mais, mas gostaria de comprar apenas {{7}} mesmo, pagando o frete correspondente.`;
export const TEMPLATE_BODY_3_OR_MORE=`Produto: {{1}}

Detalhes:

* Foto do produto: enviada em anexo
* Tamanho: {{2}}
* Quantidade: {{3}}
* Personalização: {{4}}
* Patch: {{5}}
* Entrega: {{6}}

Sei que vocês oferecem frete grátis para pedidos de 3 peças ou mais e gostaria de comprar exatamente {{7}}, mantendo essa quantidade.`;
const render=(template,values)=>template.replace(/\{\{([1-7])\}\}/g,(_,index)=>values[Number(index)-1]);
/**
 * Uma consulta por produto com a foto original no cabeçalho.
 * Se houver mais de um modelo, não fingir que a foto do primeiro representa tudo.
 * O caller envia pedidos com vários modelos à revisão manual até integrar várias fotos.
 */
export function supplierPhotoRequest(order){
 const items=JSON.parse(order?.items_json||'[]');
 if(items.length!==1)return null;
 const item=items[0];
 const q=Number(item.qty);
 const city=oneLine(order.city,90);
 if(!Number.isInteger(q)||q<1||!city||!oneLine(item.title)||!oneLine(item.size))return null;
 const qty=quantityLabel(q);
 const personalization=item.personalize===true
  ? 'Sim'+(item.customName||item.customNumber?' ('+[oneLine(item.customName,14),oneLine(item.customNumber,3)].filter(Boolean).join(' / ')+')':'')
  : 'Não';
 const args=[
  oneLine(item.title,100),
  sizeLabel(item.size),
  qty,
  personalization,
  item.patch===true?'Sim':'Não',
  city+', Brasil',
  qty
 ];
 const variant=q<3?'fewer_than_3':'three_or_more';
 const template=variant==='fewer_than_3'?TEMPLATE_BODY_FEWER_THAN_3:TEMPLATE_BODY_3_OR_MORE;
 return {args,variant,text:render(template,args)};
}
