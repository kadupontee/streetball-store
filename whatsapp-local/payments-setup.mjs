import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export async function configureProductionKey({root=repositoryRoot,request=fetch,run=spawnSync,log=console.log}={}) {
 const toml=fs.readFileSync(path.join(root,'wrangler.toml'),'utf8');
 if(!/^name\s*=\s*"streetball-store"\s*$/m.test(toml)||
    !/^ASAAS_SANDBOX\s*=\s*"true"\s*$/m.test(toml)||
    !/^PAYMENTS_PRODUCTION_ENABLED\s*=\s*"false"\s*$/m.test(toml)||
    !/^WA_AUTOMATION_ENABLED\s*=\s*"false"\s*$/m.test(toml)) {
  throw new Error('Este comando prepara a chave antes da liberação de produção. A configuração local deve continuar em Sandbox, com pagamentos reais e automação desligados.');
 }
 let response,data;
 try {
  response=await request('https://lojastreetball.com.br/api/checkout/config',{redirect:'error',signal:AbortSignal.timeout(10000)});
  data=await response.json();
 } catch {throw new Error('Não foi possível conferir o modo atual da loja. Nenhuma chave foi alterada.');}
 if(!response.ok||data.sandbox!==true)throw new Error('A loja precisa estar em Sandbox para preparar a chave com este comando. Nenhuma chave foi alterada.');
 log('Cadastre aqui a chave de API da conta real do Asaas.');
 log('Cole a chave somente no campo solicitado pelo Wrangler e pressione Enter. Não envie a chave no chat.');
 const result=run('npx',['--yes','wrangler@4','secret','put','ASAAS_PRODUCTION_API_KEY'],{
  cwd:root,stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}
 });
 if(result.error||result.status!==0)throw new Error('O cadastro da chave de produção não foi confirmado. Confira o erro do Wrangler acima.');
 log('Chave de produção cadastrada. A chave de testes foi preservada.');
 log('A etapa seguinte é configurar o webhook de produção e conferir os dados comerciais antes de liberar vendas reais.');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 process.umask(0o077);
 try{await configureProductionKey();}catch(error){console.error(error.message);process.exitCode=1;}
}
