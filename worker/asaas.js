function secret(value) {
 return typeof value==='string'&&value.length>0&&!/\s/.test(value)?value:null;
}

export function asaasConfig(env) {
 if(!['true','false'].includes(env.ASAAS_SANDBOX))return {sandbox:null,apiUrl:null,apiKey:null,webhookToken:null};
 const sandbox=env.ASAAS_SANDBOX==='true';
 // Legacy secrets belong to the existing Sandbox setup. Production is staged separately.
 let apiKey=secret(sandbox?(env.ASAAS_SANDBOX_API_KEY||env.ASAAS_API_KEY):env.ASAAS_PRODUCTION_API_KEY);
 if(apiKey?.startsWith(sandbox?'$aact_prod_':'$aact_hmlg_'))apiKey=null;
 const webhookToken=secret(sandbox?(env.ASAAS_SANDBOX_WEBHOOK_TOKEN||env.ASAAS_WEBHOOK_TOKEN):env.ASAAS_PRODUCTION_WEBHOOK_TOKEN);
 return {sandbox,apiUrl:sandbox?'https://api-sandbox.asaas.com/v3':'https://api.asaas.com/v3',apiKey,webhookToken};
}

export async function asaasRequest(endpoint,env,body,{request=fetch}={}) {
 const config=asaasConfig(env);
 if(!config.apiKey)throw new Error('Chave Asaas não configurada para o ambiente ativo.');
 const response=await request(config.apiUrl+endpoint,{method:'POST',redirect:'manual',
  headers:{'content-type':'application/json','access_token':config.apiKey,'user-agent':'StreetballStore/1.0'},body:JSON.stringify(body)});
 if(response.status>=300&&response.status<400){try{await response.body?.cancel();}catch{}throw new Error('Redirecionamento inesperado no provedor de pagamento.');}
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error('Erro no provedor de pagamento: '+(data.errors?.[0]?.description||response.status));
 return data;
}
