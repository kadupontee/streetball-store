import {asaasConfig} from './asaas.js';

const ORIGIN='https://lojastreetball.com.br';
const EVENTS=['PAYMENT_RECEIVED','PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED'];
const AUTH_CODES=new Set(['invalid_environment','access_token_not_found','invalid_access_token_format','invalid_access_token']);
const ACCOUNT_STATUSES=new Set(['APPROVED','PENDING','AWAITING_APPROVAL','REJECTED']);
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
  // Inspect redirects without following them or forwarding credentials to another destination.
  const response=await request('https://api.asaas.com/v3'+path,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(8000),
   headers:{accept:'application/json','access_token':key,'user-agent':'StreetballStore/1.0'}});
  const status=response.status,type=(response.headers.get('content-type')||'').toLowerCase();
  const format=type.includes('json')?'json':type.includes('html')?'html':'outro';
  if(status>=300&&status<400)return {ok:false,status,reason:'redirecionamento',format,code:null};
  const data=await response.json().catch(()=>null);
  if(!response.ok){
   const code=data?.errors?.[0]?.code;
   return {ok:false,status,reason:status===401?'autenticacao_recusada':status===403?'acesso_recusado':'erro_http',
    format,code:AUTH_CODES.has(code)?code:null};
  }
  if(!data||typeof data!=='object'||Array.isArray(data))return {ok:false,status,reason:'formato_invalido',format,code:null};
  return {ok:true,status,reason:'ok',format,code:null,data};
 }catch(error){
  return {ok:false,status:null,reason:['TimeoutError','AbortError'].includes(error?.name)?'tempo_esgotado':'falha_conexao',format:null,code:null};
 }
}

const diagnostic=result=>({httpStatus:result.status,resultado:result.reason,codigoAsaas:result.code,tipoResposta:result.format});
function queryFailure(label,result){
 const detail=['resposta_incompleta','formato_invalido'].includes(result.reason)?'resposta em formato inesperado, HTTP '+result.status:
  result.reason==='redirecionamento'?'redirecionamento não seguido, HTTP '+result.status:
  result.status!==null?'HTTP '+result.status:result.reason==='tempo_esgotado'?'tempo de resposta esgotado':'falha de conexão';
 return 'A consulta de '+label+' não foi concluída ('+detail+'). Confira consultasAsaas.';
}

