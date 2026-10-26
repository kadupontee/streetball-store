import fs from 'node:fs';
import { ownJid } from './connection.mjs';
import { readJson } from './state.mjs';

export function readBridgeConfig(paths) {
  const config = readJson(paths.config);
  if (!config?.enabled) return null;
  const url = new URL(config.storeUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      typeof config.token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(config.token)) {
    throw new Error('Configuração da ponte inválida. Execute npm run integrar-loja novamente.');
  }
  return { ...config, storeUrl: url.origin };
}

export async function bridgeApi(config, accountJid, action, data = {}, fetcher = fetch) {
  const response = await fetcher(new URL('/api/local-whatsapp/' + action, config.storeUrl), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.token },
    body: JSON.stringify({ ...data, accountJid })
  });
  if (!response.ok) throw new Error('Ponte da loja retornou HTTP ' + response.status + '.');
  const result = await response.json();
  if (result.ok !== true) throw new Error('A loja não confirmou a operação.');
  return result;
}

export function selfTestText(id) {
  return 'Streetball Store: conexão entre o site e este WhatsApp confirmada.\nTeste: ' + id.slice(0, 8) + '\nEsta mensagem é um teste para o próprio número. Nenhum pedido foi feito.';
}

export function writePrivateJson(file, value) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
  fs.chmodSync(file, 0o600);
}

export function startStoreBridge({ socket, config, paths, api = bridgeApi, log = console.log,
  schedule = setTimeout, cancel = clearTimeout, intervalMs = 3000 }) {
  const account = ownJid(socket.user);
  const existing = readJson(paths.journal);
  if (fs.existsSync(paths.journal) && (!existing || typeof existing !== 'object' || Array.isArray(existing))) {
    throw new Error('Histórico da ponte não pôde ser lido. Confira o arquivo local antes de continuar.');
  }
  const journal = existing || {};
  let active = true, timer, running = Promise.resolve(), warned = false, registered = false;
  const call = (action, data) => api(config, account, action, data);
  function remember(id, entry) {
    journal[id] = entry;
    const complete = Object.keys(journal).filter(key => journal[key].phase === 'acked');
    while (Object.keys(journal).length > 200 && complete.length) delete journal[complete.shift()];
    writePrivateJson(paths.journal, journal);
  }
  async function reconcile() {
    for (const [id, entry] of Object.entries(journal)) {
      if (entry.phase === 'acked') continue;
      if (entry.phase === 'sent') {
        await call('ack', { jobId: id, lease: entry.lease, messageId: entry.messageId });
      } else {
        // A crash may have happened after WhatsApp accepted the message. Never send it again.
        await call('uncertain', { jobId: id, lease: entry.lease });
      }
      remember(id, { ...entry, phase: 'acked' });
    }
  }
  async function poll() {
    if (!active) return;
    try {
      if (!registered) { await call('session'); registered = true; }
      await reconcile();
      if (!active) return;
      const { job } = await call('claim');
      if (!job || !active) return;
      if (job.kind !== 'self_test_v1' || job.accountJid !== account ||
          !/^[a-f0-9-]{36}$/i.test(job.id) || !/^[a-f0-9-]{36}$/i.test(job.lease)) {
        throw new Error('A loja devolveu uma tarefa incompatível com o modo de teste.');
      }
      remember(job.id, { phase: 'prepared', lease: job.lease });
      await call('sending', { jobId: job.id, lease: job.lease });
      if (!active) return;
      // Persist before transmission so a process restart cannot replay an uncertain send.
      remember(job.id, { phase: 'sending', lease: job.lease });
      let result;
      try {
        result = await socket.sendMessage(account, { text: selfTestText(job.id) });
        if (!/^[A-Za-z0-9_-]{4,180}$/.test(result?.key?.id || '')) throw new Error('missing message id');
      } catch {
        remember(job.id, { phase: 'uncertain', lease: job.lease });
        await reconcile();
        log('O envio do teste não foi confirmado. Ele não será repetido automaticamente.');
        return;
      }
      remember(job.id, { phase: 'sent', lease: job.lease, messageId: result.key.id });
      await reconcile();
      log('Teste da loja enviado e confirmado no site. Confira a conversa do próprio número.');
      warned = false;
    } catch {
      if (!warned) log('A ponte com a loja está aguardando conexão. Confira npm run status-loja.');
      warned = true;
    } finally {
      if (active) timer = schedule(tick, intervalMs);
    }
  }
  function tick() { running = poll(); }
  tick();
  return { stop() { active = false; cancel(timer); return running; } };
}
