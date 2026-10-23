#!/usr/bin/env python3
"""Audita e atualiza o catálogo existente, sem baixar imagens nem trocar IDs.

Executar antes de publicar a loja:
    python scripts/reprice_retro_catalog.py
    python scripts/reprice_retro_catalog.py --check

Modifica somente categoria, tipo, preço mínimo retrô e badge dos produtos elegíveis.
Não reprecifica camisas com priceLocked nem seus pedidos já realizados.
"""
from __future__ import annotations
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from catalog_utils import CATALOG, read_catalog, save_catalog
from retro_policy import apply_retro_policy, is_older_than_five_seasons, RETRO_STANDARD_BRL, RETRO_LONG_BRL, ADULT_KINDS

REPORT = Path(__file__).resolve().parents[1] / 'scripts' / 'retro-migration-report.json'


def audit(products):
    results = []
    changed = Counter()
    examples = []
    locks = []
    for product in products:
        original = dict(product)
        updated = apply_retro_policy(product)
        results.append(updated)
        if updated != original:
            changed['any'] += 1
            for field in ('category', 'kind', 'price', 'badge'):
                if updated.get(field) != original.get(field):
                    changed[field] += 1
            if len(examples) < 18:
                examples.append({
                    'id': product.get('id'),
                    'title': product.get('title'),
                    'previousKind': original.get('kind'),
                    'newKind': updated.get('kind'),
                    'oldPrice': original.get('price'),
                    'newPrice': updated.get('price'),
                })
        dated = is_older_than_five_seasons(product.get('supplierTitle') or product.get('title') or '')
        if dated and str(product.get('kind') or '').lower() not in ('jacket','coat','blouse'):
            # Jaquetas vintage pertencem a vestuário, não à política de camisas retrô.
            changed['olderDatedProducts'] += 1
            if product.get('categoryLocked') or product.get('priceLocked') or product.get('kindLocked'):
                changed['olderWithManualLocks'] += 1
                if len(locks) < 25:
                    locks.append({'id':product.get('id'),'title':product.get('title'),
                                  'categoryLocked':bool(product.get('categoryLocked')),
                                  'priceLocked':bool(product.get('priceLocked')),
                                  'kindLocked':bool(product.get('kindLocked'))})
            if updated.get('category') != 'retro' and not product.get('categoryLocked'):
                raise ValueError('Produto antigo continua fora de Retrô: '+str(product.get('id')))
            old_kind = product.get('kind')
            if old_kind in ADULT_KINDS and not product.get('priceLocked'):
                min_price = RETRO_LONG_BRL if updated.get('kind') == 'retro_long' else RETRO_STANDARD_BRL
                if float(updated.get('price') or 0) < min_price:
                    raise ValueError('Preço abaixo do piso retrô: '+str(product.get('id')))
    return results, {
        'totalProducts': len(products), 'olderDatedProducts': changed['olderDatedProducts'],
        'changedProducts': changed['any'], 'newlyClassifiedRetro': changed['category'],
        'kindsAdjusted': changed['kind'], 'pricesAdjusted': changed['price'],
        'badgesAdjusted': changed['badge'],
        'oldDatedManualLocks': changed['olderWithManualLocks'],
        'minimumRetroBRL': RETRO_STANDARD_BRL, 'minimumRetroLongBRL': RETRO_LONG_BRL,
        'manualExceptions': locks, 'examples': examples,
        'note': 'Preço é piso de venda, não lucro líquido. Alterações não atingem pedidos antigos. '
                'Preços/categorias manuais bloqueados são preservados.'
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', help='Falha se houver produtos que ainda precisam ser ajustados')
    args = parser.parse_args()
    products = read_catalog()
    if not products:
        raise SystemExit('Catálogo vazio ou ausente: nenhuma alteração aplicada.')
    updated, report = audit(products)
    if args.check:
        if report['changedProducts']:
            raise SystemExit(f'Faltam corrigir {report["changedProducts"]} itens: execute o script sem --check.')
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return
    if report['changedProducts']:
        save_catalog(updated)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
