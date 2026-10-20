#!/usr/bin/env python3
"""Remove permanentemente produtos de basquete/NBA do catálogo de venda."""
from __future__ import annotations
import json
import re
from pathlib import Path
from catalog_utils import CATALOG, ROOT, is_nba_product, save_catalog

def main():
    catalog=json.loads(CATALOG.read_text(encoding='utf-8'))
    if not isinstance(catalog,list):
        raise ValueError('Formato de catálogo inválido')
    removed=[p for p in catalog if is_nba_product(p)]
    kept=[p for p in catalog if not is_nba_product(p)]
    if removed:
        save_catalog(kept)
    else:
        print('Nenhum produto NBA encontrado; catálogo preservado.')
        return
    references={url for p in kept for url in ([p.get('image')]+list(p.get('images') or [])) if isinstance(url,str)}
    deleted_images=0
    for p in removed:
        image=p.get('image')
        if not isinstance(image,str) or not re.fullmatch(r'/images/yupoo/[0-9]+\.(?:jpg|webp|png)',image):
            continue
        if image in references:
            continue
        file=ROOT/'public'/image.lstrip('/')
        if file.is_file():
            file.unlink()
            deleted_images+=1
    print(f'NBA removida: {len(removed)} produtos; restantes {len(kept)}; imagens órfãs apagadas {deleted_images}.',flush=True)

if __name__=='__main__':
    main()
