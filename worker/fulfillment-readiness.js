export const usesLocalWhatsApp=env=>env.WA_TRANSPORT==='local';
export function localOrdersReady(env){
 return !!(env.DB&&env.WA_LOCAL_BRIDGE_TOKEN&&usesLocalWhatsApp(env)&&env.WA_LOCAL_ORDERS_ENABLED==='true'&&
  env.WA_AUTOMATION_ENABLED==='true'&&env.ASAAS_SANDBOX==='false'&&env.PAYMENTS_PRODUCTION_ENABLED==='true'&&
  env.SALES_ENABLED==='true'&&env.CUSTOMER_PAYS_IMPORT_TAXES==='true'&&env.IMPORT_TAX_DISCLOSURE_APPROVED==='true'&&env.IMPORT_COMPLIANCE_APPROVED==='true');
}
