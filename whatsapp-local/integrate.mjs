import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { hasSession, isAlive, prepareState, readJson, statePaths } from './state.mjs';
import { writePrivateJson } from './store-bridge.mjs';
import { main as background } from './background.mjs';

export function wranglerSteps(token) {
  return [
    { label: 'Preparando a fila de teste no banco.', args: ['d1','execute','streetball-db','--remote','--file=worker/local-whatsapp-schema.sql','--yes'] },
    { label: 'Configurando a chave privada da ponte.', args: ['secret','put','WA_LOCAL_BRIDGE_TOKEN'], input: token + '\n' },
    { label: 'Publicando a ligação com o site.', args: ['deploy'] }
  ];
}

export async function integrate() {
  if (process.platform !== 'darwin') throw new Error('Execute este comando no Mac que já conectou o WhatsApp.');
  const paths = statePaths();
  if (!hasSession(paths)) throw new Error('Conecte primeiro o número secundário com npm run conectar.');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const toml = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
  if (!/^name\s*=\s*"streetball-store"\s*$/m.test(toml) ||
      !/^ASAAS_SANDBOX\s*=\s*"true"\s*$/m.test(toml) ||
      !/^PAYMENTS_PRODUCTION_ENABLED\s*=\s*"false"\s*$/m.test(toml) ||
      !/^WA_AUTOMATION_ENABLED\s*=\s*"false"\s*$/m.test(toml)) {
    throw new Error('Esta instalação de teste exige o Worker streetball-store, Asaas Sandbox e automações de produção desligadas.');
  }
  prepareState(paths);
  const previous = readJson(paths.config);
  const token = typeof previous?.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(previous.token)
    ? previous.token : randomBytes(32).toString('base64url');
  const config = { version: 1, storeUrl: 'https://lojastreetball.com.br', token, enabled: false };
  writePrivateJson(paths.config, config);
  console.log('Será configurado um teste entre o site e o próprio WhatsApp conectado.');
  for (const step of wranglerSteps(token)) {
    console.log(step.label);
    const result = spawnSync('npx', ['--yes','wrangler@4',...step.args], {
      cwd: root, input: step.input, stdio: step.input ? ['pipe','inherit','inherit'] : 'inherit',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
    });
    if (result.error || result.status !== 0) throw new Error('A configuração parou nesta etapa. Corrija o erro acima e execute npm run integrar-loja novamente.');
  }
  writePrivateJson(paths.config, { ...config, enabled: true });
  background('stop');
  const deadline = Date.now() + 15000;
  while (isAlive(readJson(paths.lock)?.pid)) {
    if (Date.now() >= deadline) throw new Error('A conexão anterior ainda está encerrando. Aguarde e execute npm run iniciar.');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  background('start');
  console.log('Ligação publicada. Aguarde o Mac conectar e execute npm run testar-loja.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  try { await integrate(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
