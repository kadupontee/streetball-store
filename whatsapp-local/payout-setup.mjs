import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {statePaths,readJson,writePrivateJson} from './state.mjs';
import {ownJid} from './connection.mjs';
import {readBridgeConfig,bridgeApi} from './store-bridge.mjs';
import {prepareBilling} from './billing-setup.mjs';

const VERSION='supplier-pix-v1';
export async function prepareSupplierPayouts({paths=statePaths(),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),
 run=spawnSync,api=bridgeApi,prepare=prepareBilling,log=console.log,resume=false,
 wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),...options}={}){
 if(!resume)await prepare({paths,root,run,api,log,...options});
 const config=readBridgeConfig(paths),account=ownJid(readJson(path.join(paths.auth,'creds.json'))?.me);
 if(!config||config.storeUrl!=='https://lojastreetball.com.br')throw Error('Confira a ponte da loja com npm run status-loja.');
 let status;
 if(!resume){
  status=await api(config,account,'orders-payout-status');
  if(status.available!==true||status.version!==VERSION)throw Error('A versão de pagamentos não foi confirmada. Confira npm run status-pagamentos-fornecedores.');
 }
 const file=path.join(paths.base,'supplier-payout-setup.json'),saved=readJson(file);
 if(fs.existsSync(file)&&(!saved||saved.accountJid!==account||saved.storeUrl!==config.storeUrl||!/^[A-Za-z0-9_-]{43}$/.test(saved.token||'')))throw Error('Confira a configuração privada de pagamentos deste Mac antes de trocar o token.');
 if(resume&&!saved)throw Error('A preparação original não foi encontrada neste Mac. Execute npm run preparar-pagamentos-fornecedores.');
 if(!resume&&status.authorizationTokenConfigured&&!saved)throw Error('O token já existe na loja. Use o Mac que guardou a configuração original para preservar o mecanismo do Asaas.');
 const token=saved?.token||randomBytes(32).toString('base64url');
 if(!resume){
 writePrivateJson(file,{version:1,accountJid:account,storeUrl:config.storeUrl,token});
 log('Cadastrando o token específico de autorização de saídas.');
 const uploaded=run('npx',['--yes','wrangler@4','secret','put','ASAAS_SUPPLIER_PAYOUT_AUTH_TOKEN'],{
  cwd:root,input:token+'\n',stdio:['pipe','inherit','inherit'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 if(uploaded.error||uploaded.status!==0)throw Error('O token de saídas não foi confirmado. Corrija o erro acima e repita a preparação.');
 }
 log('Aguardando a confirmação do token pela loja.');
 for(let attempt=0;attempt<12;attempt++){
  status=null;
  try{status=await api(config,account,'orders-payout-status');}catch{/* Retry a transient read failure without exposing credentials. */}
  if(status?.available===true&&status.version===VERSION&&status.authorizationTokenConfigured===true)break;
  if(attempt<11)await wait(2000);
 }
 if(status?.available!==true||status.version!==VERSION||status.authorizationTokenConfigured!==true)throw Error('O token enviado ainda não foi confirmado pela loja. Execute npm run status-pagamentos-fornecedores e retome com npm run concluir-preparacao-pagamentos. A mesma chave foi preservada.');
 const clipboard=run('pbcopy',[],{input:token,stdio:['pipe','ignore','inherit']});
 if(clipboard.error||clipboard.status!==0)throw Error('Não foi possível copiar o token. Execute npm run concluir-preparacao-pagamentos neste Mac para copiar a mesma chave.');
 log('O token foi copiado. Cole somente no campo de token do Asaas.');
 log('Asaas: Menu do usuário > Integrações > Mecanismos de segurança.');
 log('URL: '+config.storeUrl+'/api/webhooks/asaas/supplier-payout-authorization');
 log('E-mail de notificações: contato@streetball.com.br');
 log('O validador atende apenas aos Pix registrados pelo bot; outras modalidades não são aprovadas por ele.');
 log(status.enabled?'O executor já estava habilitado. Sua configuração foi preservada.':'Executor preparado e pagamentos automáticos ainda desligados.');
 log('Quando houver uma cobrança, use npm run configurar-pagamento-fornecedor. Depois da configuração do Asaas e do perfil, use npm run ativar-pagamentos-fornecedores.');
 return status;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.umask(0o077);
 try{await prepareSupplierPayouts({resume:process.argv[2]==='resume'});}catch(error){console.error(error.message);process.exitCode=1;}
}
