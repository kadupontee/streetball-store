#!/usr/bin/env python3
"""Publish only the locally reviewed Streetball catalog via GitHub.
Requires local Git repo, authenticated GitHub remote, and main branch.
Never stores authentication tokens and never force-pushes.
"""
from __future__ import annotations
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def cmd(*parts, timeout=120, require=True, show_output=True):
    print('+ ' + ' '.join(parts), flush=True)
    try:
        proc = subprocess.run(parts, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as exc:
        raise RuntimeError('Git nao instalado. Instale o GitHub Desktop (ou Git para Mac).') from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError('Operacao excedeu o tempo limite. Verifique conexao com GitHub.') from exc
    if show_output and proc.stdout.strip(): print(proc.stdout.strip()[-1500:], flush=True)
    if proc.stderr.strip() and proc.returncode != 0: print(proc.stderr.strip()[-1500:], flush=True)
    if require and proc.returncode:
        raise RuntimeError('Comando Git falhou. Abra GitHub Desktop e verifique autenticacao/conflitos antes de tentar novamente.')
    return proc

def main():
    if cmd('git','rev-parse','--is-inside-work-tree',require=False).returncode:
        raise RuntimeError('Pasta ainda nao conectada ao GitHub. Siga o GUIA_PUBLICACAO_GITHUB.md para publicar o repositorio pelo GitHub Desktop.')
    remote=cmd('git','config','--get','remote.origin.url',require=False,show_output=False)
    if remote.returncode: raise RuntimeError('Falta conectar o repositorio remoto origin pelo GitHub Desktop.')
    origin=remote.stdout.strip()
    if 'github.com/' not in origin and 'github.com:' not in origin:
        raise RuntimeError('O repositorio origin nao aponta para github.com. Revise antes de publicar.')
    branch=cmd('git','branch','--show-current').stdout.strip()
    if branch!='main': raise RuntimeError(f'A branch atual e {branch or "(nenhuma)"}. Publique usando a branch main.')
    identity=cmd('git','config','user.name',require=False)
    if identity.returncode or not identity.stdout.strip():
        raise RuntimeError('Configure seu nome de usuario Git no GitHub Desktop antes de publicar.')
    cmd('git','add','-A','--','public/catalog.json','public/catalog.js')
    if (ROOT/'public/images').exists(): cmd('git','add','-A','--','public/images')
    modified=cmd('git','diff','--cached','--quiet',require=False)
    if modified.returncode==1:
        cmd('git','commit','-m','Atualizar produtos e fotos da Streetball')
    elif modified.returncode==0:
        print('Nenhuma mudanca nova no catalogo; conferindo o repositorio remoto.',flush=True)
    else: raise RuntimeError('Nao foi possivel conferir alteracoes do catalogo.')
    print('Buscando novidades remotas com seguranca...',flush=True)
    cmd('git','pull','--rebase','origin','main',timeout=120)
    print('Enviando alteracoes para GitHub...',flush=True)
    cmd('git','push','-u','origin','main',timeout=120)
    print('PUBLICADO: o GitHub Pages recebera as alteracoes quando a rotina de implantacao finalizar. Verifique a aba Actions.',flush=True)

if __name__=='__main__':
    try: main()
    except Exception as exc:
        print('ERRO: '+str(exc),flush=True)
        sys.exit(1)
