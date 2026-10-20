#!/usr/bin/env python3
"""Painel LOCAL de edição: python scripts/catalog_server.py
Acessível apenas no computador de quem executa (127.0.0.1).
NUNCA publique este servidor ou adicione 0.0.0.0 como host.
"""
from __future__ import annotations
import base64, csv, hashlib, io, json, re, subprocess, sys, threading
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
from catalog_utils import ROOT,read_catalog,merge_catalog,save_catalog,normalize_product,is_yupoo_album_url
OFFICIAL_REPORT=ROOT/'scripts'/'official_image_candidates.json'
IMPORT_CHECKPOINT=ROOT/'scripts'/'yupoo_import_checkpoint.json'
IMPORT_INDEX=ROOT/'scripts'/'yupoo_album_index.json'
PUBLIC=ROOT/'public'
SYNC={'running':False,'lastLog':['Nenhuma sincronização executada nesta sessão.'],'returncode':None,'task':None}
LOCK=threading.RLock()

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(PUBLIC),**kw)
    def send_json(self,value,status=200):
        b=json.dumps(value,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(b)))
        self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(b)
    def do_GET(self):
        target=urlsplit(self.path)
        if target.path=='/api/catalog-manager/list':
            q=parse_qs(target.query)
            page=max(1,min(100000,int(q.get('page',['1'])[0])))
            query=q.get('q',[''])[0].casefold().strip();cat=q.get('category',['todos'])[0]
            with LOCK:data=read_catalog()
            if query:data=[p for p in data if query in (p.get('title','')+' '+p.get('id','')).casefold()]
            if cat!='todos':data=[p for p in data if p.get('category')==cat]
            start=(page-1)*36
            return self.send_json({'total':len(data),'page':page,'items':data[start:start+36]})
        if target.path=='/api/catalog-manager/status':
            with LOCK:
                try: checkpoint=json.loads(IMPORT_CHECKPOINT.read_text(encoding='utf-8'))
                except (OSError,ValueError): checkpoint={}
                if isinstance(checkpoint,list):checkpoint={'photosDone':checkpoint}
                try: albums=json.loads(IMPORT_INDEX.read_text(encoding='utf-8'))
                except (OSError,ValueError): albums={}
                return self.send_json({**SYNC,'catalogCount':len(read_catalog()),
                    'albumCount':len(albums) if isinstance(albums,dict) else 0,
                    'albumPages':len(checkpoint.get('pagesIndexed',[])),
                    'photosComplete':len(checkpoint.get('photosDone',[])),
                    'protectedCount':len(checkpoint.get('protected',[])),
                    'errorCount':len(checkpoint.get('errors',{}))})
        if target.path=='/api/catalog-manager/official-results':
            try:payload=json.loads(OFFICIAL_REPORT.read_text(encoding='utf-8'))
            except (OSError,ValueError):payload={'items':[],'generatedAt':None}
            return self.send_json(payload)
        if target.path=='/api/catalog-manager/export':
            with LOCK:return self.send_json(read_catalog())
        if target.path.startswith('/api/catalog-manager/'):
            return self.send_json({'error':'Rota desconhecida'},404)
        if target.path in ('/catalog-manager.html','/catalog-manager.js'):
            file=ROOT/'admin-local'/target.path.lstrip('/')
            b=file.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type','text/html; charset=utf-8' if target.path.endswith('.html') else 'application/javascript; charset=utf-8')
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(b)))
            self.end_headers();self.wfile.write(b)
            return
        return super().do_GET()
    def do_POST(self):
        path=urlsplit(self.path).path
        if not path.startswith('/api/catalog-manager/'):
            return self.send_json({'error':'Rota não existe'},404)
        # Prevent other sites from issuing unintended requests to localhost via the browser.
        origin=self.headers.get('Origin',''); expected=f'http://127.0.0.1:{self.server.server_port}'
        if origin and origin!=expected:return self.send_json({'error':'Origem não autorizada'},403)
        if self.headers.get('Content-Type','').split(';')[0]!='application/json':
            return self.send_json({'error':'Envie JSON'},415)
        try:
            length=int(self.headers.get('Content-Length',0))
            if length<1 or length>13*1024*1024:raise ValueError('Envio vazio ou maior que 13 MB')
            data=json.loads(self.rfile.read(length))
            if not isinstance(data,dict):raise ValueError('Objeto JSON obrigatório')
            with LOCK:
                if path=='/api/catalog-manager/publish':
                    if SYNC['running']:raise ValueError('Espere a operação atual terminar para publicar.')
                    cmd=[sys.executable,str(ROOT/'scripts'/'publish_catalog.py')]
                    SYNC.update(running=True,lastLog=['Iniciando publicação no GitHub...'],returncode=None,task='publish')
                    threading.Thread(target=run_import,args=(cmd,),daemon=True).start()
                    result={'started':True,'message':'Publicação iniciada. Acompanhe o registro do painel.'}
                elif path=='/api/catalog-manager/sync-official':
                    if SYNC['running']:raise ValueError('Uma sincronização já está em execução')
                    cmd=[sys.executable,str(ROOT/'scripts'/'sync_official_images.py'),'--max-products',str(min(500,max(1,int(data.get('limit') or 49))))]
                    if data.get('discover'):cmd.append('--discover')
                    # Local UI discovers sources. Publication requires explicit license through an env var AND CLI flag.
                    SYNC.update(running=True,lastLog=['Buscando correspondências de fotos oficiais...'],returncode=None,task='photos')
                    threading.Thread(target=run_import,args=(cmd,),daemon=True).start()
                    result={'started':True,'message':'Busca automática iniciada. Correspondências serão registradas na fila de fotos.'}
                elif path=='/api/catalog-manager/import':
                    products=data.get('items')
                    if not isinstance(products,list) or not 1<=len(products)<=2500:raise ValueError('Importe de 1 até 2500 produtos por lote')
                    result=merge_catalog(products)
                elif path=='/api/catalog-manager/save':
                    row=data.get('item')
                    if not isinstance(row,dict):raise ValueError('Produto obrigatório')
                    if row.get('sourceUrl') and not is_yupoo_album_url(row['sourceUrl']):raise ValueError('URL do fornecedor inválida')
                    result=merge_catalog([row]);result['id']=normalize_product(row)['id']
                elif path=='/api/catalog-manager/delete':
                    pid=str(data.get('id') or '')
                    old=read_catalog();after=[p for p in old if p['id']!=pid]
                    if len(after)==len(old):raise ValueError('Produto não encontrado')
                    save_catalog(after);result={'deleted':pid,'total':len(after)}
                elif path=='/api/catalog-manager/upload':
                    name=str(data.get('filename') or '').lower()
                    payload=data.get('base64','')
                    if len(payload)>9_000_000:raise ValueError('Arquivo muito grande')
                    binary=base64.b64decode(payload,validate=True)
                    if not 0<len(binary)<=6*1024*1024:raise ValueError('Máximo de 6 MB por imagem')
                    if binary.startswith(b'\x89PNG\r\n\x1a\n'):ext='png'
                    elif binary.startswith(b'\xff\xd8\xff'):ext='jpg'
                    elif binary.startswith(b'RIFF') and binary[8:12]==b'WEBP':ext='webp'
                    else:raise ValueError('Somente imagens JPEG, PNG ou WEBP')
                    folder=PUBLIC/'images';folder.mkdir(exist_ok=True)
                    sha=hashlib.sha256(binary).hexdigest()[:25];file=folder/(sha+'.'+ext)
                    file.write_bytes(binary)
                    result={'url':'/images/'+file.name,'bytes':len(binary)}
                elif path=='/api/catalog-manager/sync':
                    if SYNC['running']:raise ValueError('Já existe uma importação em andamento')
                    links=data.get('links') or []
                    if not isinstance(links,list) or len(links)>150:raise ValueError('Máximo 150 links')
                    for link in links:
                        if not is_yupoo_album_url(str(link).split('?')[0].rstrip('/')):raise ValueError('Link inválido: '+str(link)[:100])
                    full=bool(data.get('full'))
                    pages=94 if full else max(1,min(200,int(data.get('pages') or 2)))
                    albums=0 if full else max(0,min(100000,int(data.get('albums') if data.get('albums') is not None else 30)))
                    cmd=[sys.executable,str(ROOT/'scripts'/'import_yupoo.py'),'--max-pages',str(pages),'--max-albums',str(albums),'--photos-per-album','0']
                    if data.get('indexOnly'):cmd.append('--index-only')
                    if full or data.get('refreshIndex'):cmd.append('--refresh-index')
                    if links:
                        for link in links:cmd+=['--album-url',link.split('?')[0].rstrip('/')]
                    if data.get('refresh'):cmd.append('--refresh')
                    try:
                        import playwright,bs4
                    except ImportError as exc:
                        raise ValueError('Instale o importador (arquivo Instalar_Importador_Mac.command), depois reabra o painel.') from exc
                    SYNC.update(running=True,lastLog=['Indexando todas as páginas públicas...' if full else 'Iniciando importação...'],returncode=None,task='import')
                    threading.Thread(target=run_import,args=(cmd,),daemon=True).start()
                    result={'started':True,'message':'Importação de TODOS os álbuns iniciada. Pode levar horas; deixe o Mac ligado e o Terminal aberto. O progresso é salvo a cada página e a cada 25 galerias.' if full else 'Importação iniciada. Acompanhe o registro abaixo.'}
                else:return self.send_json({'error':'Rota desconhecida'},404)
            self.send_json({'ok':True,**result})
        except (ValueError,KeyError,TypeError,UnicodeError) as exc:self.send_json({'error':str(exc)},400)
        except Exception as exc:self.send_json({'error':str(exc)[:180]},500)

def run_import(cmd):
    try:
        proc=subprocess.Popen(cmd,cwd=str(ROOT),stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1,encoding='utf-8',errors='replace')
        for line in proc.stdout:
            with LOCK:SYNC['lastLog'].append(line.strip());SYNC['lastLog']=SYNC['lastLog'][-75:]
        code=proc.wait()
    except Exception as exc:
        code=1
        with LOCK:SYNC['lastLog'].append('ERRO: '+str(exc))
    with LOCK:SYNC['returncode']=code;SYNC['running']=False

def main():
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument('--port',type=int,default=8000)
    args=ap.parse_args()
    srv=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'Painel do catálogo: http://127.0.0.1:{srv.server_port}/catalog-manager.html',flush=True)
    print('O servidor só aceita conexões do seu computador. Ctrl+C encerra.',flush=True)
    try:srv.serve_forever()
    except KeyboardInterrupt:pass
    finally:srv.server_close()
if __name__=='__main__':main()
