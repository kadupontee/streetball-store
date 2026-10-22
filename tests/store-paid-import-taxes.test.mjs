import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {estimatedImportTaxes,quoteCustomerPays} from '../public/tax-budget.js';
import {STAGES,formatProgress} from '../worker/order-progress.js';
import {readFileSync} from 'node:fs';

test('compras de US$ 15 fora do Remessa Conforme pagam II e ICMS, não são isentas',()=>{
 const r=estimatedImportTaxes(11,4,0,.2);
 assert.equal(r.customsValueUsd,15);
 assert.equal(r.importDutyUsd,9);
 assert.equal(r.icmsUsd,6);
 assert.equal(r.landedUsd,30);
});
test('alíquota zero do II até US$ 50 é apenas cenário PRC elegível',()=>{
 const prc=estimatedImportTaxes(11,4,0,.2,{prcEligible:true});
 assert.equal(prc.importDutyUsd,0);
 assert.equal(prc.icmsUsd,3.75);
});
test('opção B separa custo da loja de tributos e taxas aduaneiras do destinatário',()=>{
 const quote=quoteCustomerPays({
  goodsUsd:11,freightUsd:4,usdToBrl:5.5,icmsRate:.2,carrierFeesBrl:15,
  operationsBrl:5,riskRate:.1,paymentRate:.05,salesTaxRate:.06,
  targetMarginRate:.25,salePriceBrl:200
 });
 assert.equal(quote.merchantSupplierCostBrl,82.5);
 assert.equal(quote.merchantReserveBrl,8.25);
 assert.equal(quote.merchantBaseCostBrl,95.75);
 assert.equal(quote.recipientEstimatedTaxesBrl,82.5);
 assert.equal(quote.recipientEstimatedTotalFeesBrl,97.5);
 assert.equal(quote.recipientIllustrativeCombinedOutlayBrl,297.5);
 assert.equal(quote.merchantPaysCustomsTaxes,false);
 assert.ok(quote.suggestedPriceBrl>140);
 assert.equal(quote.meetsMarginGoal,true);
});
test('calculadora valida câmbio, porcentagens e valores',()=>{
 assert.throws(()=>quoteCustomerPays({goodsUsd:11,freightUsd:4,usdToBrl:0}),/inválid/);
 assert.throws(()=>quoteCustomerPays({goodsUsd:11,freightUsd:4,usdToBrl:5,
  paymentRate:.5,salesTaxRate:.3,targetMarginRate:.3}),/inválid/);
});
test('nova opção B só é liberável após validação tributária e de divulgação',async()=>{
 const req=new Request('https://example.com/api/checkout/config');
 const env={DB:{},ASSETS:{},ASAAS_API_KEY:'ficticio',SHIPPING_FLAT_BRL:'20',
  SALES_ENABLED:'true',ASAAS_SANDBOX:'false',PAYMENTS_PRODUCTION_ENABLED:'true',
  CUSTOMER_PAYS_IMPORT_TAXES:'true',IMPORT_TAX_DISCLOSURE_APPROVED:'false',IMPORT_COMPLIANCE_APPROVED:'false'};
 let data=await (await worker.fetch(req,env)).json();
 assert.equal(data.enabled,false);
 assert.equal(data.customerPaysImportTaxesPlanned,true);
 assert.equal(data.productionImportComplianceReviewed,false);
 data=await (await worker.fetch(req,{...env,IMPORT_TAX_DISCLOSURE_APPROVED:'true'})).json();
 assert.equal(data.enabled,false);
 data=await (await worker.fetch(req,{...env,IMPORT_TAX_DISCLOSURE_APPROVED:'true',IMPORT_COMPLIANCE_APPROVED:'true'})).json();
 assert.equal(data.enabled,true);
});
test('checkout em produção exige confirmação expressa dos tributos',async()=>{
 const env={DB:{},ASSETS:{},ASAAS_API_KEY:'ficticio',SHIPPING_FLAT_BRL:'20',
  SALES_ENABLED:'true',ASAAS_SANDBOX:'false',PAYMENTS_PRODUCTION_ENABLED:'true',
  CUSTOMER_PAYS_IMPORT_TAXES:'true',IMPORT_TAX_DISCLOSURE_APPROVED:'true',IMPORT_COMPLIANCE_APPROVED:'true'};
 const request=new Request('https://example.com/api/orders',{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({paymentMethod:'PIX',customer:{},items:[]})});
 const response=await worker.fetch(request,env);
 assert.equal(response.status,400);
 assert.match((await response.json()).error,/tributos de importação/);
});
test('marco de tributo confirmado aparece separado do tributo pendente',()=>{
 assert.ok(STAGES.tax_payment_confirmed);
 const value=formatProgress({id:'12345678-1234-4234-8234-123456789012',status:'supplier_preparing'},
 {carrier:'correios',tracking_code:'LB123456789CN'},[
  {stage:'tax_payment_confirmed',created_at:'2026-10-22T00:00:00Z'},
  {stage:'tax_payment_due',created_at:'2026-10-21T00:00:00Z'}
 ]);
 assert.equal(value.payTaxesAtOfficialCorreios,false);
 assert.equal(value.importTaxesManagedByStore,false);
 assert.equal(value.importTaxesPaidByRecipient,true);
 assert.match(value.importTaxGuidance,/Pagamento dos tributos registrado/);
});
test('simulador de planejamento tem campos explícitos e frontend válido',()=>{
 const page=readFileSync(new URL('../public/imports.html',import.meta.url),'utf8');
 assert.match(page,/budgetBusinessTax/);
 assert.match(page,/budgetFx/);
 assert.match(page,/Opção B/);
 const app=readFileSync(new URL('../public/tax-budget-ui.js',import.meta.url),'utf8');
 assert.match(app,/suggestedPriceBrl/);
 const js=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(js);
 assert.doesNotThrow(()=>new Function(js[1]));
});
