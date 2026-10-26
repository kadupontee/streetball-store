import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ownJid } from './connection.mjs';

export function statePaths(home = os.homedir(), platform = process.platform) {
  const base = platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'Streetball WhatsApp')
    : path.join(home, '.local', 'state', 'streetball-whatsapp');
  return { base, auth: path.join(base, 'auth'), lock: path.join(base, 'process.json'),
    status: path.join(base, 'status.json'), log: path.join(base, 'conexao.log'),
    config: path.join(base, 'bridge-config.json'), journal: path.join(base, 'bridge-journal.json') };
}

export function prepareState(paths) {
  for (const dir of [paths.base, paths.auth]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
  }
}

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

export function hasSession(paths) {
  // QR pairing populates creds.me; the SDK leaves registered=false in this flow.
  try { return Boolean(ownJid(readJson(path.join(paths.auth, 'creds.json'))?.me)); }
  catch { return false; }
}

export function connectionStatus(paths) {
  const state = readJson(paths.status), lock = readJson(paths.lock);
  const active = isAlive(lock?.pid);
  const sameProcess = state?.pid === lock?.pid;
  return { ativo: active, estado: active ? (sameProcess ? state?.state || 'starting' : 'starting') : 'stopped',
    sessaoSalva: hasSession(paths), atualizadoEm: active && !sameProcess ? null : state?.updatedAt || null };
}

export function acquireLock(paths) {
  // One socket per account: a foreground command must not replace the background connection.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(paths.lock, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
      fs.closeSync(fd);
      return () => {
        if (readJson(paths.lock)?.pid === process.pid) fs.rmSync(paths.lock, { force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = readJson(paths.lock);
      if (!previous || isAlive(previous.pid)) {
        throw new Error('O conector já está ativo (ou o arquivo de controle precisa ser conferido). Use npm run parar antes de conectar ou testar novamente.');
      }
      fs.rmSync(paths.lock, { force: true });
    }
  }
  throw new Error('Não foi possível reservar a conexão.');
}

export function writeStatus(paths, state) {
  const tmp = paths.status + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ state, pid: process.pid, updatedAt: new Date().toISOString() }), { mode: 0o600 });
  fs.renameSync(tmp, paths.status);
}
