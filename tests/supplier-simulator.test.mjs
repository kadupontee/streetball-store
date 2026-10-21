import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../public/suppliers.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'Script do painel precisa existir');
const flow=script.match(/function simulateAvailability\(stages\)\{([\s\S]*?)\n\}\nfunction renderSimulation/)?.[1];
assert.ok(flow,'Função pura da simulação precisa existir');
const simulate=new Function('stages',flow);
const stage=(name,reply)=>({name,reply});

test('painel e lógica do simulador têm sintaxe válida',()=>{
 assert.doesNotThrow(()=>new Function(script));
 assert.match(html,/SIMULAR CONSULTAS SEM ENVIO/);
 assert.match(html,/data-sim-id/);
});

test('consulta o próximo fornecedor somente após negativa explícita',()=>{
 const result=simulate([
  stage('Primeiro','unavailable'),
  stage('Segundo','unavailable'),
  stage('Terceiro','available'),
  stage('Quarto','unavailable')
 ]);
 assert.equal(result.status,'availability_reported');
 assert.equal(result.steps.length,3);
 assert.match(result.outcome,/Terceiro/);
 assert.doesNotMatch(result.steps.join(' '),/Quarto/);
});

test('silêncio de 24h e resposta ambígua não são tratados como falta de estoque',()=>{
 for(const reply of ['silence','unclear']){
  const result=simulate([stage('Primeiro',reply),stage('Segundo','available')]);
  assert.equal(result.status,'manual_review');
  assert.equal(result.steps.length,1);
 }
});

test('todos indisponíveis exigem revisão sem reembolso automático',()=>{
 const result=simulate([stage('A','unavailable'),stage('B','unavailable'),stage('C','unavailable')]);
 assert.equal(result.status,'all_unavailable');
 assert.equal(result.steps.length,3);
 assert.match(result.outcome,/Revisão manual/);
});

test('simulador é exclusivo do navegador e não usa credenciais ou mensagens',()=>{
 const callback=script.match(/\$\('simulateStock'\)\.addEventListener\('click',\(\)=>\{([\s\S]*?)\n\}\);/)?.[1];
 assert.ok(callback);
 assert.doesNotMatch(callback,/\bapi\(|\bfetch\(|\bWebSocket\b/);
 assert.match(callback,/Nenhuma mensagem enviada/);
});
