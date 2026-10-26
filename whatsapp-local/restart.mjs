import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {main as background} from './background.mjs';
import {hasSession,isAlive,readJson,statePaths} from './state.mjs';
import {serviceHealth,waitForConnection} from './service-health.mjs';

export async function restartConnection({paths = statePaths(), command = background,
  isRunning = () => isAlive(readJson(paths.lock)?.pid), clock = Date.now,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  ready = () => waitForConnection({paths}), log = console.log} = {}) {
  if (!hasSession(paths)) throw new Error('Primeiro vincule o número com npm run conectar.');
  log('Reiniciando o serviço com a sessão já salva.');
  command('stop');
  const until = clock() + 15000;
  while (isRunning()) {
    if (clock() >= until) throw new Error('A conexão anterior ainda está ativa. Se ela estiver em um Terminal, encerre com Control+C e repita npm run reiniciar.');
    await pause(200);
  }
  command('start');
  return await ready();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  try {
    if (process.argv[2] === 'diagnose') console.log(JSON.stringify(serviceHealth(), null, 2));
    else if (process.argv[2] === 'restart') await restartConnection();
    else throw new Error('Use npm run reiniciar ou npm run diagnostico.');
  } catch (error) {
    console.error(error.message);
    console.log(JSON.stringify(serviceHealth(), null, 2));
    process.exitCode = 1;
  }
}
