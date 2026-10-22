import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierPhotoRequest,TEMPLATE_BODY_FEWER_THAN_3,TEMPLATE_BODY_3_OR_MORE} from '../worker/supplier-order-format.js';
import {previewSupplierOrder} from '../worker/fulfillment.js';
const one={id:'camisa',title:'Camisa Real Madrid Third 2016/2017 — Roxa (Retrô)',size:'P',
 qty:1,patch:false,personalize:false,image:'/images/camisa.jpg'};
const make=(items,city='São Paulo')=>({id:'12345678-1234-4234-8234-123456789012',
 status:'paid_supplier_pending',city,state:'SP',items_json:JSON.stringify(items)});

test('texto da consulta é exatamente o formato escolhido sem saudação, ID, perguntas extras',()=>{
 const out=supplierPhotoRequest(make([one]));
 assert.equal(out.variant,'fewer_than_3');
 assert.equal(out.args.length,7);
 assert.equal(out.text,`Produto: Camisa Real Madrid Third 2016/2017 — Roxa (Retrô)

Detalhes:

* Foto do produto: enviada em anexo
* Tamanho: P (S)
* Quantidade: 1 unidade
* Personalização: Não
* Patch: Não
* Entrega: São Paulo, Brasil

Sei que vocês oferecem frete grátis para pedidos de 3 peças ou mais, mas gostaria de comprar apenas 1 unidade mesmo, pagando o frete correspondente.`);
 assert.doesNotMatch(out.text,/pedido [a-f0-9]{8}|confirme|obrigado|streetball|olá/i);
 assert.match(TEMPLATE_BODY_FEWER_THAN_3,/apenas \{\{7\}\} mesmo/);
});

test('pedido de duas unidades mantém duas unidades, pagando frete',()=>{
 const out=supplierPhotoRequest(make([{...one,size:'S',qty:2}],'Osasco'));
 assert.match(out.text,/Tamanho: P \(S\)/);
 assert.match(out.text,/2 unidades/);
 assert.match(out.text,/Ent(r|r)ega: Osasco, Brasil/);
 assert.match(out.text,/apenas 2 unidades mesmo/);
 assert.equal(out.variant,'fewer_than_3');
});

test('a partir de três unidades mantém quantidade mas evita a frase pagar frete',()=>{
 const out=supplierPhotoRequest(make([{...one,qty:3,patch:true,personalize:true,customName:'KADU',customNumber:'10'}]));
 assert.equal(out.variant,'three_or_more');
 assert.match(out.text,/Quantidade: 3 unidades/);
 assert.match(out.text,/Personalização: Sim \(KADU \/ 10\)/);
 assert.match(out.text,/Patch: Sim/);
 assert.match(out.text,/exatamente 3 unidades/);
 assert.doesNotMatch(out.text,/pagando o frete correspondente/);
 assert.match(TEMPLATE_BODY_3_OR_MORE,/mantendo essa quantidade/);
});

test('não consultar fornecedor com apenas foto do primeiro modelo de um pedido múltiplo',()=>{
 assert.equal(supplierPhotoRequest(make([one,{...one,id:'outra',title:'Camisa Braga 2026'}])),null);
 const env={WA_AUTOMATION_ENABLED:'false',ASAAS_SANDBOX:'true',STORE_PUBLIC_URL:'https://loja.exemplo.com',
  SUPPLIERS_JSON:JSON.stringify([{id:'china',phone:'8613800138000',template:'consulta_foto',mediaTemplate:'consulta_foto'}])};
 const preview=previewSupplierOrder(env,make([one,{...one,id:'outra'}]));
 assert.equal(preview.supplierMessage,null);
 assert.equal(preview.checks.supportedSingleProductOrder,false);
 assert.equal(preview.readyForAutomaticSending,false);
});

test('falta de cidade impede texto com destino fictício e não faz envio',()=>{
 assert.equal(supplierPhotoRequest(make([one],'')),null);
});

test('prévia no Sandbox mostra texto exato mas desabilita todos os envios',()=>{
 const env={ASAAS_SANDBOX:'true',WA_AUTOMATION_ENABLED:'false',
  SUPPLIER_TEMPLATE_FORMAT:'minimal_v1',STORE_PUBLIC_URL:'https://loja.exemplo.com',
  SUPPLIER_WA_TEMPLATE_MEDIA:'consulta_estoque_nova',
  SUPPLIERS_JSON:JSON.stringify([{id:'china',phone:'8613800138000',template:'consulta_estoque_nova',mediaTemplate:'consulta_estoque_nova'}])};
 const preview=previewSupplierOrder(env,make([one]));
 assert.equal(preview.supplierMessage,supplierPhotoRequest(make([one])).text);
 assert.equal(preview.supplierMessageVariant,'fewer_than_3');
 assert.equal(preview.firstPhotoUrl,'https://loja.exemplo.com/images/camisa.jpg');
 assert.equal(preview.checks.minimalTemplateFormatConfigured,true);
 assert.equal(preview.readyForAutomaticSending,false);
 assert.doesNotMatch(preview.supplierMessage,/12345678/);
});
