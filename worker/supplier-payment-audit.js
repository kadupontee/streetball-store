import {asaasConfig} from './asaas.js';
import {loadSupplierBillingForAudit} from './supplier-billing.js';
import {loadSharedSupplierCosts,applySharedSupplierCosts,SUPPLIER_COST_VERSION,sharedSupplierQuotedTotal,SUPPLIER_UNIT_TOLERANCE_USD,sharedSupplierToleranceUsd} from './supplier-cost-reference.js';

// Monetary inputs are converted to integer cents. No order/day spending ceiling is applied.
function decimal(value,places=2){
 if(!['number','string'].includes(typeof value))return null;
 const text=String(value);
 if(text.length>32)return null;
 if(!new RegExp('^\\d+(?:\\.\\d{1,'+places+'})?$').test(text))return null;
 const [whole,fraction='']=text.split('.');
 const result=BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,'0'));
 return result<=BigInt(Number.MAX_SAFE_INTEGER)?result:null;
}
const money=value=>value===null?null:(value/100n)+'.'+String(value%100n).padStart(2,'0');
const document=value=>String(value||'').replace(/[.\s/-]/g,'');
const exactDocument=value=>/^\d{11}$|^\d{14}$/.test(document(value))?document(value):null;
const report=()=>({ok:true,consultaSomenteLeitura:true,pagamentoIniciado:false,pagamentoAutomaticoHabilitado:false,
 limitePorPedido:null,limitePorDia:null,conferenciaFinanceiraConcluida:false,verificacoes:{},valoresBrl:{},pendencias:[]});

export function supplierPaymentBudget(items,costs,supplierTotalUsd){
 if(!Array.isArray(items)||!items.length||!Array.isArray(costs?.items)||costs.items.length!==items.length)return null;
 let goods=0n;
 for(let i=0;i<items.length;i++){
  const item=items[i],line=costs.items[i],unit=decimal(line?.unitUsd);
  if(!item||typeof item!=='object'||!line||line.productId!==item.id||line.qty!==item.qty||!Number.isInteger(item.qty)||item.qty<1||unit===null||unit<=0n)return null;
  goods+=unit*BigInt(item.qty);
 }
 const freight=decimal(costs.freightUsd),fx=decimal(costs.exchangeRateBrlPerUsd,6);
 const gateway=decimal(costs.gatewayFeeBrl),pixFee=decimal(costs.pixFeeBrl),other=decimal(costs.otherCostsBrl);
 if([freight,fx,gateway,pixFee,other].includes(null)||fx<=0n)return null;
 const total=supplierTotalUsd===undefined?goods+freight:decimal(supplierTotalUsd);
 if(total===null||total<=0n)return null;
 const supplier=(total*fx+500000n)/1000000n+gateway;
 const expense=supplier+pixFee+other;
 if(supplier<=0n||expense>BigInt(Number.MAX_SAFE_INTEGER))return null;
 return {supplier,expense,pixFee,other,goodsUsd:goods,freightUsd:freight};
}

