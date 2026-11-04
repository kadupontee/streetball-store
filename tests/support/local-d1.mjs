import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const python=`import sqlite3,json,sys
p=json.load(sys.stdin)
c=sqlite3.connect(p['file'])
c.row_factory=sqlite3.Row
c.execute('PRAGMA foreign_keys=ON')
try:
 if 'schema' in p:
  c.executescript(p['schema']); out={}
 else:
  c.execute('BEGIN')
  out=[]
  for statement in p.get('statements',[p]):
   before=c.total_changes
   q=c.execute(statement['sql'],statement.get('args',[]))
   rows=[dict(r) for r in q.fetchall()] if q.description else []
   out.append({'results':rows,'meta':{'changes':c.total_changes-before}})
  if 'statements' not in p: out=out[0]
 c.commit()
 print(json.dumps(out))
except:
 c.rollback()
 raise
finally:
 c.close()
`;
export function localD1(t){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'streetball-orders-db-')),file=path.join(folder,'test.db');
 t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 function query(data){const r=spawnSync('python3',['-c',python],{input:JSON.stringify({file,...data}),encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return JSON.parse(r.stdout);}
 for(const name of ['schema.sql','local-whatsapp-schema.sql','local-orders-schema.sql'])query({schema:fs.readFileSync(new URL('../../worker/'+name,import.meta.url),'utf8')});
 const db={prepare(sql){let args=[];const statement={sql,get args(){return args;},bind(...parts){args=parts;return statement;},
  async run(){return query({sql,args});},async all(){return query({sql,args});},async first(){return query({sql,args}).results[0]||null;}};return statement;},
  async batch(statements){return query({statements:statements.map(s=>({sql:s.sql,args:s.args}))});}};
 return {db,query};
}
