/**
 * Classificação conservadora de mensagens de fornecedores para o catálogo compartilhado.
 * Nenhum resultado inicia pagamento, e mensagens curtas exigem correlação com consulta exata.
 * Não reproduza mensagens com dados pessoais em testes, logs ou prévias.
 */
const normalize=input=>String(input??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
const result=(kind,orderShort=null,byContext=false)=>({kind,orderShort,byContext});
const token=/(?:^|\s)([a-f0-9]{8})(?:$|\s)/i;
const commands={
 'semestoque':'unavailable','esgotado':'unavailable','indisponivel':'unavailable',
 'disponivel':'available','temos':'available','confirmar':'confirmar',
 'preparando':'preparando','detalhes':'detalhes'
};
const clean=s=>s.replace(/[.!?\s]+$/g,'').trim();
const negative=/^(?:nao|n|no|nope|nao tenho|nao temos|nao tem|sem estoque|esgotad[oa]|esgotou|indisponivel|em falta|esta em falta|fora de estoque|sem disponibilidade|out of stock|sold out|not available|not in stock|no stock|not now|sem essa|nao disponivel|没有|没货|无货)$/u;
const positive=/^(?:sim|s|yes|yeah|yep|si|tenho|temos|tem|tem sim|temos sim|sim temos|tenho sim|disponivel|disponivel sim|temos disponivel|temos em estoque|tenho em estoque|em estoque|disponivel agora|in stock|available|yes available|have it|we have it|有货|有现货|可以)$/u;
const ack=/^(?:ok|okay|okey|okk+|blz|beleza|certo|entendi|perfeito|pronto|recebido|obrigado|thanks|thank you|alright|roger|combinado|👍|👌|✅|好|好的)$/u;
const question=/\?|\b(?:qual (?:e )?(?:o |a )?(?:tamanho|numero)|que tamanho|qual tamanho|precisa (?:de )?(?:um )?(?:patch|remendo)|tem (?:nome|numero)|com ou sem|qual o endereco|por favor envie|informe|me envie|what size|which size|do you need|please send|send me your|size\?|尺码|什么码)\b/iu;
const quote=/^(?:[\d.,]+\s*(?:\+\s*[\d.,]+\s*)?(?:=\s*[\d.,]+\s*)?(?:\$|usd|r\$|dolares?|reais)?\s*|(?:usd|r\$|\$)\s*[\d.,]+)$/iu;
const money=/\b(?:pagamento|pagar|pay(?:ment)?|transfer|pix|comprovante|recibo|fatura|invoice|bytemax|payment link|link de pagamento|cpf|cnpj|preco|frete|shipping)\b|https?:\/\//iu;
const production=/\b(?:aguarde alguns dias|enviarei (?:as )?fotos|fotos para confirmacao|vamos preparar|vou preparar|ja esta em preparacao|wait a few days|send (?:you )?photos|preparing)\b/iu;

/**
 * @param {string} body message body
 * @param {string} contextId id of the quoted original message; actual validation occurs in webhook handler
 */
export function classifyStockReply(body,contextId=''){
 const raw=normalize(body).slice(0,400);
 if(!raw)return null;
 const command=raw.match(/^(sem[_ -]?estoque|indisponivel|esgotado|disponivel|temos|confirmar|preparando|detalhes)\s+([a-f0-9]{8})$/);
 if(command){
  const verb=command[1].replace(/[_ -]/g,'');
  return result(commands[verb]||'ambiguous',command[2],false);
 }
 if(!contextId)return null; // "sim" livre nunca confirma estoque nem pedido.
 const txt=clean(raw);
 // A mensagem da conversa da imagem é uma cotação, não aprovação de estoque.
 if(quote.test(txt)||/\b\d+(?:[.,]\d+)?\s*(?:\$|usd|reais?)\b/.test(txt))return result('quote',null,true);
 if(money.test(txt))return result('payment_or_personal_data',null,true);
 if(question.test(txt))return result('question',null,true);
 if(production.test(txt))return result('production_update',null,true);
 if(ack.test(txt))return result('ack',null,true);
 if(negative.test(txt))return result('unavailable',null,true);
 if(positive.test(txt))return result('available',null,true);
 // "não sei", "talvez", "só mês que vem", afirmações parciais => próximo.
 return result('ambiguous',null,true);
}

/**
 * Quick reply IDs/payloads are defined by us on Meta-approved templates.
 * Never accept an unscoped YES or OK payload or UI label for a real order.
 */
export function classifySupplierMessage(message){
 if(!message||typeof message!=='object')return null;
 const contextId=message.context?.id||'';
 const button=message.button?.payload||message.interactive?.button_reply?.id||message.interactive?.list_reply?.id;
 if(typeof button==='string'){
  const m=button.trim().match(/^(STOCK_YES|STOCK_NO|STOCK_UNSURE|ORDER_CONFIRM)_([a-f0-9]{8})$/i);
  if(!m)return null;
  const type={STOCK_YES:'available',STOCK_NO:'unavailable',STOCK_UNSURE:'ambiguous',ORDER_CONFIRM:'confirmar'}[m[1].toUpperCase()];
  return result(type,m[2].toLowerCase(),false);
 }
 // Não tratar uma foto, um comprovante ou mensagem de voz como confirmação.
 if(message.type&&message.type!=='text')return null;
 return classifyStockReply(message.text?.body,contextId);
}

/** Só mensagens relacionadas à disponibilidade podem avançar o funil de estoque. */
export function supplierReplyAction(kind,stage){
 if(kind==='unavailable'||kind==='ambiguous')return stage==='awaiting_reply'?'next_supplier':'manual_review';
 if(kind==='available')return stage==='awaiting_reply'?'check_stock_details':'no_change';
 if(kind==='confirmar'||kind==='preparando')return stage==='details_sent'?'confirm_order':'no_change';
 if(['quote','question','payment_or_personal_data','production_update','ack'].includes(kind))return 'manual_review';
 return 'no_change';
}
