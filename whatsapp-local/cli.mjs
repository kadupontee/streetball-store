import { acquireLock, connectionStatus, hasSession, prepareState, readJson, statePaths, writeStatus } from './state.mjs';
import { startConnection } from './connection.mjs';
import fs from 'node:fs';
import {readBridgeConfig,startStoreBridge} from './store-bridge.mjs';

process.umask(0o077);
const command = process.argv[2] || 'connect';
const headless = process.argv.includes('--background');
const paths = statePaths();
let release;
try {
  if (!['connect', 'self-test', 'status', 'reset'].includes(command)) throw new Error('Use npm run conectar, testar, status ou desvincular.');
  if (command === 'status') {
    console.log(JSON.stringify(connectionStatus(paths), null, 2));
  } else if (command === 'reset') {
    prepareState(paths);
    release = acquireLock(paths);
    fs.rmSync(paths.auth, { recursive: true, force: true });
    fs.mkdirSync(paths.auth, { mode: 0o700 });
    writeStatus(paths, 'needs_link');
    console.log('Sessão local removida. Execute npm run conectar. Para revogar o aparelho no WhatsApp, remova-o em Aparelhos conectados no celular.');
  } else {
    if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Instale Node.js 20 ou mais recente antes de continuar.');
    prepareState(paths);
    if ((headless || command === 'self-test') && !hasSession(paths)) {
      console.log('Primeiro execute npm run conectar e leia o QR code com o número secundário.');
      process.exitCode = headless ? 0 : 1;
    } else {
      release = acquireLock(paths);
      let baileys, pino, qrcode;
      try {
        [baileys, { default: pino }, { default: qrcode }] = await Promise.all([
          import('baileys'), import('pino'), import('qrcode-terminal')
        ]);
      } catch {
        throw new Error('Dependências indisponíveis. Execute npm ci dentro de whatsapp-local e tente novamente.');
      }
      const { state, saveCreds } = await baileys.useMultiFileAuthState(paths.auth);
      let bridge;
      const runner = startConnection({ makeSocket: baileys.default, auth: state, saveCreds,
        logger: pino({ level: 'silent' }), browser: baileys.Browsers.macOS('Desktop'),
        renderQr: qr => qrcode.generate(qr, { small: true }),
        selfTest: command === 'self-test', headless, status: value => writeStatus(paths, value),
        onConnected: socket => {
          if (command === 'self-test') return;
          try {
            const config = readBridgeConfig(paths);
            if (config) bridge = startStoreBridge({socket,config,paths});
          } catch { console.log('Confira a configuração da ponte com npm run integrar-loja.'); }
        },
        onDisconnected: () => bridge?.stop() });
      const stop = () => runner.stop();
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      process.exitCode = await runner.done;
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  release?.();
}