export function compareSupplierPayment({order,charge,decoded,balance,costs,quotedTotalBrl,receiverCpfCnpj,supplierTotalUsd}){
 const result=report(),checks=result.verificacoes;
 let items;
 try{items=JSON.parse(order.items_json);}catch{items=null;}
 const budget=supplierPaymentBudget(items,costs,supplierTotalUsd),gross=decimal(order.total),received=decimal(charge?.value),net=decimal(charge?.netValue);
 const quoted=decimal(quotedTotalBrl),qrTotal=decimal(decoded?.totalValue),qrBase=decimal(decoded?.value);
 const amount=decoded?.totalValue==null?qrBase:qrTotal,available=decimal(balance?.balance),receiver=exactDocument(receiverCpfCnpj);
 checks.custoEsperadoInformado=budget!==null;
 checks.cobrancaCorrespondeAoPedido=charge?.id===order.payment_id&&charge?.externalReference===order.id&&gross!==null&&received===gross;
 checks.recebimentoLiquidado=charge?.status==='RECEIVED'&&charge.deleted===false&&!charge.chargeback&&
  (charge.refunds==null||(Array.isArray(charge.refunds)&&charge.refunds.length===0));
 checks.valorLiquidoInformado=net!==null&&net>0n&&received!==null&&net<=received;
 checks.cotacaoCorrespondeAoCusto=budget!==null&&quoted!==null&&quoted===budget.supplier;
 checks.pixCorrespondeACotacao=quoted!==null&&quoted>0n&&amount!==null&&amount===quoted;
 checks.pixDisponivel=decoded?.canBePaid===true&&decoded.type!=='COMPOSITE'&&!decoded.finality&&
  (decoded.changeValue==null||decimal(decoded.changeValue)===0n);
 checks.recebedorCorresponde=receiver!==null&&exactDocument(decoded?.receiver?.cpfCnpj)===receiver;
 checks.saldoDisponivel=available!==null&&budget!==null&&available>=budget.supplier+budget.pixFee;
 checks.resultadoPositivo=budget!==null&&net!==null&&net>budget.expense;
 const reasons={custoEsperadoInformado:'Custo, frete, câmbio e tarifas precisam estar informados para todos os itens.',
  cobrancaCorrespondeAoPedido:'A cobrança ou o valor recebido não corresponde ao pedido.',
  recebimentoLiquidado:'O pagamento do cliente ainda não está liquidado ou possui estorno/contestação.',
  valorLiquidoInformado:'O valor líquido recebido não foi confirmado.',
  cotacaoCorrespondeAoCusto:'O total cobrado pelo fornecedor difere da memória de cálculo.',
  pixCorrespondeACotacao:'O valor do Pix difere do orçamento do fornecedor.',
  pixDisponivel:'O código Pix não foi confirmado como disponível para pagamento comum.',
  recebedorCorresponde:'O documento completo do recebedor não corresponde ao informado para a cobrança.',
  saldoDisponivel:'O saldo não foi confirmado como suficiente para o Pix e sua tarifa.',
  resultadoPositivo:'A receita líquida não cobre todos os custos informados com resultado positivo.'};
 for(const [key,value]of Object.entries(checks))if(!value)result.pendencias.push(reasons[key]);
 result.valoresBrl={receitaBruta:money(gross),receitaLiquida:money(net),custoEsperadoFornecedor:money(budget?.supplier??null),
  cotacaoFornecedor:money(quoted),valorPix:money(amount),tarifaPix:money(budget?.pixFee??null),
  outrosCustos:money(budget?.other??null),resultadoAposCustos:budget&&net!==null?
   (net>=budget.expense?money(net-budget.expense):'-'+money(budget.expense-net)):null};
 result.conferenciaFinanceiraConcluida=Object.values(checks).every(Boolean);
 return result;
}

