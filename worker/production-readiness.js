import {asaasConfig} from './asaas.js';

const ORIGIN='https://lojastreetball.com.br';
const EVENTS=['PAYMENT_RECEIVED','PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED'];
const digits=value=>String(value||'').replace(/\D/g,'');

export function validCnpj(value){
 const s=digits(value);
 if(!/^\d{14}$/.test(s)||/^(\d)\1+$/.test(s))return false;
 const check=(length,weights)=>{const sum=weights.reduce((n,w,i)=>n+Number(s[i])*w,0),r=sum%11;return Number(s[length])===(r<2?0:11-r);};
 return check(12,[5,4,3,2,9,8,7,6,5,4,3,2])&&check(13,[6,5,4,3,2,9,8,7,6,5,4,3,2]);
}

async function merchantProfile(env){
 try{
  const response=await env.ASSETS.fetch(new Request(ORIGIN+'/merchant.json'));
  const profile=await response.json();
  if(!response.ok||!validCnpj(profile.cnpj)||typeof profile.legalName!=='string'||profile.legalName.length<3||
   typeof profile.address!=='string'||profile.address.length<8||!/^\S+@\S+\.\S+$/.test(profile.email||'')||
   !Number.isFinite(profile.shippingBrl)||profile.shippingBrl<0||
   !Number.isInteger(profile.deliveryMinDays)||!Number.isInteger(profile.deliveryMaxDays)||
   profile.deliveryMinDays<1||profile.deliveryMaxDays<profile.deliveryMinDays||profile.deliveryMaxDays>365||
   profile.customerPaysImportTaxes!==true)return null;
  return profile;
 }catch{return null;}
}

async function getProduction(path,key,request){
 try{
  const response=await request('https://api.asaas.com/v3'+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),
   headers:{accept:'application/json','access_token':key,'user-agent':'StreetballStore/1.0'}});
  if(!response.ok)return {ok:false,status:response.status};
  return {ok:true,data:await response.json()};
 }catch{return {ok:false,status:'unavailable'};}
}

export async function productionReadiness(env,{request=fetch}={}){
 const profile=await merchantProfile(env),config=asaasConfig({...env,ASAAS_SANDBOX:'false'});
 const checks={
  cadastroPublico:!!profile,chaveProducaoConfigurada:!!config.apiKey,tokenWebhookConfigurado:!!config.webhookToken,
  chaveAutenticada:false,contaAprovada:false,contaCorrespondeAoCnpj:null,
  webhookEncontrado:false,webhookUnico:false,webhookAtivado:false,eventosCorretos:false,entregaWebhookCorreta:false,
  revisaoImportacaoConcluida:env.IMPORT_TAX_DISCLOSURE_APPROVED==='true'&&env.IMPORT_COMPLIANCE_APPROVED==='true',
  pagamentosReaisLiberados:env.ASAAS_SANDBOX==='false'&&env.SALES_ENABLED==='true'&&env.PAYMENTS_PRODUCTION_ENABLED==='true'
 };
 const pending=[];
 if(!profile)pending.push('Cadastro público do vendedor ausente ou inválido.');
 if(!config.apiKey)pending.push('Chave Asaas de produção ausente ou incompatível.');
 if(!config.webhookToken)pending.push('Token do webhook de produção ausente.');
 if(profile&&config.apiKey){
  const [status,commercial,hooks]=await Promise.all([
   getProduction('/myAccount/status/',config.apiKey,request),
   getProduction('/myAccount/commercialInfo/',config.apiKey,request),
   getProduction('/webhooks?limit=100',config.apiKey,request)
  ]);
  checks.chaveAutenticada=[status,commercial,hooks].some(r=>r.ok);
  checks.contaAprovada=status.ok&&status.data?.general==='APPROVED';
  const cnpj=digits(commercial.data?.cpfCnpj);
  checks.contaCorrespondeAoCnpj=commercial.ok&&cnpj?cnpj===digits(profile.cnpj):null;
  if(!checks.chaveAutenticada)pending.push('Não foi possível autenticar as consultas na conta real do Asaas.');
  if(!checks.contaAprovada)pending.push('A aprovação da conta real não foi confirmada pela API.');
  if(checks.contaCorrespondeAoCnpj!==true)pending.push('Não foi confirmado que a conta Asaas pertence ao CNPJ da loja.');
  const matches=hooks.ok&&Array.isArray(hooks.data?.data)?hooks.data.data.filter(h=>h.url===ORIGIN+'/api/webhooks/asaas'):[];
  checks.webhookEncontrado=matches.length>0;checks.webhookUnico=matches.length===1&&hooks.data?.hasMore!==true;
  const hook=checks.webhookUnico?matches[0]:null;
  checks.webhookAtivado=hook?.enabled===true;
  checks.eventosCorretos=!!hook&&Array.isArray(hook.events)&&EVENTS.every(event=>hook.events.includes(event));
  checks.entregaWebhookCorreta=!!hook&&Number(hook.apiVersion)===3&&hook.sendType==='SEQUENTIALLY'&&hook.interrupted===false;
  if(!checks.webhookEncontrado)pending.push('O webhook da Streetball não foi localizado na conta real.');
  else if(!checks.webhookUnico)pending.push('É necessário conferir as configurações duplicadas do webhook.');
  else{
   if(!checks.webhookAtivado)pending.push('O webhook continua desativado para a preparação.');
   if(!checks.eventosCorretos)pending.push('O webhook precisa dos eventos de recebimento, estorno e chargeback.');
   if(!checks.entregaWebhookCorreta)pending.push('Confira versão 3, envio sequencial e fila não interrompida no webhook.');
  }
 }
 if(!checks.revisaoImportacaoConcluida)pending.push('A revisão fiscal e da operação de importação continua pendente.');
 if(!checks.pagamentosReaisLiberados)pending.push('As cobranças reais continuam desativadas.');
 return {ok:true,ambienteAtivo:env.ASAAS_SANDBOX==='true'?'sandbox':env.ASAAS_SANDBOX==='false'?'producao':'indefinido',
  configuracaoPagamentoConferida:Object.values(checks).every(value=>value===true),verificacoes:checks,pendencias:pending,
  correspondenciaTokenWebhook:'A validar com um evento real; a consulta ao Asaas não retorna o token.',
  consultaSomenteLeitura:true};
}
