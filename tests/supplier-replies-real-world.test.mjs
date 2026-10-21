import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyStockReply,classifySupplierMessage,supplierReplyAction} from '../worker/supplier-replies.js';

const classified=(text,ctx='wamid.consulta_ficticia')=>classifyStockReply(text,ctx)?.kind||null;

test('respostas afirmativas curtas só são estoque positivo quando vinculadas à consulta',()=>{
 for(const text of ['sim','Sim!','S','yes','yep','sí','tem','temos','disponível','tenho em estoque','in stock','available','有货']){
  assert.equal(classified(text),'available',text);
  assert.equal(classifyStockReply(text),null,text+' solto');
 }
});
test('respostas negativas curtas vinculadas não são confirmação de pedido',()=>{
 for(const text of ['não','nao','n','no','nope','não temos','não tenho','sem estoque','esgotado','indisponível','out of stock','sold out','没货']){
  assert.equal(classified(text),'unavailable',text);
 }
});
test('ok, certo, perfeito e pronto são confirmações de leitura, não de estoque',()=>{
 for(const text of ['ok','OK!','okay','certo','perfeito','pronto','entendi','blz','👌','obrigado']){
  assert.equal(classified(text),'ack',text);
  assert.equal(supplierReplyAction(classified(text),'awaiting_reply'),'manual_review',text);
  assert.equal(supplierReplyAction(classified(text),'details_sent'),'manual_review',text);
 }
});
test('preços cotados e frete não confirmam disponibilidade e não autorizam pagamento',()=>{
 for(const text of ['15$','15 + 4 = 19$','$19','USD 19','R$ 100,00']){
  assert.equal(classified(text),'quote',text);
 }
 for(const text of ['Por favor efetue o pagamento através deste link','Enviarei o link de pagamento','Preciso do CPF','Pagamento confirmado']){
  assert.equal(classified(text),'payment_or_personal_data',text);
 }
});
test('perguntas sobre tamanho, patch, entrega e atualizações de produção exigem atenção',()=>{
 for(const text of ['Qual é o tamanho de que você precisa?','Precisa de um remendo?','what size?', 'por favor envie-me seu endereço de entrega']){
  assert.equal(classified(text),'question',text);
 }
 assert.equal(classified('Perfeito. Por favor aguarde alguns dias e enviarei as fotos para confirmação.'),'production_update');
});
test('resposta incerta sobre estoque é inconclusiva, mas deve consultar outro',()=>{
 for(const text of ['talvez amanhã','pode ser','estou vendo','depende do tamanho','só tenho outro modelo']){
  assert.equal(classified(text),'ambiguous',text);
  assert.equal(supplierReplyAction(classified(text),'awaiting_reply'),'next_supplier',text);
 }
});
test('mensagens só promovem estado correto da compra',()=>{
 assert.equal(supplierReplyAction('available','awaiting_reply'),'check_stock_details');
 assert.equal(supplierReplyAction('available','details_sent'),'no_change');
 assert.equal(supplierReplyAction('unavailable','details_sent'),'manual_review');
 assert.equal(supplierReplyAction('confirmar','awaiting_reply'),'no_change');
 assert.equal(supplierReplyAction('confirmar','details_sent'),'confirm_order');
 assert.equal(supplierReplyAction('ambiguous','details_sent'),'manual_review');
});
test('botões Meta com ID e código de pedido são interpretados e botões soltos não',()=>{
 const cases={STOCK_YES_1234abcd:'available',STOCK_NO_1234abcd:'unavailable',STOCK_UNSURE_1234abcd:'ambiguous',ORDER_CONFIRM_1234abcd:'confirmar'};
 for(const [id,expected] of Object.entries(cases)){
  const button={type:'button',button:{payload:id,text:'resposta curta'},id:'wamid.falso',from:'8613800138000'};
  assert.deepEqual(classifySupplierMessage(button),{kind:expected,orderShort:'1234abcd',byContext:false});
  const interactive={type:'interactive',interactive:{type:'button_reply',button_reply:{id,title:'OK'}}};
  assert.deepEqual(classifySupplierMessage(interactive),{kind:expected,orderShort:'1234abcd',byContext:false});
 }
 assert.equal(classifySupplierMessage({type:'button',button:{payload:'SIM'}}),null);
});
test('áudio, imagem, recibo e documento não confirmam nada automaticamente',()=>{
 for(const type of ['image','audio','voice','video','document','sticker']){
  assert.equal(classifySupplierMessage({type,text:{body:'sim'},context:{id:'wamid.consulta'}}),null);
 }
});
