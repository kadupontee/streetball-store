import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ownJid, SELF_TEST_TEXT, startConnection } from './connection.mjs';
import { acquireLock, hasSession, prepareState, statePaths } from './state.mjs';
import { launchAgent } from './background.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}) {
  const sockets = [], sent = [], logs = [], qr = [], states = [], timers = [];
  const runner = startConnection({
    makeSocket(config) {
      const socket = { ev: new EventEmitter(), config, user: { id: '5511999999999:7@s.whatsapp.net' },
        async sendMessage(...args) { sent.push(args); return { key: { id: 'fake-self-test' } }; }, end() {} };
      sockets.push(socket); return socket;
    }, auth: {}, saveCreds: async () => {}, renderQr: value => qr.push(value),
    log: value => logs.push(value), status: value => states.push(value),
    schedule: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; },
    cancel: timer => { if (timer) timer.cancelled = true; }, ...options
  });
  return { runner, sockets, sent, logs, qr, states, timers };
}

test('connect-only mode renders QR, connects and never sends a message', async () => {
  const h = harness();
  h.sockets[0].ev.emit('connection.update', { qr: 'fake-qr', connection: 'open' });
  await tick();
  assert.deepEqual(h.qr, ['fake-qr']);
  assert.deepEqual(h.sent, []);
  assert.equal(h.sockets[0].config.shouldSyncHistoryMessage({}), false);
  assert.equal(h.states.at(-1), 'connected');
  h.runner.stop(); assert.equal(await h.runner.done, 0);
});

test('explicit self-test sends exactly once and only to the authenticated account', async () => {
  const h = harness({ selfTest: true });
  h.sockets[0].ev.emit('connection.update', { connection: 'open' });
  h.sockets[0].ev.emit('connection.update', { connection: 'open' });
  assert.equal(await h.runner.done, 0);
  assert.deepEqual(h.sent, [['5511999999999@s.whatsapp.net', { text: SELF_TEST_TEXT }]]);
  assert.ok(h.logs.every(line => !line.includes('5511999999999')));
});

test('a background process never writes an authentication QR to logs', async () => {
  const h = harness({ headless: true });
  h.sockets[0].ev.emit('connection.update', { qr: 'secret-authentication-qr' });
  assert.equal(await h.runner.done, 0);
  assert.deepEqual(h.qr, []); assert.deepEqual(h.sent, []);
  assert.equal(h.states.at(-1), 'needs_link');
});

test('fatal authentication errors stop instead of replacing another linked connection', async () => {
  for (const code of [401, 403, 411, 440, 500]) {
    const h = harness({ headless: true });
    h.sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: code } } } });
    assert.equal(await h.runner.done, 0); assert.equal(h.sockets.length, 1);
    assert.equal(h.timers.length, 0); assert.deepEqual(h.sent, []);
  }
});

test('expected QR restart reconnects; obsolete socket events cannot send or change status', async () => {
  const h = harness();
  h.sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 515 } } } });
  await tick(); assert.equal(h.timers[0].delay, 0);
  h.timers[0].fn();
  h.sockets[0].ev.emit('connection.update', { qr: 'obsolete' });
  h.sockets[1].ev.emit('connection.update', { connection: 'open' });
  await tick(); assert.deepEqual(h.qr, []); assert.deepEqual(h.sent, []);
  assert.equal(h.states.at(-1), 'connected'); h.runner.stop();
});

test('self-test refuses an unknown account identifier instead of accepting a recipient', async () => {
  assert.throws(() => ownJid({ id: '120363000000@g.us' }));
  const h = harness({ selfTest: true });
  h.sockets[0].user = {};
  h.sockets[0].ev.emit('connection.update', { connection: 'open' });
  assert.equal(await h.runner.done, 1); assert.deepEqual(h.sent, []);
});

test('failed self-test delivery is never retried', async () => {
  const h = harness({ selfTest: true });
  h.sockets[0].sendMessage = async (...args) => { h.sent.push(args); throw new Error('unknown delivery'); };
  h.sockets[0].ev.emit('connection.update', { connection: 'open' });
  assert.equal(await h.runner.done, 1);
  h.sockets[0].ev.emit('connection.update', { connection: 'open' });
  await tick(); assert.equal(h.sent.length, 1);
});

