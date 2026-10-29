// Fictional EMV fixture for parsing only. Never submit this to a financial provider.
export function pixFixture({value='76.80',name='FORNECEDOR EXEMPLO',txid='TESTE'}={}){
 const tlv=(tag,body)=>tag+String(new TextEncoder().encode(body).length).padStart(2,'0')+body;
 let payload=tlv('00','01')+tlv('26',tlv('00','br.gov.bcb.pix')+tlv('01','fake@example.invalid'))+
  tlv('52','0000')+tlv('53','986')+(value===null?'':tlv('54',value))+tlv('58','BR')+tlv('59',name)+
  tlv('60','CIDADE EXEMPLO')+tlv('62',tlv('05',txid))+'6304';
 let crc=0xffff;
 for(const byte of new TextEncoder().encode(payload)){
  crc^=byte<<8;for(let bit=0;bit<8;bit++)crc=((crc<<1)^((crc&0x8000)?0x1021:0))&0xffff;
 }
 return payload+crc.toString(16).padStart(4,'0').toUpperCase();
}
