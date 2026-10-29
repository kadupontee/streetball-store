import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ownJid} from './connection.mjs';
import {readJson,statePaths,writePrivateJson} from './state.mjs';
import {bridgeApi,readBridgeConfig} from './store-bridge.mjs';
import {restartConnection} from './restart.mjs';

const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ORIGIN='https://lojastreetball.com.br';
const RELEASE={ASAAS_SANDBOX:'false',SALES_ENABLED:'true',PAYMENTS_PRODUCTION_ENABLED:'true',
 CUSTOMER_PAYS_IMPORT_TAXES:'true',IMPORT_TAX_DISCLOSURE_APPROVED:'true',IMPORT_COMPLIANCE_APPROVED:'true',
 WA_AUTOMATION_ENABLED:'true',WA_TRANSPORT:'local',WA_LOCAL_ORDERS_ENABLED:'true',SHIPPING_FLAT_BRL:'0.00'};
const TECHNICAL=['cadastroPublico','chaveProducaoConfigurada','tokenWebhookConfigurado','chaveAutenticada',
 'contaAprovada','contaCorrespondeAoCnpj','webhookEncontrado','webhookUnico','webhookAtivado','eventosCorretos','entregaWebhookCorreta'];

function checkReleaseConfiguration(root){
 const toml=fs.readFileSync(path.join(root,'wrangler.toml'),'utf8');
 if(!/^name\s*=\s*"streetball-store"\s*$/m.test(toml))throw new Error('A configuração não corresponde ao Worker da Streetball.');
 const vars=toml.match(/^\[vars\][^\S\n]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1];
 if(!vars||Object.entries(RELEASE).some(([key,value])=>{
  const lines=[...vars.matchAll(new RegExp('^'+key+'\\s*=\\s*"([^"]*)"[^\\S\\n]*(?:#.*)?$','gm'))];
  return lines.length!==1||lines[0][1]!==value;
 }))throw new Error('A configuração local de liberação está incompleta. Atualize esta pasta antes de executar npm run liberar-vendas.');
}

function checkTechnicalReport(report){
 if(report?.ok!==true||!['sandbox','producao'].includes(report.ambienteAtivo)||
  TECHNICAL.some(key=>report.verificacoes?.[key]!==true)){
  throw new Error('A conta ou o webhook ainda não passou em todas as verificações. Confira npm run status-producao antes de liberar as vendas.');
 }
}

export async function releaseProduction({root=repositoryRoot,paths=statePaths(),request=fetch,run=spawnSync,
 remote,restart=restartConnection,log=console.log,clock=Date.now,
 pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 checkReleaseConfiguration(root);
 const config=readBridgeConfig(paths);
 if(!config||config.storeUrl!==ORIGIN)throw new Error('A ponte deste Mac precisa estar vinculada à lojastreetball.com.br.');
 const account=ownJid(readJson(path.join(paths.auth,'creds.json'))?.me);
 const call=remote||((action)=>bridgeApi(config,account,action));
 log('Conferindo a conta real, o CNPJ e o webhook do Asaas.');
 checkTechnicalReport(await call('production-status'));
 // Confirm the order tables are available before publishing a live checkout.
 const ordersBefore=await call('orders-status');
 if(ordersBefore?.ok!==true||!['preview_only','live_orders'].includes(ordersBefore.mode)){
  throw new Error('A fila de pedidos não foi confirmada. Confira npm run status-pedidos.');
 }
 log('Preparando o encaminhamento de pedidos no WhatsApp secundário.');
 writePrivateJson(paths.config,{...config,ordersEnabled:true});
 try{
  const connected=await restart({paths});
  if(connected?.ativo!==true||connected.estado!=='connected')throw new Error('A conexão do WhatsApp não foi confirmada.');
 }catch(error){
  writePrivateJson(paths.config,config);
  throw error;
 }
 const heartbeatDeadline=clock()+15000;
 while((await call('status'))?.online!==true){
  if(clock()>=heartbeatDeadline)throw new Error('O WhatsApp conectou, mas a ponte não confirmou presença na loja. Confira npm run status-loja e repita npm run liberar-vendas.');
  await pause(500);
 }
 log('Publicando o checkout com cobranças reais e pedidos pelo WhatsApp secundário.');
 const result=run('npx',['--yes','wrangler@4','deploy'],{cwd:root,stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 if(result.error||result.status!==0)throw new Error('A publicação não foi confirmada. Confira o erro acima e npm run status-producao.');
 log('Conferindo a configuração publicada.');
 const report=await call('production-status');
 checkTechnicalReport(report);
 if(report.ambienteAtivo!=='producao'||report.configuracaoPagamentoConferida!==true||
  report.verificacoes.revisaoImportacaoConcluida!==true||report.verificacoes.pagamentosReaisLiberados!==true){
  throw new Error('A configuração de produção publicada não foi confirmada. Confira npm run status-producao.');
 }
 const response=await request(ORIGIN+'/api/checkout/config',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
 const checkout=await response.json();
 if(!response.ok||checkout.sandbox!==false||checkout.enabled!==true||checkout.shipping!==0||
  checkout.customerPaysImportTaxesPlanned!==true||checkout.productionImportComplianceReviewed!==true){
  throw new Error('O checkout real não foi confirmado. Confira npm run status-producao.');
 }
 const orders=await call('orders-status'),bridge=await call('status');
 if(orders?.ok!==true||orders.enabled!==true||orders.mode!=='live_orders'||bridge?.online!==true){
  throw new Error('O checkout foi publicado, mas o encaminhamento de pedidos não foi confirmado. Confira npm run status-pedidos e npm run status-loja.');
 }
 const summary={ok:true,ambienteAtivo:'producao',checkoutAtivo:true,whatsappOnline:true,
  encaminhamentoPedidosAtivo:true,localOrdersEnabled:true,pagamentoFornecedorAutomatico:checkout.supplierPaymentAutomated===true};
 log(JSON.stringify(summary,null,2));
 log('Vendas reais liberadas. Acompanhe o recebimento do primeiro pagamento no Asaas e o pedido na loja.');
 return summary;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.umask(0o077);
 try{await releaseProduction();}
 catch(error){console.error(error.message);process.exitCode=1;}
}
