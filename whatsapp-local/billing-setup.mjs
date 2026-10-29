import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {statePaths,readJson} from './state.mjs';
import {ownJid} from './connection.mjs';
import {readBridgeConfig,bridgeApi} from './store-bridge.mjs';
import {restartConnection} from './restart.mjs';
import {BILLING_FORMAT_VERSION} from '../worker/supplier-billing-format.js';

export async function prepareBilling({platform=process.platform,paths=statePaths(),
 root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),run=spawnSync,
 api=bridgeApi,restart=restartConnection,log=console.log}={}){
 if(platform!=='darwin')throw Error('Execute este comando no Mac que mantém o WhatsApp conectado.');
 const toml=fs.readFileSync(path.join(root,'wrangler.toml'),'utf8');
 const policy=JSON.parse(fs.readFileSync(path.join(root,'scripts','costs.json'),'utf8')).shared_supplier_policy;
 if(policy?.owner_confirmed!==true||policy.scope!=='five_registered_suppliers'||!/^shared-usd-[a-z0-9-]+$/.test(policy.version||''))throw Error('A tabela de compra compartilhada ainda não foi confirmada nesta versão.');
 const flags={ASAAS_SANDBOX:'false',WA_TRANSPORT:'local',SALES_ENABLED:'true',PAYMENTS_PRODUCTION_ENABLED:'true',
  WA_AUTOMATION_ENABLED:'true',WA_LOCAL_ORDERS_ENABLED:'true',CUSTOMER_PAYS_IMPORT_TAXES:'true',
  IMPORT_TAX_DISCLOSURE_APPROVED:'true',IMPORT_COMPLIANCE_APPROVED:'true',SHIPPING_FLAT_BRL:'0.00',STORE_PUBLIC_URL:'https://lojastreetball.com.br'};
 const sections=[...toml.matchAll(/^\[vars\][^\S\n]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/gm)];
 const vars=sections.length===1?sections[0][1]:'';
 if(!/^name\s*=\s*"streetball-store"\s*$/m.test(toml)||!/^database_name\s*=\s*"streetball-db"\s*$/m.test(toml)||
  !Object.entries(flags).every(([key,value])=>{
   const lines=[...vars.matchAll(new RegExp('^'+key+'\\s*=\\s*"([^"\\r\\n]*)"[^\\S\\n]*(?:#.*)?$','gm'))];
   return lines.length===1&&lines[0][1]===value;
  }))throw Error('A configuração precisa corresponder à loja Streetball de produção e ao WhatsApp local.');
 const config=readBridgeConfig(paths);
 if(!config||new URL(config.storeUrl).hostname!=='lojastreetball.com.br'||config.ordersEnabled!==true)throw Error('A ponte e o encaminhamento de pedidos precisam estar configurados neste Mac. Confira npm run status-loja.');
 const account=ownJid(readJson(path.join(paths.auth,'creds.json'))?.me);
 for(const step of [
  {label:'Preparando o registro privado de cobranças.',args:['d1','execute','streetball-db','--remote','--file=worker/local-orders-schema.sql','--yes']},
  {label:'Publicando o recebimento de cobranças da loja.',args:['deploy']}
 ]){
  log(step.label);
  const result=run('npx',['--yes','wrangler@4',...step.args],{cwd:root,stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  if(result.error||result.status!==0)throw Error('A atualização não foi confirmada. Corrija o erro acima e execute npm run preparar-cobrancas novamente.');
 }
 const status=await api(config,account,'orders-billing-status');
 if(status.available!==true||status.enabled!==true||status.version!==BILLING_FORMAT_VERSION)throw Error('A versão publicada não confirmou o registro de cobranças. Confira npm run status-cobrancas.');
 const costs=await api(config,account,'orders-costs-configure',{policyVersion:policy.version});
 if(costs.costTable?.configured!==true||costs.costTable.version!==policy.version||costs.costTable.suppliers<1)throw Error('A tabela compartilhada não foi confirmada para os fornecedores cadastrados. Confira npm run status-cobrancas.');
 await restart({paths});
 log('Recebimento de cobranças preparado. O bot pode pedir os dados faltantes ao fornecedor.');
 log('Tabela de compra compartilhada confirmada para '+costs.costTable.suppliers+' fornecedores autorizados.');
 log('Este comando não libera débitos automáticos. Confira npm run status-cobrancas.');
 return status;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.umask(0o077);
 try{await prepareBilling();}
 catch(error){console.error(error.message);process.exitCode=1;}
}
