/** Financial planning only. No payment, official tax assessment, or automatic repricing. */
export function estimatedImportTaxes(goodsUsd,freightUsd,insuranceUsd,icmsRate,{prcEligible=false}={}){
 const amounts=[goodsUsd,freightUsd,insuranceUsd].map(Number);
 const rate=Number(icmsRate);
 if(amounts.some(n=>!Number.isFinite(n)||n<0||n>3000)||!Number.isFinite(rate)||rate<0||rate>=1)
  throw Error('Valores de importação ou ICMS inválidos.');
 const round=n=>Math.round((n+Number.EPSILON)*100)/100;
 const customsValueUsd=round(amounts.reduce((a,b)=>a+b,0));
 const importDutyUsd=round(prcEligible
  ? (customsValueUsd<=50?0:Math.max(0,customsValueUsd*.6-30))
  : customsValueUsd*.6);
 const icmsUsd=round((customsValueUsd+importDutyUsd)*rate/(1-rate));
 return {customsValueUsd,importDutyUsd,icmsUsd,landedUsd:round(customsValueUsd+importDutyUsd+icmsUsd)};
}
/** Minimum sell price for target fraction of sale revenue kept as contribution margin. */
export function quoteTaxesIncluded({goodsUsd,freightUsd,insuranceUsd=0,icmsRate=.2,
 usdToBrl,postalFeesBrl=0,operationsBrl=0,riskRate=0,
 paymentRate=0,salesTaxRate=0,targetMarginRate=0,prcEligible=false,salePriceBrl=null}){
 const money=[usdToBrl,postalFeesBrl,operationsBrl].map(Number);
 const ratios=[riskRate,paymentRate,salesTaxRate,targetMarginRate].map(Number);
 if(money.some(n=>!Number.isFinite(n)||n<0||n>100000)||
    ratios.some(n=>!Number.isFinite(n)||n<0||n>=1)||
    money[0]<=0||ratios[1]+ratios[2]+ratios[3]>=1)
  throw Error('Cotação, despesas ou margens inválidas.');
 const tax=estimatedImportTaxes(goodsUsd,freightUsd,insuranceUsd,icmsRate,{prcEligible});
 const importCostBrl=tax.landedUsd*money[0];
 const contingencyBrl=importCostBrl*ratios[0];
 const costBeforeSalesBrl=importCostBrl+contingencyBrl+money[1]+money[2];
 const minimumSaleBrl=costBeforeSalesBrl/(1-ratios[1]-ratios[2]-ratios[3]);
 const result={...tax,usdToBrl:money[0],importCostBrl,contingencyBrl,costBeforeSalesBrl,
 minimumSaleBrl,shippingIncludedInCustomsValue:true,assumesStorePaysAllImportCharges:true,
 feesExcluded:['Impostos ou obrigações adicionais não informados','Taxas de devolução e despesas inesperadas']};
 if(salePriceBrl!==null){
  const price=Number(salePriceBrl);
  if(!Number.isFinite(price)||price<0||price>100000)throw Error('Preço de venda inválido');
  result.salePriceBrl=price;
  result.contributionBrl=price*(1-ratios[1]-ratios[2])-costBeforeSalesBrl;
  result.contributionRate=price>0?result.contributionBrl/price:null;
  result.meetsTargetMargin=result.contributionBrl>=price*ratios[3];
 }
 return result;
}

/** Opção B: a loja NÃO recebe nem recolhe tributos aduaneiros do comprador.
 * Projeção apenas informativa: o valor real é determinado pela autoridade.
 */
export function quoteCustomerPays({goodsUsd,freightUsd,insuranceUsd=0,icmsRate=.2,
 usdToBrl,carrierFeesBrl=0,operationsBrl=0,riskRate=0,
 paymentRate=0,salesTaxRate=0,targetMarginRate=0,prcEligible=false,salePriceBrl=null}){
 const amounts=[goodsUsd,freightUsd,insuranceUsd,usdToBrl,carrierFeesBrl,operationsBrl].map(Number);
 const ratios=[riskRate,paymentRate,salesTaxRate,targetMarginRate].map(Number);
 if(amounts.some(x=>!Number.isFinite(x)||x<0||x>100000)||Number(usdToBrl)<=0||
  ratios.some(x=>!Number.isFinite(x)||x<0||x>=1)||
  ratios[1]+ratios[2]+ratios[3]>=1)
  throw Error('Câmbio, despesas ou margens inválidas.');
 const tax=estimatedImportTaxes(goodsUsd,freightUsd,insuranceUsd,icmsRate,{prcEligible});
 const merchantSupplierCostBrl=tax.customsValueUsd*Number(usdToBrl);
 const merchantReserveBrl=merchantSupplierCostBrl*Number(riskRate);
 const merchantBaseCostBrl=merchantSupplierCostBrl+merchantReserveBrl+Number(operationsBrl);
 const suggestedPriceBrl=merchantBaseCostBrl/(1-Number(paymentRate)-Number(salesTaxRate)-Number(targetMarginRate));
 const recipientEstimatedTaxesBrl=(tax.importDutyUsd+tax.icmsUsd)*Number(usdToBrl);
 const recipientEstimatedTotalFeesBrl=recipientEstimatedTaxesBrl+Number(carrierFeesBrl);
 const result={merchantSupplierCostBrl,merchantReserveBrl,merchantBaseCostBrl,suggestedPriceBrl,
  recipientEstimatedTaxesBrl,recipientEstimatedTotalFeesBrl,
  merchantPaysCustomsTaxes:false,prcEligibleAssumed:prcEligible,
  estimationOnly:true};
 if(salePriceBrl!==null){
  const sale=Number(salePriceBrl);
  if(!Number.isFinite(sale)||sale<0||sale>100000)throw Error('Preço de venda inválido');
  result.salePriceBrl=sale;
  result.merchantContributionBrl=sale*(1-Number(paymentRate)-Number(salesTaxRate))-merchantBaseCostBrl;
  result.recipientIllustrativeCombinedOutlayBrl=sale+recipientEstimatedTotalFeesBrl;
  result.meetsMarginGoal=result.merchantContributionBrl>=sale*Number(targetMarginRate);
 }
 return result;
}
