import test from 'node:test';
import assert from 'node:assert/strict';
import {messageSummary,previewSupplierOrder} from '../worker/fulfillment.js';

const single={id:'test',title:'Real Madrid Third 2016/17 Retro Roxa',size:'P',qty:1,patch:false,personalize:false,image:'/images/camisa.jpg'};
test('consulta inicial inclui tamanho, quantidade, opção sem patch e sem personalização',()=>{
 const text=messageSummary([single]);
 assert.match(text,/Real Madrid/);
 assert.match(text,/tamanho P x1/);
 assert.match(text,/sem patch/);
 assert.match(text,/sem personalização/);
 assert.match(text,/exatamente 1 peça/);
 assert.match(text,/sem acrescentar itens/);
 assert.match(text,/frete grátis/);
 assert.ok(text.length<=350);
});
test('duas camisas preservam exatamente duas mesmo conhecendo promoção de três',()=>{
 const text=messageSummary([{...single,qty:2}]);
 assert.match(text,/exatamente 2 peça/);
 assert.match(text,/frete grátis/);
 assert.ok(text.length<=350);
});
test('pedidos com três camisas não pedem unidades extras e confirmam condição de frete',()=>{
 const text=messageSummary([{...single,qty:3}]);
 assert.match(text,/3\+ peças/);
 assert.match(text,/Manter exatamente 3 peça/);
 assert.doesNotMatch(text,/sem acrescentar itens/);
});
test('prévia aponta imagem de cabeçalho, resumo de frete e permanece sem envio no Sandbox',()=>{
 const env={
  WA_AUTOMATION_ENABLED:'false',ASAAS_SANDBOX:'true',
  STORE_PUBLIC_URL:'https://streetball-store.kpgmer.workers.dev',
  SUPPLIERS_JSON:JSON.stringify([{id:'test',phone:'8613800138000',template:'pedido_fornecedor',mediaTemplate:'pedido_fornecedor_foto'}])
 };
 const preview=previewSupplierOrder(env,{id:'12345678-0000-0000-0000-000000000000',
  status:'paid_supplier_pending',items_json:JSON.stringify([single])});
 assert.equal(preview.firstPhotoUrl,'https://streetball-store.kpgmer.workers.dev/images/camisa.jpg');
 assert.match(preview.messageSummary,/frete grátis/);
 assert.equal(preview.readyForAutomaticSending,false);
 assert.equal(preview.checks.whatsappAutomationDisabled,true);
});
test('nota do frete permanece incluída mesmo com muitos produtos',()=>{
 const items=Array.from({length:15},(_,i)=>({...single,title:'Camisa de Futebol Clube '+i,qty:1}));
 const text=messageSummary(items);
 assert.ok(text.length<=350);
 assert.match(text,/exatamente 15 peça/);
 assert.match(text,/frete grátis/);
});
