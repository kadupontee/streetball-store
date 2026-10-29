import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {statePaths,readJson} from './state.mjs';
import {ownJid} from './connection.mjs';
import {readBridgeConfig,bridgeApi} from './store-bridge.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function configureSupplierPayout(mode,{paths=statePaths(),api=bridgeApi,ask,log=console.log}={}){
 const config=readBridgeConfig(paths);if(!config)throw Error('Confira a ponte da loja com npm run status-loja.');
 if(config.storeUrl!=='https://lojastreetball.com.br')throw Error('A configuração precisa corresponder à Streetball.');
 const account=ownJid(readJson(path.join(paths.auth,'creds.json'))?.me),call=(action,body={})=>api(config,account,'orders-payout-'+action,body);
 if(mode==='resolve'){
  log('Esta conferência consulta uma transação existente no Asaas. Nenhum Pix novo será solicitado.');
  const intentId=(await ask('ID da intenção mostrado em status-pagamentos-fornecedores: ')).trim();
  const transactionId=(await ask('ID da transação correspondente no Asaas: ')).trim();
  const result=await call('resolve',{intentId,transactionId});log(JSON.stringify(result,null,2));return result;
 }
 if(mode==='enable'){
  log('O Asaas precisa estar com o mecanismo de segurança configurado para a URL e o token copiados na preparação.');
  if((await ask('Digite CONFIGURADO se essa configuração já foi salva no Asaas: ')).trim().toUpperCase()!=='CONFIGURADO')throw Error('Conclua a configuração do mecanismo de segurança no Asaas antes de habilitar o executor.');
  const policy=JSON.parse(fs.readFileSync(path.join(root,'scripts/costs.json'),'utf8')).shared_supplier_policy;
  const status=await call('enable',{securityWebhookConfigured:true,costPolicyVersion:policy.version});
  log(JSON.stringify(status,null,2));return status;
 }
 if(mode!=='profile')throw Error('Comando financeiro inválido.');
 let preview;
 try{preview=await call('inspect');}catch{throw Error('Ainda não há cobrança atual com Pix e custo de compra completos. O cadastro do recebedor poderá ser feito quando chegar a primeira cobrança.');}
 log('Pedido '+preview.orderId.slice(0,8)+' | custo em USD '+preview.expectedUsd+' | cobrança R$ '+preview.valueBrl);
 log('Recebedor no Asaas: '+preview.receiverName+' | documento '+preview.receiverDocument);
 if((await ask('Depois de conferir esse recebedor com a cobrança do fornecedor, digite RECEBEDOR: ')).trim().toUpperCase()!=='RECEBEDOR')throw Error('Confira o recebedor antes de cadastrar o perfil.');
 log('Câmbio 1: fixo conferido por você. Câmbio 2: usar o valor explicitamente declarado pelo fornecedor em cada cobrança.');
 log('Na opção 2, o bot confere os custos em USD, a conta da conversão, as tarifas e o resultado positivo; não compara a cotação com uma taxa de mercado.');
 const modeChoice=(await ask('Escolha o câmbio: 1 ou 2: ')).trim();
 if(!['1','2'].includes(modeChoice))throw Error('Escolha 1 ou 2 para a regra de câmbio.');
 const readMoney=async prompt=>{
  const value=(await ask(prompt)).trim().replace(',','.');if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw Error('Informe um valor com até dois centavos. Digite 0 quando a despesa não existir.');return value;
 };
 const exchangeRate=modeChoice==='1'?(await ask('Câmbio conferido, em BRL por USD: ')).trim().replace(',','.') : null;
 if(modeChoice==='1'&&(!/^\d+(?:\.\d{1,6})?$/.test(exchangeRate)||Number(exchangeRate)<=0))throw Error('Câmbio inválido.');
 log('A tarifa do Pix será consultada no Asaas. A receita usada já é líquida; informe abaixo somente as outras despesas.');
 const gatewayFeeBrl=await readMoney('Tarifa da plataforma por pedido, em BRL (0 se não houver): ');
 const otherCostsBrlPerOrder=await readMoney('Outras despesas por pedido, em BRL (sem repetir produto/frete): ');
 const otherCostsBrlPerUnit=await readMoney('Outras despesas por unidade, em BRL (0 se não houver): ');
 const percent=await readMoney('Despesas proporcionais sobre o valor da venda, em % (0 se não houver): ');
 if(Number(percent)>100)throw Error('Percentual inválido.');
 const minutes=(await ask('Por quantos minutos esses valores e o recebedor foram conferidos? ')).trim();
 if(!/^\d{1,8}$/.test(minutes)||Number(minutes)<1)throw Error('Informe a validade conferida, em minutos.');
 const existing=await call('profiles'),previous=existing.profiles.find(p=>p.supplierId===preview.supplierId);
 const profile={exchangeRateMode:modeChoice==='1'?'fixed':'supplier_quote',exchangeRateBrlPerUsd:exchangeRate,
  gatewayFeeBrl,otherCostsBrlPerOrder,otherCostsBrlPerUnit,salesCostRate:(Number(percent)/100).toFixed(4),
  validUntil:new Date(Date.now()+Number(minutes)*60000).toISOString()};
 const result=await call('profile',{billingId:preview.billingId,receiverBinding:preview.receiverBinding,confirmReceiver:true,
  profile,expectedRevision:previous?.revision||0});
 log('Perfil financeiro salvo. Esse cadastro não solicita um Pix; a ativação do executor é separada.');
 log(JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.umask(0o077);const reader=createInterface({input:process.stdin,output:process.stdout});
 try{await configureSupplierPayout(process.argv[2],{ask:question=>reader.question(question)});}
 catch(error){console.error(error.message);process.exitCode=1;}
 finally{reader.close();}
}
