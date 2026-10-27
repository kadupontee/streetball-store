// Supplier content is evidence, never an instruction or an authorization to debit.
export const BILLING_TEXT_LIMIT=6000;
export const BILLING_FORMAT_VERSION='supplier-billing-v2-shared-costs';
const normalized=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const unique=values=>[...new Set(values)];

export function billingOrderReferences(text){
 const pattern=/(?:\b(?:pedido|order|cobranca|invoice)\s*(?:id|n[º°.]?)?\s*[:#-]?\s*|订单\s*[:：#]?\s*)([a-f0-9]{8})(?=$|[^a-f0-9])/giu;
 return unique([...normalized(text).matchAll(pattern)].map(m=>m[1].toLowerCase()));
}

/** Validate the complete EMV envelope and CRC; the bank must still decode it. */
export function inspectPixPayload(value){
 if(typeof value!=='string'||value.length<50||value.length>2048||!value.startsWith('000201')||
  /[\u0000-\u001f\u007f]/.test(value))return null;
 const bytes=new TextEncoder().encode(value),fields=new Map();let pos=0;
 while(pos<bytes.length){
  if(pos+4>bytes.length)return null;
  const header=String.fromCharCode(...bytes.slice(pos,pos+4));
  if(!/^\d{4}$/.test(header))return null;
  const tag=header.slice(0,2),size=Number(header.slice(2));pos+=4;
  if(pos+size>bytes.length||fields.has(tag))return null;
  const body=new TextDecoder('utf-8',{fatal:true});let content;
  try{content=body.decode(bytes.slice(pos,pos+size));}catch{return null;}
  fields.set(tag,content);pos+=size;
  if(tag==='63'&&(size!==4||pos!==bytes.length))return null;
 }
 if(fields.get('00')!=='01'||fields.get('53')!=='986'||!/^br$/i.test(fields.get('58')||'')||
  ![...fields].some(([tag,body])=>Number(tag)>=26&&Number(tag)<=51&&/br\.gov\.bcb\.pix/i.test(body)))return null;
 const checksum=fields.get('63');if(!/^[a-f0-9]{4}$/i.test(checksum||''))return null;
 let crc=0xffff;
 for(const byte of bytes.slice(0,-4)){
  crc^=byte<<8;for(let bit=0;bit<8;bit++)crc=((crc<<1)^((crc&0x8000)?0x1021:0))&0xffff;
 }
 if(crc.toString(16).padStart(4,'0').toUpperCase()!==checksum.toUpperCase())return null;
 const rawAmount=fields.get('54');
 if(rawAmount!==undefined&&(rawAmount.length>13||!/^\d+(?:\.\d{1,2})?$/.test(rawAmount)))return null;
 return {payload:value,amountBrl:rawAmount===undefined?null:amount(rawAmount)};
}

function pixCodes(text){
 const valid=[],invalid=[];
 // Byte lengths come from EMV, so embedded spaces and Unicode merchant names survive.
 let consumedUntil=0;
 for(const m of text.matchAll(/000201/g)){
  if(m.index<consumedUntil)continue;
  const tail=text.slice(m.index),bytes=new TextEncoder().encode(tail);let pos=0,end=0;
  while(pos+4<=bytes.length&&pos<2048*4){
   const header=String.fromCharCode(...bytes.slice(pos,pos+4));if(!/^\d{4}$/.test(header))break;
   const tag=header.slice(0,2),size=Number(header.slice(2));pos+=4+size;
   if(pos>bytes.length)break;
   if(tag==='63'){end=pos;break;}
  }
  let candidate='';try{if(end)candidate=new TextDecoder('utf-8',{fatal:true}).decode(bytes.slice(0,end));}catch{}
  const parsed=inspectPixPayload(candidate);
  if(parsed){valid.push(parsed);consumedUntil=m.index+candidate.length;}else invalid.push(m.index);
 }
 return {valid:[...new Map(valid.map(x=>[x.payload,x])).values()],invalid:invalid.length};
}

function amount(text){
 const raw=text.trim();let value;
 if(/^\d{1,12}(?:[.,]\d{1,2})?$/.test(raw))value=raw.replace(',','.');
 else if(/^\d{1,3}(?:\.\d{3})+,\d{2}$/.test(raw))value=raw.replaceAll('.','').replace(',','.');
 else if(/^\d{1,3}(?:,\d{3})+\.\d{2}$/.test(raw))value=raw.replaceAll(',','');
 else return null;
 const [whole,part='']=value.split('.');return whole+'.'+part.padEnd(2,'0');
}

/** Deliberately does not infer that an unlabelled "$" means USD or that the Pix is the quote. */
function quotedTotals(text){
 const totals=[],unclear=[];
 for(const line of text.split(/\r?\n/)){
  const s=normalized(line).trim();
  const m=s.match(/^(?:total(?:\s+(?:a pagar|do pedido|geral|brl|usd))?|valor total|amount due|grand total|总计|合计)\s*[:=]?\s*(brl|r\$|usd|us\$|\$|cny|rmb|¥)?\s*([\d.,]+)\s*(brl|reais|usd|dollars|cny|rmb|元)?\s*$/u);
  if(!m)continue;
  const prefix=m[1]||'',suffix=m[3]||'',label=s.startsWith('total brl')?'brl':s.startsWith('total usd')?'usd':'';
  const currency=v=>/^(?:brl|r\$|reais)$/.test(v)?'BRL':/^(?:usd|us\$|dollars)$/.test(v)?'USD':/^(?:cny|rmb|¥|元)$/.test(v)?'CNY':null;
  const currencies=unique([currency(label),currency(prefix),currency(suffix)].filter(Boolean));
  const value=amount(m[2]);
  if(currencies.length!==1||!value||((prefix==='$')&&!suffix)){unclear.push('ambiguous_total');continue;}
  totals.push({currency:currencies[0],value});
 }
 return {totals:[...new Map(totals.map(x=>[x.currency+':'+x.value,x])).values()],unclear};
}

export function isSupplierBilling(text,mediaType=''){
 const s=normalized(text);
 return !!mediaType||/000201|https?:\/\/|\b(?:pix|boleto|cobranca|fatura|invoice|payment|pagar|pagamento|preco|frete|shipping|orcamento|quote|cost|custo|bill|bytemax)\b|(?:r\$|us\$|usd|brl|\$)\s*\d|\d[\d.,]*\s*(?:usd|brl|\$)|(?:付款|支付|收款)/iu.test(s)||
  /^\s*\d+[\d.,]*(?:\s*\+\s*\d+[\d.,]*)*(?:\s*=\s*\d+[\d.,]*)?\s*\$?\s*$/u.test(s);
}

/** A provider-independent envelope. Complete does not mean approved, audited or paid. */
export function normalizeSupplierBilling(text,mediaType=''){
 const raw=String(text??'');
 const parsed=pixCodes(raw),quoted=quotedTotals(raw),formats=[];
 const links=unique([...raw.matchAll(/https?:\/\/[^\s<>"']+/giu)].map(m=>m[0].replace(/[),.;]+$/,'')).filter(v=>v.length<=1500)).slice(0,5);
 if(parsed.valid.length||parsed.invalid)formats.push('pix_copy_paste');
 if(links.length)formats.push('payment_link');
 if(/\b(?:boleto|linha digitavel|barcode)\b/i.test(normalized(raw)))formats.push('boleto');
 if(/\b(?:chave pix|pix key)\b/i.test(normalized(raw)))formats.push('pix_key');
 if(mediaType)formats.push(mediaType==='document'?'document':'media');
 if(quoted.totals.length)formats.push('quote');
 if(!formats.length)formats.push('text');
 const rates=[...raw.split(/\r?\n/).map(line=>normalized(line).trim().match(/^(?:cambio(?:\s+brl(?:\s+por\s+usd)?)?|exchange rate|usd\/brl|usd to brl|taxa de cambio)\s*[:=]?\s*(\d+(?:[.,]\d{1,6})?)\s*(?:brl|r\$)?$/i)?.[1]).filter(Boolean)].map(value=>value.replace(',','.'));
 const distinctRates=[...new Set(rates.map(value=>{
  if(value.length>24)return null;
  const [whole,fraction='']=value.split('.'),part=fraction.replace(/0+$/,'');
  return BigInt(whole).toString()+(part?'.'+part:'');
 }).filter(Boolean))];
 const issues=[...quoted.unclear];
 if(rates.length&&!distinctRates.length)issues.push('invalid_exchange_rate');
 if(distinctRates.length>1)issues.push('conflicting_exchange_rates');
 if(raw.length>BILLING_TEXT_LIMIT)issues.push('message_too_long');
 if(parsed.invalid)issues.push('invalid_pix');
 if(parsed.valid.length>1)issues.push('multiple_pix');
 const brl=quoted.totals.filter(x=>x.currency==='BRL');
 const dollars=quoted.totals.filter(x=>x.currency==='USD');
 if(brl.length>1)issues.push('conflicting_brl_totals');
 if(dollars.length>1)issues.push('conflicting_usd_totals');
 if(!brl.length)issues.push('missing_brl_total');
 if(parsed.valid.length===0)issues.push(mediaType?'attachment_needs_text':'missing_pix_copy_paste');
 const pix=parsed.valid.length===1?parsed.valid[0]:null,total=brl.length===1?brl[0].value:null;
 if(pix?.amountBrl&&total&&BigInt(pix.amountBrl.replace('.',''))!==BigInt(total.replace('.','')))issues.push('pix_quote_mismatch');
 return {version:BILLING_FORMAT_VERSION,formats:unique(formats),orderReferences:billingOrderReferences(raw),
  totals:quoted.totals,quotedTotalBrl:total,quotedTotalUsd:dollars.length===1?dollars[0].value:null,quotedExchangeRateBrlPerUsd:distinctRates.length===1?distinctRates[0]:null,pixPayload:pix?.payload??null,pixAmountBrl:pix?.amountBrl??null,
  links,issues:unique(issues),readyForCheck:issues.length===0};
}

export function billingRequestText(orderId,kind='details'){
 const short=String(orderId).slice(0,8);
 if(kind==='reference')return 'Para identificar a cobrança, responda à mensagem deste pedido ou escreva COBRANÇA '+short+'. Envie o orçamento e o Pix Copia e Cola vinculados a esse pedido.\nTo identify the bill, reply to this order message or write INVOICE '+short+'. Include the itemized quote and Pix copy-and-paste code.';
 return 'Cobrança do pedido '+short+': envie em uma única mensagem o orçamento detalhado (quantidade, preço por item, frete, câmbio e taxas), a moeda e o total final em reais como “Total BRL: 100,00”, o nome/documento do recebedor e o Pix Copia e Cola completo. Mesmo que use outro site, foto, PDF, boleto ou QR Code, precisamos desses dados por texto. Responda a esta mensagem ou escreva COBRANÇA '+short+'.\nOrder '+short+': please send in one message the itemized quote (quantity, unit prices, shipping, exchange rate and fees), currency, final total as “Total BRL: 100.00”, payee name/tax ID and full Pix copy-and-paste code as text. Reply to this message or include INVOICE '+short+'.';
}
