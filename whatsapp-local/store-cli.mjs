import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownJid } from './connection.mjs';
import { isAlive, statePaths, readJson } from './state.mjs';
import { bridgeApi, readBridgeConfig } from './store-bridge.mjs';

export async function storeCommand(action) {
  if (!['test', 'status'].includes(action)) throw new Error('Use npm run testar-loja ou npm run status-loja.');
  const paths = statePaths(), config = readBridgeConfig(paths);
  if (!config) throw new Error('Primeiro execute npm run integrar-loja.');
  const account = ownJid(readJson(path.join(paths.auth, 'creds.json'))?.me);
  if (action === 'test') {
    if (!isAlive(readJson(paths.lock)?.pid) || readJson(paths.status)?.state !== 'connected') {
      throw new Error('Aguarde npm run status mostrar connected antes de testar a loja.');
    }
    await bridgeApi(config, account, 'session');
  }
  const result = await bridgeApi(config, account, action);
  console.log(JSON.stringify(result, null, 2));
  if (action === 'test') console.log('Aguarde a mensagem na conversa do próprio número. Confira a confirmação com npm run status-loja.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  try { await storeCommand(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
