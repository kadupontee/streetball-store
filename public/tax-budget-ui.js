import {quoteTaxesIncluded} from './tax-budget.js';
const el=id=>document.getElementById(id);
const money=value=>'R$ '+Number(value).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const addRow=(label,value)=>{
 const tr=document.createElement('tr'),name=document.createElement('td'),amount=document.createElement('td');
 name.textContent=label;amount.textContent=value;tr.append(name,amount);return tr;
};
const numeric=id=>el(id).value.trim()===''?NaN:Number(el(id).value);
const currency=id=>el(id).value.trim()===''?null:Number(el(id).value);
function budgetRender(){
 const rows=el('budgetRows'),notice=el('budgetNotice');
 const required=['budgetFx','budgetPayment','budgetBusinessTax','budgetMargin'];
 if(required.some(id=>el(id).value.trim()==='')){
  rows.replaceChildren();
  notice.textContent='Preencha câmbio, taxa de cobrança, tributos sobre faturamento e margem com seus valores reais.';
  return;
 }
 try{
  const price=quoteTaxesIncluded({
   goodsUsd:numeric('goods'),freightUsd:numeric('freight'),insuranceUsd:numeric('insurance'),
   icmsRate:numeric('icms'),prcEligible:el('regime').value==='prc',
   usdToBrl:numeric('budgetFx'),postalFeesBrl:numeric('budgetPostal'),
   operationsBrl:numeric('budgetOps'),riskRate:numeric('budgetReserve')/100,
   paymentRate:numeric('budgetPayment')/100,salesTaxRate:numeric('budgetBusinessTax')/100,
   targetMarginRate:numeric('budgetMargin')/100,salePriceBrl:currency('budgetSale')
  });
  rows.replaceChildren(
   addRow('Custo importado em reais (produto, frete, impostos e seguro)',money(price.importCostBrl)),
   addRow('Reserva adicional contra variações',money(price.contingencyBrl)),
   addRow('Custo total reservado antes das taxas sobre a venda',money(price.costBeforeSalesBrl)),
   addRow('Preço mínimo estimado para a margem desejada',money(price.minimumSaleBrl)),
   ...(price.salePriceBrl!==undefined?[
    addRow('Resultado estimado com seu preço planejado',money(price.contributionBrl)),
    addRow('Margem estimada com seu preço planejado',
     (100*price.contributionRate).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%')
   ]:[])
  );
  notice.textContent=price.salePriceBrl!==undefined&&!price.meetsTargetMargin?
   'Seu preço planejado NÃO atinge a margem alvo com essas premissas. Revise valores antes de vender.':
   'Cálculo de planejamento. Não altera o catálogo. Revise preços do fornecedor, custos e o enquadramento fiscal com contador.';
 }catch(error){
  rows.replaceChildren();notice.textContent=error.message;
 }
}
document.querySelectorAll('input,select').forEach(input=>input.addEventListener('input',budgetRender));
budgetRender();