export async function productionReadiness(env,{request=fetch}={}){
 const profile=await merchantProfile(env),config=asaasConfig({...env,ASAAS_SANDBOX:'false'});
 const checks={
  cadastroPublico:!!profile,chaveProducaoConfigurada:!!config.apiKey,tokenWebhookConfigurado:!!config.webhookToken,
  chaveAutenticada:null,contaAprovada:null,contaCorrespondeAoCnpj:null,
  webhookEncontrado:null,webhookUnico:null,webhookAtivado:null,eventosCorretos:null,entregaWebhookCorreta:null,
  revisaoImportacaoConcluida:env.IMPORT_TAX_DISCLOSURE_APPROVED==='true'&&env.IMPORT_COMPLIANCE_APPROVED==='true',
  pagamentosReaisLiberados:env.ASAAS_SANDBOX==='false'&&env.SALES_ENABLED==='true'&&env.PAYMENTS_PRODUCTION_ENABLED==='true'
 };
 const pending=[];
 const queries={situacaoConta:null,dadosComerciais:null,webhooks:null};
 if(!profile)pending.push('Cadastro público do vendedor ausente ou inválido.');
 if(!config.apiKey)pending.push('Chave Asaas de produção ausente ou incompatível.');
 if(!config.webhookToken)pending.push('Token do webhook de produção ausente.');
 if(profile&&config.apiKey){
  const [status,commercial,hooks]=await Promise.all([
   getProduction('/myAccount/status/',config.apiKey,request),
   getProduction('/myAccount/commercialInfo/',config.apiKey,request),
   getProduction('/webhooks?limit=100',config.apiKey,request)
  ]);
  const statusKnown=status.ok&&ACCOUNT_STATUSES.has(status.data?.general);
  const cnpj=digits(commercial.data?.cpfCnpj);
  const commercialKnown=commercial.ok&&/^(\d{11}|\d{14})$/.test(cnpj);
  const hooksKnown=hooks.ok&&Array.isArray(hooks.data?.data)&&hooks.data.data.every(h=>h&&typeof h==='object');
  const recognized=statusKnown||commercialKnown||hooksKnown;
  checks.chaveAutenticada=recognized?true:[status,commercial,hooks].some(r=>r.status===401)?false:null;
  if(statusKnown){
   checks.contaAprovada=status.data.general==='APPROVED';
   if(!checks.contaAprovada)pending.push('A situação cadastral retornada pelo Asaas ainda não está aprovada.');
  }else{
   if(status.ok)status.reason='resposta_incompleta';
   pending.push(queryFailure('situação cadastral',status));
  }
  if(commercialKnown){
   checks.contaCorrespondeAoCnpj=cnpj===digits(profile.cnpj);
   if(!checks.contaCorrespondeAoCnpj)pending.push('O documento da conta Asaas consultada é diferente do CNPJ público da loja.');
  }else{
   if(commercial.ok)commercial.reason='resposta_incompleta';
   pending.push(queryFailure('dados comerciais',commercial));
  }
  if(!hooksKnown){
   if(hooks.ok)hooks.reason='resposta_incompleta';
   pending.push(queryFailure('webhooks',hooks));
  }else{
   const matches=hooks.data.data.filter(h=>h.url===ORIGIN+'/api/webhooks/asaas');
   checks.webhookEncontrado=matches.length>0;
   checks.webhookUnico=matches.length===1&&hooks.data.hasMore!==true;
   const hook=checks.webhookUnico?matches[0]:null;
   if(!checks.webhookEncontrado)pending.push('O webhook da Streetball não foi localizado na lista retornada pelo Asaas.');
   else if(!checks.webhookUnico)pending.push('É necessário conferir as configurações duplicadas do webhook.');
   else{
    checks.webhookAtivado=typeof hook.enabled==='boolean'?hook.enabled:null;
    checks.eventosCorretos=Array.isArray(hook.events)?EVENTS.every(event=>hook.events.includes(event)):null;
    checks.entregaWebhookCorreta=hook.apiVersion!=null&&typeof hook.sendType==='string'&&typeof hook.interrupted==='boolean'?
     Number(hook.apiVersion)===3&&hook.sendType==='SEQUENTIALLY'&&hook.interrupted===false:null;
    if(checks.webhookAtivado===false)pending.push('O webhook continua desativado para a preparação.');
    else if(checks.webhookAtivado===null)pending.push('O Asaas não informou se o webhook está ativado.');
    if(checks.eventosCorretos!==true)pending.push('Confira os eventos de recebimento, estorno e chargeback no webhook.');
    if(checks.entregaWebhookCorreta!==true)pending.push('Confira versão 3, envio sequencial e fila não interrompida no webhook.');
   }
  }
  queries.situacaoConta=diagnostic(status);queries.dadosComerciais=diagnostic(commercial);queries.webhooks=diagnostic(hooks);
 }
 if(!checks.revisaoImportacaoConcluida)pending.push('A revisão fiscal e da operação de importação continua pendente.');
 if(!checks.pagamentosReaisLiberados)pending.push('As cobranças reais continuam desativadas.');
 return {ok:true,ambienteAtivo:env.ASAAS_SANDBOX==='true'?'sandbox':env.ASAAS_SANDBOX==='false'?'producao':'indefinido',
  configuracaoPagamentoConferida:Object.values(checks).every(value=>value===true),verificacoes:checks,consultasAsaas:queries,pendencias:pending,
  correspondenciaTokenWebhook:'A validar com um evento real; a consulta ao Asaas não retorna o token.',
  consultaSomenteLeitura:true};
}
