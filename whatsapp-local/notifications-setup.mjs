import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export async function publishSalesNotifications({repositoryRoot=root,run=spawnSync,request=fetch,log=console.log}={}){
 log('Publicando o painel e os avisos de venda. As configurações atuais da loja e do bot serão preservadas.');
 const result=run('npx',['--yes','wrangler@4','deploy','--keep-vars'],{cwd:repositoryRoot,stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 if(result.error||result.status!==0)throw Error('A publicação não foi confirmada. Confira a mensagem do Wrangler.');
 const response=await request('https://lojastreetball.com.br/api/health/notifications',{redirect:'error',signal:AbortSignal.timeout(15000)});
 const status=await response.json();
 if(!response.ok||status.version!=='iphone-sales-v2')throw Error('A nova versão ainda não foi confirmada no domínio. Aguarde um pouco e confira https://lojastreetball.com.br/ops/ .');
 log('Painel publicado: https://lojastreetball.com.br/ops/');
 log('No iPhone: abra no Safari, adicione à Tela de Início, abra pelo ícone e entre com a chave administrativa.');
 log('Toque em Ativar notificações, permita os avisos e envie um teste.');
 return status;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await publishSalesNotifications();}catch(error){console.error(error.message);process.exitCode=1;}
}
