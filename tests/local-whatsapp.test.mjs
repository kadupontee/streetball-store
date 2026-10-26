import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {handleLocalWhatsApp} from '../worker/local-whatsapp.js';

const token='fake-test-secret-012345678901234567890123456789';
const accountJid='5511999999999@s.whatsapp.net';
const sqliteScript=`import sqlite3,json,sys
p=json.load(sys.stdin)
c=sqlite3.connect(p['file'])
c.row_factory=sqlite3.Row
if 'schema' in p:
 c.executescript(p['schema']); rows=[]
else:
 q=c.execute(p['sql'],p.get('args',[]))
 rows=[dict(r) for r in q.fetchall()] if q.description else []
changes=c.total_changes
c.commit()
print(json.dumps({'results':rows,'meta':{'changes':changes}}))
c.close()
`;
function database(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wa-local-api-test-')),file=path.join(dir,'test.db');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 function query(data){
  const result=spawnSync('python3',['-c',sqliteScript],{input:JSON.stringify({file,...data}),encoding:'utf8'});
  if(result.status!==0)throw Error(result.stderr);
  return JSON.parse(result.stdout);
 }
 query({schema:fs.readFileSync(new URL('../worker/local-whatsapp-schema.sql',import.meta.url),'utf8')});
 const db={prepare(sql){let args=[];const statement={bind(...values){args=values;return statement;},
  async run(){return query({sql,args});},async all(){return query({sql,args});},async first(){return query({sql,args}).results[0]||null;}};return statement;}};
 return {db,query};
}
async function request(db,action,data={},secret=token){
 const response=await handleLocalWhatsApp(new Request('https://loja.example/api/local-whatsapp/'+action,{
  method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify({accountJid,...data})
 }),{DB:db,WA_LOCAL_BRIDGE_TOKEN:token});
 return {status:response.status,...await response.json()};
}
async function pending(db){await request(db,'session');return (await request(db,'test')).jobId;}

test('local bridge rejects invalid authentication before touching the database',async()=>{
 const db={prepare(){throw Error('must not read DB');}};
 assert.equal((await request(db,'test',{},'wrong-token')).status,401);
 const r=await handleLocalWhatsApp(new Request('https://loja.example/api/local-whatsapp/status',{method:'POST'}),{DB:db});
 assert.equal(r.status,503);
});
test('the first account binds the bridge and a different account cannot replace it',async t=>{
 const {db}=database(t);
 assert.equal((await request(db,'session')).status,200);
 assert.equal((await request(db,'session',{accountJid:'5511888888888@s.whatsapp.net'})).status,409);
 assert.equal((await request(db,'status')).mode,'self_test_only');
});
test('self-test API rejects arbitrary text and recipients and reuses double clicks',async t=>{
 const {db}=database(t);const id=await pending(db);
 assert.equal((await request(db,'test',{to:'8613800138000'})).status,400);
 assert.equal((await request(db,'test',{text:'custom outbound text'})).status,400);
 assert.equal((await request(db,'test')).jobId,id);
});
test('simultaneous test requests create one active message',async t=>{
 const {db}=database(t);await request(db,'session');
 const [a,b]=await Promise.all([request(db,'test'),request(db,'test')]);
 assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.jobId,b.jobId);
});
test('real SQLite queue reserves once, acknowledges once and returns no further message',async t=>{
 const {db}=database(t);const id=await pending(db);
 const [a,b]=await Promise.all([request(db,'claim'),request(db,'claim')]);
 const claimed=[a.job,b.job].filter(Boolean);assert.equal(claimed.length,1);
 const job=claimed[0];assert.equal(job.id,id);assert.equal(job.accountJid,accountJid);
 assert.equal((await request(db,'sending',{jobId:id,lease:job.lease})).status,200);
 const ack={jobId:id,lease:job.lease,messageId:'FAKE_REMOTE_MESSAGE_ID'};
 assert.equal((await request(db,'ack',ack)).status,200);
 assert.equal((await request(db,'ack',ack)).status,200);
 assert.equal((await request(db,'ack',{...ack,messageId:'DIFFERENT_MESSAGE_ID'})).status,409);
 assert.equal((await request(db,'claim')).job,null);
 assert.equal((await request(db,'status')).latest.state,'sent');
});
test('expired claims may be reserved again; started transmissions never replay',async t=>{
 const {db,query}=database(t);const id=await pending(db);
 const first=(await request(db,'claim')).job;
 query({sql:'UPDATE wa_local_test_jobs SET lease_until=? WHERE id=?',args:['2000-01-01T00:00:00.000Z',id]});
 const second=(await request(db,'claim')).job;
 assert.equal(second.id,id);assert.notEqual(second.lease,first.lease);
 assert.equal((await request(db,'sending',{jobId:id,lease:first.lease})).status,409);
 await request(db,'sending',{jobId:id,lease:second.lease});
 query({sql:'UPDATE wa_local_test_jobs SET lease_until=? WHERE id=?',args:['2000-01-01T00:00:00.000Z',id]});
 assert.equal((await request(db,'claim')).job,null);
 assert.equal((await request(db,'status')).latest.state,'uncertain');
});
test('expired unclaimed tests do not get sent later',async t=>{
 const {db,query}=database(t);const id=await pending(db);
 query({sql:'UPDATE wa_local_test_jobs SET expires_at=? WHERE id=?',args:['2000-01-01T00:00:00.000Z',id]});
 assert.equal((await request(db,'claim')).job,null);
 assert.equal((await request(db,'status')).latest.state,'expired');
});
