import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {connectionStatus,readJson,statePaths} from './state.mjs';

export const SERVICE_LABEL = 'com.streetball.whatsapp';
const runLaunchctl = args => spawnSync('/bin/launchctl', args, {encoding:'utf8',timeout:10000});

export function parseService(result) {
  if (result.error || result.status !== 0) return { cadastrado: false, estado: 'unloaded', pid: null,
    ultimoCodigoSaida: null, codigoConsulta: result.error?.code || result.status };
  const text = result.stdout || '';
  const number = pattern => { const match = text.match(pattern); return match ? Number(match[1]) : null; };
  return { cadastrado: true, estado: text.match(/^\s*state\s*=\s*([^\r\n]+)/m)?.[1].trim() || 'unknown',
    pid: number(/^\s*pid\s*=\s*(\d+)/m),
    ultimoCodigoSaida: number(/^\s*last exit code\s*=\s*(-?\d+)/m), codigoConsulta: 0 };
}

export function launchFailure(result) {
  const code = result.error?.code || result.status || result.signal || 'unknown';
  // Only the first status line; never dump the launchctl environment or auth files.
  const detail = String(result.stderr || '').split(/\r?\n/)[0].trim().slice(0, 180);
  return 'launchctl ' + code + (detail ? ': ' + detail : '');
}

export function parseServicePolicy(result) {
  if (result.error || result.status !== 0) return null;
  // Keep only our label, never another application's settings.
  const value = String(result.stdout || '').match(/^\s*"com\.streetball\.whatsapp"\s*=>\s*(true|false|disabled|enabled)\s*$/m)?.[1];
  return value === 'true' || value === 'disabled';
}

export function inspectMacService({platform=process.platform,uid,run=runLaunchctl}={}) {
  if (platform !== 'darwin') return { cadastrado: false, estado: 'unsupported', pid: null, ultimoCodigoSaida: null };
  const domain = `gui/${uid ?? process.getuid()}`;
  const current = parseService(run(['print', `${domain}/${SERVICE_LABEL}`]));
  const policy = run(['print-disabled', domain]);
  return {...current,desativado:parseServicePolicy(policy)};
}

function recentMessages(file) {
  try {
    // Exclude library dumps, credentials, arbitrary chat content and the system environment.
    return fs.readFileSync(file, 'utf8').slice(-16000).split(/\r?\n/)
      .filter(line => /^(Conectado\.|Conexão interrompida\.|Sessão encerrada|É necessário vincular|Primeiro execute|Dependências indisponíveis|Não foi possível|A ponte com a loja|Confira a configuração|O envio do teste|Teste da loja enviado|Error(?: \[[A-Z_]+\])?:|SyntaxError:|TypeError:|ReferenceError:)/.test(line))
      .slice(-8).map(line => line.replace(/Bearer\s+\S+/gi, 'Bearer [oculto]').replace(/[A-Za-z0-9_-]{32,}/g, '[oculto]').slice(0, 300));
  } catch { return []; }
}

export function serviceHealth(paths = statePaths(), inspect = inspectMacService) {
  const local = connectionStatus(paths);
  return { ...local, processoPid: local.ativo ? readJson(paths.lock)?.pid : null,
    servicoDoMac: inspect(), ponteConfigurada: readJson(paths.config)?.enabled === true,
    mensagensRecentes: recentMessages(paths.log) };
}

export async function waitForConnection({paths = statePaths(), snapshot = () => serviceHealth(paths),
  clock = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = 35000, log = console.log} = {}) {
  const until = clock() + timeoutMs;
  log('Confirmando a conexão em segundo plano (até 35 segundos).');
  while (true) {
    const current = snapshot();
    if (current.servicoDoMac.desativado === true) {
      throw new Error('O macOS desativou o serviço Streetball. Confira Ajustes do Sistema > Geral > Itens de Início e a permissão para executar em segundo plano.');
    }
    if (current.ativo && current.estado === 'connected' && current.servicoDoMac.cadastrado &&
        current.servicoDoMac.pid === current.processoPid) {
      log('Conectado. Serviço em segundo plano confirmado no macOS.');
      return current;
    }
    if (current.ativo && current.estado === 'needs_link') {
      throw new Error('O WhatsApp solicitou novo vínculo. Pare o serviço e execute npm run conectar.');
    }
    if (clock() >= until) throw new Error('A conexão não foi confirmada no prazo. Confira o diagnóstico abaixo.');
    await pause(500);
  }
}
