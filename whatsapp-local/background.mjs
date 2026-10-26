import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hasSession, isAlive, prepareState, readJson, statePaths } from './state.mjs';

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

export function main(command) {
  if (!['start', 'stop', 'logs'].includes(command)) throw new Error('Use npm run iniciar, parar ou logs.');
  const paths = statePaths();
  if (command === 'logs') {
    console.log(fs.existsSync(paths.log) ? fs.readFileSync(paths.log, 'utf8').slice(-12000) : 'Nenhum log disponível.');
    return;
  }
  if (process.platform !== 'darwin') throw new Error('O modo em segundo plano deste pacote usa launchd e requer macOS.');
  const domain = `gui/${process.getuid()}`;
  const target = `${domain}/com.streetball.whatsapp`;
  const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.streetball.whatsapp.plist');
  const run = args => spawnSync('/bin/launchctl', args, { encoding: 'utf8' });
  if (command === 'stop') {
    if (run(['print', target]).status === 0 && run(['bootout', target]).status !== 0) {
      throw new Error('O macOS não confirmou a parada. Confira npm run status.');
    }
    fs.rmSync(plist, { force: true });
    console.log('Inicialização automática removida. Se houver conexão no Terminal, encerre com Control+C.');
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
  fs.writeFileSync(plist, launchAgent({ node: process.execPath, directory: path.dirname(fileURLToPath(import.meta.url)), log: paths.log }), { mode: 0o600 });
  const result = loaded ? run(['kickstart', target]) : run(['bootstrap', domain, plist]);
  if (result.error || result.status !== 0) throw new Error('O macOS não confirmou o início. Confira Ajustes > Geral > Itens de Início e npm run status.');
  console.log('Serviço cadastrado para iniciar no login. Aguarde a conexão e confira npm run status.');
  console.log('O Mac precisa continuar ligado, com internet e sem entrar em repouso.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  try { main(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