async function providerRead(config,path,{body,request}){
 try{
  const response=await request(config.apiUrl+path,{method:body?'POST':'GET',redirect:'manual',signal:AbortSignal.timeout(8000),
   headers:{'access_token':config.apiKey,'user-agent':'StreetballStore/1.0',accept:'application/json',
    ...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(response.status>=300&&response.status<400){try{await response.body?.cancel();}catch{}return null;}
  const data=await response.json().catch(()=>null);
  return response.ok&&data&&typeof data==='object'&&!Array.isArray(data)?data:null;
 }catch{return null;}
}

/** Read-only financial evidence. This function never calls the Pix payment endpoint. */
export async function auditSupplierPayment(env,input,{request=fetch}={}){
 const result=report(),config=asaasConfig(env);
 if(config.sandbox!==false||!config.apiKey||!env.DB){
  result.pendencias.push('É necessário consultar a conta de produção e o banco da loja.');return result;
 }
 if(input?.billingId){
  input=await loadSupplierBillingForAudit(env,input);
  if(!input){result.pendencias.push('A cobrança registrada não está completa, atual ou vinculada ao fornecedor deste pedido.');return result;}
 }
 if(!/^[a-f0-9-]{36}$/i.test(input?.orderId||'')||typeof input.pixPayload!=='string'||
  input.pixPayload.length<50||input.pixPayload.length>2048||!input.pixPayload.startsWith('000201')){
  result.pendencias.push('Informe o pedido e um código Pix Copia e Cola completo.');return result;
 }
 const order=await env.DB.prepare('SELECT id,status,total,payment_id,items_json FROM orders WHERE id=?').bind(input.orderId).first();
 if(!order||!['paid_supplier_pending','supplier_preparing'].includes(order.status)||!/^pay_[A-Za-z0-9_-]+$/.test(order.payment_id||'')){
  result.pendencias.push('O pedido não está disponível para conferência do pagamento ao fornecedor.');return result;
 }
 const usesSharedCosts=!!input.billingId;
 let supplierTotalUsd,referenceTotalUsd,toleranceTotalUsd,referenceQuantity;
 if(usesSharedCosts){
  const reference=await loadSharedSupplierCosts(env,order);
  if(!reference){result.pendencias.push('O pedido precisa de uma referência de compra completa e do fornecedor incluído na tabela compartilhada.');return result;}
  const costs=applySharedSupplierCosts(input.costs,reference);
  if(!costs){result.pendencias.push('Os custos ou o frete informados diferem da tabela compartilhada do pedido.');return result;}
  input={...input,costs};
  supplierTotalUsd=sharedSupplierQuotedTotal(reference,input.quotedTotalUsd);referenceTotalUsd=reference.totalUsd;
  toleranceTotalUsd=sharedSupplierToleranceUsd(reference);referenceQuantity=reference.quantity;
  if(supplierTotalUsd===null){
   result.pendencias.push('O total em USD declarado pelo fornecedor excede a diferença permitida de US$2 por peça do pedido, incluindo produtos, adicionais e frete, ou é inválido.');return result;
  }
  if(input.quotedExchangeRateBrlPerUsd!==null&&decimal(input.quotedExchangeRateBrlPerUsd,6)!==decimal(costs.exchangeRateBrlPerUsd,6)){
   result.pendencias.push('O câmbio declarado na cobrança difere do utilizado na conferência.');return result;
  }
 }
 const evidence=await env.DB.prepare('SELECT environment,payment_id,received_at FROM order_payment_environments WHERE order_id=?').bind(order.id).first();
 if(evidence?.environment!=='production'||evidence.payment_id!==order.payment_id||!evidence.received_at){
  result.pendencias.push('O recebimento de produção deste pedido não foi confirmado.');return result;
 }
 const supplier=await env.DB.prepare('SELECT d.state,d.details_sent_at,c.authorized,c.phone_e164,d.supplier_phone FROM supplier_dispatch d JOIN supplier_contacts c ON c.supplier_id=d.supplier_id WHERE d.order_id=?').bind(order.id).first();
 if(supplier?.authorized!==1||supplier.phone_e164!==supplier.supplier_phone||!['details_sent','confirmed'].includes(supplier.state)||!supplier.details_sent_at){
  result.pendencias.push('O fornecedor atual e a confirmação dos detalhes do pedido precisam ser conferidos.');return result;
 }
 const [charge,decoded,balance]=await Promise.all([
  providerRead(config,'/payments/'+encodeURIComponent(order.payment_id),{request}),
  providerRead(config,'/pix/qrCodes/decode',{body:{payload:input.pixPayload},request}),
  providerRead(config,'/finance/balance',{request})
 ]);
 if(!charge||!decoded||!balance){
  result.pendencias.push('Não foi possível confirmar a cobrança, o código Pix ou o saldo no Asaas.');return result;
 }
 if(decoded.payload!==input.pixPayload){
  result.pendencias.push('O código Pix devolvido pelo Asaas difere do enviado para conferência.');return result;
 }
 const compared=compareSupplierPayment({order,charge,decoded,balance,costs:input.costs,
  quotedTotalBrl:input.quotedTotalBrl,receiverCpfCnpj:input.receiverCpfCnpj,supplierTotalUsd});
 compared.referenciaCustos=usesSharedCosts?{origem:'tabela_compartilhada_do_pedido',versao:SUPPLIER_COST_VERSION,
  totalReferenciaUsd:referenceTotalUsd,totalConferidoUsd:supplierTotalUsd,quantidade:referenceQuantity,toleranciaPorPecaUsd:SUPPLIER_UNIT_TOLERANCE_USD,toleranciaTotalUsd:toleranceTotalUsd}:{origem:'administrador'};
 return compared;
}
