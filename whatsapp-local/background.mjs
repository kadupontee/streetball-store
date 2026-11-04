import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hasSession, isAlive, prepareState, readJson, statePaths } from './state.mjs';
import {launchFailure,parseService,serviceHealth,SERVICE_LABEL,waitForConnection} from './service-health.mjs';

export function xmlText(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}

export function launchAgent({ node, directory, log }) {
  const args = [node, path.join(directory, 'cli.mjs'), 'connect', '--background'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.streetball.whatsapp</string>
<key>ProgramArguments</key><array>${args.map(value => `<string>${xmlText(value)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xmlText(directory)}</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xmlText(log)}</string>
<key>StandardErrorPath</key><string>${xmlText(log)}</string>
</dict></plist>\n`;
}

function check(result, message) {
  if (result.error || result.status !== 0) throw new Error(message + ' (' + launchFailure(result) + ').');
}

export function enableAndStartService({run,domain,plist}) {
  const target = `${domain}/${SERVICE_LABEL}`;
  check(run(['enable',target]), 'O macOS não habilitou o serviço Streetball');
  const before = run(['print',target]);
  if (before.error || (before.status !== 0 && before.status !== 113)) {
    throw new Error('O macOS não conseguiu consultar o serviço (' + launchFailure(before) + ').');
  }
  if (before.status !== 0) {
    check(run(['bootstrap',domain,plist]), 'O macOS não carregou o serviço Streetball');
  }
  const current = run(['print',target]);
  if (!parseService(current).cadastrado) {
    throw new Error('O macOS não manteve o serviço carregado (' + launchFailure(current) + '). Confira Ajustes do Sistema > Geral > Itens de Início e a permissão para executar em segundo plano.');
  }
  // Do not use -k: starting must never kill an already running connection.
  if (!parseService(current).pid) check(run(['kickstart',target]), 'O macOS não iniciou o processo Streetball');
}

export async function unloadService({run,target,clock=Date.now,
  pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=10000}) {
  const before = run(['print',target]);
  if (!before.error && before.status === 113) return;
  check(before,'O macOS não conseguiu consultar o serviço');
  check(run(['bootout',target]),'O macOS não confirmou a parada');
  const until = clock()+timeoutMs;
  while (true) {
    const current = run(['print',target]);
    if (!current.error && current.status === 113) return;
    check(current,'O macOS não conseguiu confirmar a parada');
    if (clock() >= until) throw new Error('O serviço anterior ainda está carregado no macOS. Aguarde e repita npm run reiniciar.');
    await pause(200);
  }
}

export async function main(command,{removeAgent=true}={}) {
  if (!['start', 'stop', 'logs'].includes(command)) throw new Error('Use npm run iniciar, parar ou logs.');
  const paths = statePaths();
  if (command === 'logs') {
    console.log(fs.existsSync(paths.log) ? fs.readFileSync(paths.log, 'utf8').slice(-12000) : 'Nenhum log disponível.');
    return;
  }
  if (process.platform !== 'darwin') throw new Error('O modo em segundo plano deste pacote usa launchd e requer macOS.');
  const domain = `gui/${process.getuid()}`;
  const target = `${domain}/${SERVICE_LABEL}`;
  const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
  const run = args => spawnSync('/bin/launchctl', args, { encoding: 'utf8', timeout: 10000 });
  if (command === 'stop') {
    await unloadService({run,target});
    if (removeAgent) {
      fs.rmSync(plist, { force: true });
      console.log('Inicialização automática removida. Se houver conexão no Terminal, encerre com Control+C.');
    } else {
      console.log('Serviço anterior parado. A sessão salva será reutilizada.');
    }
    return;
  }
  if (!hasSession(paths)) throw new Error('Vincule o número com npm run conectar antes de ativar o segundo plano.');
  const loaded = run(['print', target]).status === 0;
  if (isAlive(readJson(paths.lock)?.pid)) {
    if (!loaded) throw new Error('A conexão do Terminal ainda está ativa. Encerre com Control+C antes de iniciar em segundo plano.');
    console.log('O conector já está ativo. Confira npm run status.');
    return;
  }
  prepareState(paths);
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  const fd = fs.openSync(paths.log, 'a', 0o600); fs.closeSync(fd);
  fs.chmodSync(paths.log, 0o600);
  const xml = launchAgent({ node: process.execPath, directory: path.dirname(fileURLToPath(import.meta.url)), log: paths.log });
  if (!fs.existsSync(plist) || fs.readFileSync(plist,'utf8') !== xml) fs.writeFileSync(plist,xml,{mode:0o600});
  enableAndStartService({run,domain,plist});
  console.log('Serviço habilitado e carregado no macOS. Aguardando a conexão com o WhatsApp.');
  console.log('O Mac precisa continuar ligado, com internet e sem entrar em repouso.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  try {
    await main(process.argv[2]);
    if (process.argv[2] === 'start') await waitForConnection();
  } catch (error) {
    console.error(error.message);
    if (process.argv[2] === 'start') console.log(JSON.stringify(serviceHealth(), null, 2));
    process.exitCode = 1;
  }
}
