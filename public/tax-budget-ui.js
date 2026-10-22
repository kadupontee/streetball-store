import {quoteCustomerPays} from './tax-budget.js';
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
  const price=quoteCustomerPays({
   goodsUsd:numeric('goods'),freightUsd:numeric('freight'),insuranceUsd:numeric('insurance'),
   icmsRate:numeric('icms'),prcEligible:el('regime').value==='prc',
   usdToBrl:numeric('budgetFx'),carrierFeesBrl:numeric('budgetPostal'),
   operationsBrl:numeric('budgetOps'),riskRate:numeric('budgetReserve')/100,
   paymentRate:numeric('budgetPayment')/100,salesTaxRate:numeric('budgetBusinessTax')/100,
   targetMarginRate:numeric('budgetMargin')/100,salePriceBrl:currency('budgetSale')
  });
  rows.replaceChildren(
   addRow('Custo fornecedor + frete + seguro (loja)',money(price.merchantSupplierCostBrl)),
   addRow('Reserva para imprevistos da loja',money(price.merchantReserveBrl)),
   addRow('Custo operacional total da loja',money(price.merchantBaseCostBrl)),
   addRow('Preço mínimo estimado da loja (SEM imposto de importação)',money(price.suggestedPriceBrl)),
   addRow('Tributos de importação estimados ao cliente (fora do preço)',money(price.recipientEstimatedTaxesBrl)),
   addRow('Tributos + Despacho Postal estimados ao cliente',money(price.recipientEstimatedTotalFeesBrl)),
   ...(price.salePriceBrl!==undefined?[
    addRow('Resultado estimado da loja com preço informado',money(price.merchantContributionBrl)),
    addRow('Total ilustrativo cliente: loja + tributos posteriores',money(price.recipientIllustrativeCombinedOutlayBrl))
   ]:[])
  );
  notice.textContent=price.salePriceBrl!==undefined&&!price.meetsMarginGoal?
   'Seu preço planejado não atinge a margem pretendida. Reveja custos e a informação ao cliente antes de vender.':
   'A loja não recolhe esses impostos. O destinatário deve pagar eventuais cobranças somente pelos canais oficiais. Valores finais dependem da Receita e da transportadora.';
 }catch(error){
  rows.replaceChildren();notice.textContent=error.message;
 }
}
document.querySelectorAll('input,select').forEach(input=>input.addEventListener('input',budgetRender));
budgetRender();
