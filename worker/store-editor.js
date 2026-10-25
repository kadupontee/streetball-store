import {emptySettings,normalizeSettings,applyProductOverride} from '../public/store-settings.js';
export const EDITOR_SCHEMA='CREATE TABLE IF NOT EXISTS store_editor_versions (revision INTEGER PRIMARY KEY, state_json TEXT NOT NULL, published_at TEXT NOT NULL)';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const isMissingTable=e=>/no such table:\s*store_editor_versions/i.test(String(e?.message||''));
export async function loadStoreSettings(env){
 if(!env.DB)return {revision:0,publishedAt:null,settings:emptySettings()};
 let row;
 try{row=await env.DB.prepare('SELECT revision,state_json,published_at FROM store_editor_versions ORDER BY revision DESC LIMIT 1').first();}
 catch(e){if(isMissingTable(e))return {revision:0,publishedAt:null,settings:emptySettings()};throw e;}
 return row?{revision:row.revision,publishedAt:row.published_at,settings:normalizeSettings(JSON.parse(row.state_json))}:{revision:0,publishedAt:null,settings:emptySettings()};
}
export async function publicStoreSettings(env){return json(await loadStoreSettings(env));}
export async function editedCatalog(products,env,snapshot){
 const {settings}=snapshot||await loadStoreSettings(env);
 return products.map(p=>applyProductOverride(p,settings.products[p.id])).filter(p=>!p.hidden);
}
export async function handleStoreEditor(request,env){
 if(!env.ADMIN_TOKEN||request.headers.get('authorization')!=='Bearer '+env.ADMIN_TOKEN)return json({error:'Chave administrativa inválida.'},401);
 if(!env.DB)return json({error:'Banco da loja indisponível.'},503);
 if(!['GET','POST'].includes(request.method))return json({error:'Método não permitido.'},405);
 const origin=request.headers.get('origin');
 if(request.method==='POST'&&origin!==new URL(request.url).origin)return json({error:'Origem inválida. Abra o editor no próprio domínio da loja.'},403);
 // Migração somente aditiva, depois de autenticar a administração.
 await env.DB.prepare(EDITOR_SCHEMA).run();
 const url=new URL(request.url);
 if(request.method==='GET'){
  const revision=url.searchParams.get('revision');
  if(revision!==null){
   if(!/^\d{1,9}$/.test(revision))return json({error:'Versão inválida.'},400);
   if(Number(revision)===0)return json({revision:0,settings:emptySettings()});
   const saved=await env.DB.prepare('SELECT revision,state_json,published_at FROM store_editor_versions WHERE revision=?').bind(Number(revision)).first();
   return saved?json({revision:saved.revision,publishedAt:saved.published_at,settings:normalizeSettings(JSON.parse(saved.state_json))}):json({error:'Versão não encontrada.'},404);
  }
  const current=await loadStoreSettings(env);
  const versions=await env.DB.prepare('SELECT revision,published_at FROM store_editor_versions ORDER BY revision DESC LIMIT 20').all();
  return json({...current,versions:versions.results||[]});
 }
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Envie uma configuração JSON.'},415);
 if(Number(request.headers.get('content-length')||0)>1500000)return json({error:'Rascunho muito grande.'},413);
 const raw=await request.text();
 if(new TextEncoder().encode(raw).length>1500000)return json({error:'Rascunho muito grande.'},413);
 let body,settings;
 try{body=JSON.parse(raw);settings=normalizeSettings(body.settings);}catch(e){return json({error:e.message||'Rascunho inválido.'},400);}
 if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||body.expectedRevision>=999999999)return json({error:'Versão base inválida.'},400);
 const revision=body.expectedRevision+1,publishedAt=new Date().toISOString();
 // Comparação e publicação na mesma instrução SQL: duas abas não sobrescrevem alterações.
 let saved;
 try{saved=await env.DB.prepare('INSERT INTO store_editor_versions(revision,state_json,published_at) SELECT ?,?,? WHERE COALESCE((SELECT MAX(revision) FROM store_editor_versions),0)=?').bind(revision,JSON.stringify(settings),publishedAt,body.expectedRevision).run();}
 catch(e){if(/unique constraint|constraint failed/i.test(String(e?.message||'')))return json({error:'A loja foi atualizada em outra aba. Exporte seu rascunho antes de recarregar.'},409);throw e;}
 if(!saved.meta?.changes)return json({error:'A loja foi atualizada em outra aba. Exporte seu rascunho antes de recarregar.'},409);
 return json({ok:true,revision,publishedAt,settings});
}