test('local sessions are private, outside the repository, and locked against concurrent processes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'streetball-wa-test-'));
  try {
    const paths = statePaths(home, 'darwin'); prepareState(paths);
    assert.equal(fs.statSync(paths.auth).mode & 0o777, 0o700);
    assert.equal(hasSession(paths), false);
    fs.writeFileSync(path.join(paths.auth, 'creds.json'), '{"registered":false,"me":{"id":"5511999999999:7@s.whatsapp.net"}}', { mode: 0o600 });
    assert.equal(hasSession(paths), true);
    const release = acquireLock(paths);
    assert.throws(() => acquireLock(paths), /já está ativo/);
    release(); const next = acquireLock(paths); next();
    fs.writeFileSync(paths.lock, '{broken');
    assert.throws(() => acquireLock(paths), /controle/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('QR-linked credentials from the installed Baileys adapter are recognized after saving and reloading', async () => {
  const { useMultiFileAuthState } = await import('baileys');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'streetball-wa-qr-test-'));
  try {
    const paths = statePaths(home, 'darwin'); prepareState(paths);
    const { state, saveCreds } = await useMultiFileAuthState(paths.auth);
    assert.equal(state.creds.registered, false);
    assert.equal(hasSession(paths), false);
    // This is the update shape emitted by configureSuccessfulPairing for QR login.
    state.creds.me = { id: '5511999999999:7@s.whatsapp.net', name: 'Test account' };
    await saveCreds();
    assert.equal(JSON.parse(fs.readFileSync(path.join(paths.auth, 'creds.json'), 'utf8')).registered, false);
    assert.equal(hasSession(paths), true);
    const reloaded = await useMultiFileAuthState(paths.auth);
    assert.equal(reloaded.state.creds.me.id, state.creds.me.id);
    assert.equal(reloaded.state.creds.registered, false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('registration flag alone and malformed credentials are not treated as a linked account', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'streetball-wa-unlinked-test-'));
  try {
    const paths = statePaths(home, 'darwin'); prepareState(paths);
    for (const data of ['{"registered":true}', '{"registered":false}', '{"me":{"id":""}}', '{invalid', '{"me":{"id":"120363000000@g.us"}}']) {
      fs.writeFileSync(path.join(paths.auth, 'creds.json'), data, { mode: 0o600 });
      assert.equal(hasSession(paths), false);
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('connected state and self-test wait until credentials are written', async () => {
  let flush;
  const pending = new Promise(resolve => { flush = resolve; });
  const h = harness({ selfTest: true, saveCreds: () => pending });
  h.sockets[0].ev.emit('connection.update', { connection: 'open' });
  await tick();
  assert.ok(!h.states.includes('connected')); assert.deepEqual(h.sent, []);
  flush();
  assert.equal(await h.runner.done, 0); assert.equal(h.sent.length, 1);
});

test('stopping a connection waits for pending credential writes', async () => {
  let flush;
  const pending = new Promise(resolve => { flush = resolve; });
  const h = harness({ saveCreds: () => pending });
  h.sockets[0].ev.emit('creds.update', {});
  await tick(); h.runner.stop();
  let stopped = false; h.runner.done.then(() => { stopped = true; });
  await tick(); assert.equal(stopped, false);
  flush(); assert.equal(await h.runner.done, 0);
});

test('a failed credential write prevents connected state and sending', async () => {
  const h = harness({ selfTest: true, saveCreds: async () => { throw new Error('disk full'); } });
  h.sockets[0].ev.emit('connection.update', { connection: 'open' });
  assert.equal(await h.runner.done, 1);
  assert.ok(!h.states.includes('connected')); assert.deepEqual(h.sent, []);
});

test('stopping waits for the store bridge before releasing the connection', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const h = harness({ onDisconnected: () => pending });
  h.runner.stop();
  let finished = false; h.runner.done.then(() => { finished = true; });
  await tick(); assert.equal(finished, false);
  release(); assert.equal(await h.runner.done, 0);
});

test('launchd arguments escape spaces and XML characters without invoking a shell', () => {
  const xml = launchAgent({ node: '/usr/local/bin/node', directory: '/Users/Test & Co/Streetball', log: '/Users/Test & Co/log.txt' });
  assert.ok(xml.includes('Test &amp; Co'));
  assert.ok(xml.includes('<string>connect</string><string>--background</string>'));
  assert.ok(!xml.includes('/bin/sh'));
  assert.ok(xml.includes('<key>SuccessfulExit</key><false/>'));
});
