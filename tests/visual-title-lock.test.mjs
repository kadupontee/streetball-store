import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync('public/app.js', 'utf8');
const begin = app.indexOf('function displayTitle(p){');
const end = app.indexOf('// Proteção visual:', begin);
assert.ok(begin >= 0 && end > begin, 'displayTitle precisa existir no app.js');
const displayTitle = vm.runInNewContext(app.slice(begin, end)+'\ndisplayTitle', {
  niceCase: s => s, REPLACEMENTS: [], String, Number
});

test('foto revisada substitui título antigo do fornecedor na vitrine', () => {
  const p = {
    id: 'YUP-220839632',
    title: 'São Paulo — Casaco Longo Preto',
    supplierTitle: 'Sao Paulo 2111758268 509',
    kind: 'coat',
    visualReviewStatus: 'foto_local_conferida_2026-10-22'
  };
  assert.equal(displayTitle(p), 'São Paulo — Casaco Longo Preto');
});

test('produto sem revisão não recebe título manual forçado', () => {
  const p = {
    id: 'YUP-999999999',
    title: 'Título genérico',
    supplierTitle: 'Real Madrid Home Jersey',
    kind: 'fan'
  };
  const result = displayTitle(p);
  assert.match(result, /Real Madrid/i);
  assert.notEqual(result, p.title);
});
