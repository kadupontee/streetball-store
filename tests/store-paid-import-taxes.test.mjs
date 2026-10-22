import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {estimatedImportTaxes,quoteTaxesIncluded} from '../public/tax-budget.js';
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
test('opção A inclui frete, impostos, taxas comerciais, provisão e margem no preço planejado',()=>{
 const q=quoteTaxesIncluded({goodsUsd:11,freightUsd:4,usdToBrl:5.5,icmsRate:.2,
  postalFeesBrl:15,operationsBrl:5,riskRate:.1,paymentRate:.05,salesTaxRate:.06,
  targetMarginRate:.25,salePriceBrl:200});
 assert.equal(q.importCostBrl,165);
 assert.equal(q.contingencyBrl,16.5);
 assert.equal(q.costBeforeSalesBrl,201.5);
 assert.ok(Math.abs(q.minimumSaleBrl-314.84375)<.001);
 assert.equal(q.meetsTargetMargin,false);
 assert.ok(q.contributionBrl<0);
});
test('calculadora rejeita margem+taxas excessivas e câmbio inexistente',()=>{
 assert.throws(()=>quoteTaxesIncluded({goodsUsd:11,freightUsd:4,usdToBrl:0}),/inválid/);
 assert.throws(()=>quoteTaxesIncluded({goodsUsd:11,freightUsd:4,usdToBrl:5,
  paymentRate:.5,salesTaxRate:.3,targetMarginRate:.3}),/inválid/);
});
test('loja não libera cobranças reais apenas ao escolher opção A',async()=>{
 const req=new Request('https://example.com/api/checkout/config');
 const env={DB:{},ASSETS:{},ASAAS_API_KEY:'ficticio',SHIPPING_FLAT_BRL:'20',
  SALES_ENABLED:'true',ASAAS_SANDBOX:'false',PAYMENTS_PRODUCTION_ENABLED:'true',
  STORE_PAYS_IMPORT_TAXES:'true',IMPORT_COSTS_APPROVED:'false',IMPORT_COMPLIANCE_APPROVED:'false'};
 let data=await (await worker.fetch(req,env)).json();
 assert.equal(data.enabled,false);
 assert.equal(data.storeImportTaxResponsibilityPlanned,true);
 data=await (await worker.fetch(req,{...env,IMPORT_COSTS_APPROVED:'true'})).json();
 assert.equal(data.enabled,false);
 data=await (await worker.fetch(req,{...env,IMPORT_COSTS_APPROVED:'true',IMPORT_COMPLIANCE_APPROVED:'true'})).json();
 assert.equal(data.enabled,true);
});
test('marco de tributo confirmado aparece separado do tributo pendente',()=>{
 assert.ok(STAGES.tax_payment_confirmed);
 const value=formatProgress({id:'12345678-1234-4234-8234-123456789012',status:'supplier_preparing'},
 {carrier:'correios',tracking_code:'LB123456789CN'},[
  {stage:'tax_payment_confirmed',created_at:'2026-10-22T00:00:00Z'},
  {stage:'tax_payment_due',created_at:'2026-10-21T00:00:00Z'}
 ]);
 assert.equal(value.payTaxesAtOfficialCorreios,false);
 assert.equal(value.importTaxesManagedByStore,true);
 assert.match(value.importTaxGuidance,/Streetball Store/);
});
test('simulador de planejamento tem campos explícitos e frontend válido',()=>{
 const page=readFileSync(new URL('../public/imports.html',import.meta.url),'utf8');
 assert.match(page,/budgetBusinessTax/);
 assert.match(page,/budgetFx/);
 assert.match(page,/Opção A/);
 const app=readFileSync(new URL('../public/tax-budget-ui.js',import.meta.url),'utf8');
 assert.match(app,/minimumSaleBrl/);
 const js=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(js);
 assert.doesNotThrow(()=>new Function(js[1]));
});
