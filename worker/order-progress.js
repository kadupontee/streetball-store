// Status exibidos para acompanhamento. Somente eventos verificados são registrados.
export const STAGES={
 supplier_search:'Consultando fornecedores',
 supplier_preparing:'Preparando pedido',
 shipped:'Postado pelo fornecedor',
 international_transit:'Em transporte internacional',
 arrived_brazil:'Chegou ao Brasil',
 customs_inspection:'Em fiscalização aduaneira',
 tax_payment_due:'Pagamento de tributos solicitado',
 customs_released:'Liberado na alfândega',
 out_for_delivery:'Saiu para entrega',
 delivered:'Entregue',
 exception:'Ocorrência: atendimento necessário'
};
export function safeTrackingCode(value){
 return typeof value==='string'&&(!value||/^[a-zA-Z0-9-]{8,40}$/.test(value));
}
export function formatProgress(order,meta,events){
 return {
  orderId:order.id.slice(0,8),
  paymentState:order.status,
  trackingCode:meta?.tracking_code||null,
  carrier:meta?.carrier||null,
  current:events[0]?.stage||null,
  events:events.map(e=>({at:e.created_at,stage:e.stage,label:STAGES[e.stage]||'Atualização'})),
  payTaxesAtOfficialCorreios:events[0]?.stage==='tax_payment_due',
  source:'Eventos informados pelo administrador após conferência, não rastreamento em tempo real.'
 };
}
