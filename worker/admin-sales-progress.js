const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
const stage=(id,label,state,detail,at=null)=>({id,label,state,detail,at:stamp(at)});
const payoutLabels={submitting:'Enviando a solicitação de Pix',submitted:'Pix enviado; aguardando confirmação bancária',authorized:'Pix autorizado; aguardando confirmação bancária',unknown:'Resultado do Pix inconclusivo; conferir no Asaas',needs_review:'Pix precisa de conferência',refused:'Pix recusado',cancelled:'Pix cancelado'};
const attemptLabels={awaiting_reply:'Consulta enviada; aguardando resposta',queued_local:'Consulta na fila de envio',confirmed:'Fornecedor confirmou o pedido',unavailable:'Fornecedor informou indisponibilidade',no_stock:'Fornecedor informou indisponibilidade',timed_out:'Prazo de resposta encerrado',timeout:'Prazo de resposta encerrado',skipped:'Consulta encerrada'};
const purposeLabels={stock_query:'Consulta de estoque',order_details:'Dados do pedido ao fornecedor',stock_details:'Detalhes para conferência de estoque',billing_request:'Solicitação de cobrança/Pix',supplier_payment_receipt:'Comprovante ao fornecedor',buyer_update:'Atualização ao comprador',buyer_delay:'Aviso de atraso ao comprador'};
export function salesProgress(snapshot){
 const {order,job,dispatch,payout,paidRecord,payment,events=[],messages=[],attempts=[],tracking=[],billing,bridge}=snapshot;
 const event=kind=>events.find(e=>e.kind===kind);
 const bankReceipt=!!payment?.received_at||!!event('PAYMENT_RECEIVED');
 const received=bankReceipt||['paid_supplier_pending','supplier_preparing'].includes(order.status);
 const confirmed=received||!!event('PAYMENT_CONFIRMED');
 const paymentAt=payment?.received_at||event('PAYMENT_RECEIVED')?.occurred_at||event('PAYMENT_CONFIRMED')?.occurred_at;
 const reversed=['payment_refunded','payment_disputed'].includes(order.status);
 const automaticPaid=payout?.state==='paid'&&payout?.bank_status==='DONE';
 const manualPaid=paidRecord?.source==='manual';
 const supplierConfirmed=dispatch?.state==='confirmed';
 const manuallyConfirmed=!supplierConfirmed&&job?.status==='supplier_confirmed';
 const shipment=tracking.find(t=>['shipped','international_transit','arrived_brazil','customs_inspection','tax_payment_due','tax_payment_confirmed','customs_released','out_for_delivery','delivered','exception'].includes(t.stage));
 const detailsSent=!!dispatch?.details_sent_at;
 const needsReview=['needs_review','needs_configuration','deadline_review'].includes(dispatch?.state)||['manual_review','supplier_attention','overdue_24h'].includes(job?.status);
 const stages=[stage('customer_payment','Pagamento do cliente',reversed?'attention':received?'done':confirmed?'active':'pending',
  reversed?(order.status==='payment_refunded'?'Pagamento reembolsado':'Pagamento em contestação'):bankReceipt?'Recebimento registrado pelo Asaas':received?'Recebimento registrado na loja':confirmed?'Confirmado pelo Asaas; aguardando recebimento':'Aguardando confirmação do pagamento',paymentAt),
  stage('supplier_contact','Consulta ao fornecedor',dispatch?.sent_at?'done':dispatch?.state==='queued_local'?'active':needsReview?'attention':'pending',
   dispatch?.sent_at?'Mensagem enviada; confira a resposta abaixo':dispatch?.state==='queued_local'?'Na fila do WhatsApp; aguardando envio':'Consulta ainda sem envio confirmado',dispatch?.sent_at),
  stage('supplier_order','Pedido ao fornecedor',detailsSent?'done':dispatch?.state==='details_queued_local'?'active':'pending',
   detailsSent?'Envio dos dados e fotos do pedido confirmado':dispatch?.state==='details_queued_local'?'Dados do pedido na fila; aguardando envio':'Aguardando disponibilidade e envio dos dados',dispatch?.details_sent_at),
  stage('supplier_confirmation','Confirmação do fornecedor',supplierConfirmed||manuallyConfirmed?'done':needsReview?'attention':'pending',
   supplierConfirmed?'O fornecedor confirmou que está preparando o pedido':manuallyConfirmed?'Confirmação registrada manualmente pela administração':needsReview?'Pedido precisa de atenção; veja as pendências':'Aguardando confirmação do fornecedor',supplierConfirmed?dispatch?.responded_at:manuallyConfirmed?job.updated_at:null),
  stage('supplier_payment','Pagamento ao fornecedor',automaticPaid||manualPaid?'done':payout?(['unknown','needs_review','refused','cancelled'].includes(payout.state)?'attention':'active'):'pending',
   automaticPaid?'Pagamento concluído e conferido no Asaas':manualPaid?'Pagamento registrado manualmente pela administração':payout?(payoutLabels[payout.state]||'Pagamento aguardando conferência'):snapshot.payoutEnabled===false?'Pagamento automático ao fornecedor está desativado':billing?'Cobrança recebida; pagamento ainda sem confirmação':'Nenhum pagamento confirmado ao fornecedor',automaticPaid?payout.updated_at:manualPaid?paidRecord.recorded_at:null),
  stage('shipping','Envio e entrega',shipment?.stage==='delivered'?'done':shipment?'active':'pending',
   shipment?shipment.label||shipment.stage:'Aguardando registro de postagem e rastreamento',shipment?.created_at)
 ];
 const activities=[{id:'created',title:'Pedido criado na loja',at:order.created_at,source:'Loja'}];
 const paymentLabels={PAYMENT_CONFIRMED:'Pagamento do cliente confirmado',PAYMENT_RECEIVED:'Pagamento do cliente recebido',PAYMENT_REFUNDED:'Pagamento do cliente reembolsado',PAYMENT_CHARGEBACK_REQUESTED:'Contestação do pagamento registrada',PAYMENT_CHARGEBACK_DISPUTE:'Contestação do pagamento em análise'};
 for(const e of events)if(paymentLabels[e.kind])activities.push({id:'payment-'+e.kind,title:paymentLabels[e.kind],at:e.occurred_at,source:'Webhook Asaas'});
 if(payment?.received_at&&!event('PAYMENT_RECEIVED'))activities.push({id:'receipt',title:'Pagamento do cliente recebido',at:payment.received_at,source:'Asaas'});
 for(const m of messages){
  const title=purposeLabels[m.purpose]||'Mensagem do pedido';
  activities.push({id:m.id,title:title+(m.sent===m.total?' — envio confirmado':m.uncertain?' — envio precisa de conferência':m.failed?' — falha no envio':' — aguardando envio'),at:m.sent===m.total?m.last_at:m.created_at,source:'Bot / WhatsApp',state:m.sent===m.total?'done':m.uncertain||m.failed?'attention':'pending'});
 }
 if(!messages.some(m=>m.purpose==='stock_query')&&dispatch?.sent_at)activities.push({id:'query',title:'Consulta enviada ao fornecedor',at:dispatch.sent_at,source:'Bot / WhatsApp'});
 if(!messages.some(m=>m.purpose==='order_details')&&detailsSent)activities.push({id:'details',title:'Dados do pedido enviados ao fornecedor',at:dispatch.details_sent_at,source:'Bot / WhatsApp'});
 if(supplierConfirmed)activities.push({id:'confirmed',title:'Fornecedor confirmou a preparação',at:dispatch.responded_at,source:'Resposta do fornecedor'});
 if(manuallyConfirmed)activities.push({id:'manual-confirmed',title:'Confirmação do fornecedor registrada manualmente',at:job.updated_at,source:'Administração'});
 if(billing)activities.push({id:'billing',title:'Cobrança do fornecedor recebida',at:billing.created_at,source:'WhatsApp',state:billing.state==='ready_for_check'?'done':'pending'});
 if(payout)activities.push({id:'payout',title:automaticPaid?'Pix ao fornecedor confirmado no Asaas':payoutLabels[payout.state]||'Pagamento em conferência',at:payout.updated_at,source:'Asaas',state:automaticPaid?'done':'pending'});
 if(manualPaid)activities.push({id:'manual-paid',title:'Pagamento ao fornecedor registrado manualmente',at:paidRecord.recorded_at,source:'Administração'});
 for(const t of tracking)activities.push({id:t.id||'tracking-'+t.created_at,title:t.label||t.stage,at:t.created_at,source:'Rastreamento verificado'});
 const attention=[];
 if(needsReview)attention.push('O bot marcou este pedido para revisão.');
 if(payout&&['unknown','needs_review'].includes(payout.state))attention.push('Conferir o Pix no Asaas antes de qualquer nova tentativa.');
 if(payout?.last_error)attention.push('Há uma pendência financeira registrada para conferência no Asaas.');
 if(payout?.state==='paid'&&!automaticPaid)attention.push('O registro de pagamento ainda precisa da confirmação bancária DONE.');
 const online=!!bridge?.heartbeat_at&&Date.now()-Date.parse(bridge.heartbeat_at)<90000;
 if(snapshot.localTransport&&!online)attention.push('O conector do WhatsApp no Mac está sem sinal recente; envios podem estar aguardando.');
 let summary=reversed?'Pagamento do cliente precisa de atenção':needsReview?'Pedido precisa de atenção':automaticPaid||manualPaid?'Fornecedor pago':payout?payoutLabels[payout.state]||'Pagamento em conferência':supplierConfirmed?'Fornecedor preparando o pedido':detailsSent?'Pedido enviado; aguardando fornecedor':dispatch?.state==='details_queued_local'?'Pedido na fila de envio':dispatch?.sent_at?'Consultando disponibilidade':received?'Pagamento recebido; aguardando fornecedor':confirmed?'Pagamento confirmado':'Aguardando pagamento';
 if(shipment&&!reversed)summary=shipment.label||summary;
 return {order:{id:order.id,createdAt:order.created_at,status:order.status,customerName:order.name,city:order.city,state:order.state,total:order.total,items:parseItems(order.items_json)},summary,stages,
  activities:activities.filter(a=>stamp(a.at)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)),attention,
  suppliers:attempts.map(a=>({name:a.display_name||a.supplier_id,state:a.state,label:attemptLabels[a.state]||'Consulta registrada',updatedAt:a.updated_at})),
  supplierPayment:{state:automaticPaid?'paid':manualPaid?'manual_paid':payout?.state==='paid'?'needs_review':payout?.state||'pending',bankStatus:payout?.bank_status||null,amount:payout?Number(payout.amount_cents)/100:null,receiptUrl:automaticPaid&&validReceipt(payout.receipt_url)?payout.receipt_url:null},
  bot:{online,lastSeenAt:bridge?.heartbeat_at||null},observedAt:new Date().toISOString()};
}
function parseItems(value){try{return JSON.parse(value).map(i=>({title:i.title,qty:i.qty,size:i.size,personalize:i.personalize,customName:i.customName,customNumber:i.customNumber}));}catch{return [];}}
function validReceipt(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='asaas.com'||u.hostname.endsWith('.asaas.com'));}catch{return false;}}
