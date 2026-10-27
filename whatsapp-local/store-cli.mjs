import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownJid } from './connection.mjs';
import { connectionStatus, statePaths, readJson,writePrivateJson } from './state.mjs';
import { bridgeApi, readBridgeConfig } from './store-bridge.mjs';
import {restartConnection} from './restart.mjs';

export async function storeCommand(action, paths = statePaths()) {
  if (!['test','status','orders-preview','orders-status','orders-enable','orders-disable','production-status'].includes(action)) throw new Error('Comando da loja inválido.');
  const config = readBridgeConfig(paths);
  if (!config) throw new Error('Primeiro execute npm run integrar-loja.');
  const account = ownJid(readJson(path.join(paths.auth, 'creds.json'))?.me);
  if (action === 'test'||action==='orders-preview') {
    const current = connectionStatus(paths);
    if (!current.ativo) throw new Error('O conector está parado. Execute npm run reiniciar.');
    if (current.estado !== 'connected') throw new Error('A conexão ainda não foi confirmada. Confira npm run diagnostico.');
    await bridgeApi(config, account, 'session');
  }
  if(action==='orders-enable'||action==='orders-disable'){
    if(action==='orders-enable'){
      const remote=await bridgeApi(config,account,'orders-status');
      if(remote.enabled!==true)throw new Error('A loja ainda não liberou pedidos de produção. O teste com foto continua disponível.');
    }
    writePrivateJson(paths.config,{...config,ordersEnabled:action==='orders-enable'});
    await restartConnection({paths});
    console.log(action==='orders-enable'?'Encaminhamento local de pedidos ativado.':'Encaminhamento local de pedidos desativado.');
    return;
  }
  const result = await bridgeApi(config, account, action);
  if(action==='status'||action==='orders-status')result.localOrdersEnabled=config.ordersEnabled===true;
  console.log(JSON.stringify(result, null, 2));
  if (action === 'test') console.log('Aguarde a mensagem na conversa do próprio número. Confira a confirmação com npm run status-loja.');
  if(action==='orders-preview')console.log('Aguarde a foto no próprio número. Use Responder na foto e escreva sim. Depois confira npm run status-loja.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  try { await storeCommand(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
