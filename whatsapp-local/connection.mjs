export const SELF_TEST_TEXT = 'Streetball Store: teste de conexão concluído. Esta mensagem foi enviada somente para o próprio número conectado. Nenhum pedido foi feito.';

// No recipient argument or order API exists in this first setup stage.
export function ownJid(user) {
  const id = String(user?.id || '');
  if (!/^[0-9]+(?::[0-9]+)?@(s\.whatsapp\.net|lid)$/.test(id)) {
    throw new Error('Não foi possível identificar o próprio número conectado.');
  }
  return id.replace(/:[0-9]+@/, '@');
}

export function startConnection({ makeSocket, auth, saveCreds, logger, browser, renderQr,
  selfTest = false, headless = false, log = console.log, status = () => {},
  schedule = setTimeout, cancel = clearTimeout, testTimeoutMs = 90000 }) {
  let socket, retryTimer, timeoutTimer, generation = 0, retries = 0, finished = false, tested = false;
  let credentialsSaved = Promise.resolve(), saveFailed = false;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  function finish(code = 0, state = 'stopped') {
    if (finished) return;
    finished = true;
    cancel(retryTimer); cancel(timeoutTimer);
    try { status(state); } catch { /* Preserve cleanup even if the disk is full. */ }
    try { socket?.end(undefined); } catch { /* Already disconnected. */ }
    credentialsSaved.then(() => resolveDone(saveFailed ? 1 : code), () => resolveDone(1));
  }
  function persistCredentials() {
    if (finished) return credentialsSaved;
    credentialsSaved = credentialsSaved.then(saveCreds).catch(() => {
      saveFailed = true;
      log('Não foi possível salvar a sessão local. Confira espaço e permissões.');
      finish(1, 'error');
    });
    return credentialsSaved;
  }
  function connect() {
    if (finished) return;
    const current = ++generation;
    try {
      socket = makeSocket({ auth, logger, browser, syncFullHistory: false,
        shouldSyncHistoryMessage: () => false, markOnlineOnConnect: false });
    } catch {
      log('Não foi possível iniciar o conector. Confira a instalação das dependências.');
      finish(1, 'error'); return;
    }
    const activeSocket = socket;
    socket.ev.on('creds.update', () => {
      if (current === generation) persistCredentials();
    });
    socket.ev.on('connection.update', update => {
      if (finished || current !== generation) return;
      Promise.resolve().then(async () => {
        if (finished || current !== generation) return;
        if (update.qr) {
          if (headless || selfTest) {
            log('É necessário vincular novamente. Pare o serviço e execute npm run conectar.');
            finish(headless ? 0 : 1, 'needs_link'); return;
          }
          status('waiting_qr');
          log('No WhatsApp do número secundário: Configurações > Aparelhos conectados > Conectar aparelho.');
          renderQr(update.qr);
        }
        if (update.connection === 'open') {
          await persistCredentials();
          if (finished || current !== generation) return;
          retries = 0; status('connected');
          log('Conectado. Esta etapa não envia pedidos a fornecedores.');
          if (selfTest && !tested) {
            tested = true; // Never retry a message whose delivery may be uncertain.
            await activeSocket.sendMessage(ownJid(activeSocket.user), { text: SELF_TEST_TEXT });
            log('Teste enviado para a conversa do próprio número. Confira no celular.');
            finish(0, 'test_sent');
          }
        }
        if (update.connection === 'close') {
          const code = update.lastDisconnect?.error?.output?.statusCode;
          if ([401, 403, 411, 440, 500].includes(code)) {
            log('Sessão encerrada ou substituída. Confira os aparelhos conectados e execute npm run conectar.');
            finish(headless ? 0 : 1, 'needs_link'); return;
          }
          status('reconnecting');
          log('Conexão interrompida. Aguardando para reconectar.');
          cancel(retryTimer);
          retryTimer = schedule(connect, code === 515 ? 0 : Math.min(30000, 1000 * 2 ** Math.min(retries++, 5)));
        }
      }).catch(() => {
        log('A operação não foi confirmada. Nenhuma mensagem será reenviada automaticamente.');
        finish(1, 'error');
      });
    });
  }
  if (selfTest) timeoutTimer = schedule(() => {
    log('Tempo de conexão esgotado. Confira a internet e vincule o número antes de testar.');
    finish(1, 'timeout');
  }, testTimeoutMs);
  connect();
  return { done, stop: () => finish(0) };
}
