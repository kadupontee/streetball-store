"""Owner-authorized retail repricing: 5% customer coupon, 25% seller, R$10 remainder.

Historical planning assumptions, not a current FX or tax quote. The 1.25 cost
cushion reproduces the previously used R$99.38 acquisition estimate for a fan
shirt (USD11 + USD4 shipping, BRL5.30/USD). The 13.5% sales deductions reserve
4.5% payment, 6% business taxes and 3% contingencies. Fixed expenses and ads
are excluded. Never change the supplier-payment reference table here.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
D = Decimal
CENT = D('0.01')
FX = D('5.30')
ACQUISITION_CUSHION = D('1.25')
CUSTOMER_DISCOUNT = D('0.05')
SELLER_COMMISSION = D('0.25')
SALES_DEDUCTIONS = D('0.135')
TARGET_REMAINDER = D('10.00')
RETAINED = (1 - CUSTOMER_DISCOUNT) * (1 - SELLER_COMMISSION - SALES_DEDUCTIONS)
VERSION = 'commission25-coupon5-min10-20261028'
COSTS = json.loads((ROOT / 'scripts/costs.json').read_text())
UNKNOWN_EXACT_COSTS = ('coat', 'blouse')


def money(value):
    return D(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def acquisition_cost(kind):
    value = COSTS['supplier_usd'].get(kind)
    if value is None:
        return None
    # Use the upper end of a declared range, never its cheapest possible cost.
    if isinstance(value, dict):
        value = value['max']
    return money((D(str(value)) + D(str(COSTS['shipping_usd']['one_piece']))) * FX * ACQUISITION_CUSHION)


def rounded_retail(cost):
    minimum = (cost + TARGET_REMAINDER) / RETAINED
    return money(((minimum + D('0.10')) / 10).to_integral_value(rounding=ROUND_CEILING) * 10 - D('0.10'))


RETAIL_PRICES = {kind: float(rounded_retail(acquisition_cost(kind))) for kind in COSTS['supplier_usd']}
# Preserve the owner's common price for jackets/coats/blouses. Missing purchase
# costs remain explicitly unverified; a jacket cost is not silently assigned.
RETAIL_PRICES.update({kind: RETAIL_PRICES['jacket'] for kind in UNKNOWN_EXACT_COSTS})
APPAREL_PRICE = RETAIL_PRICES['jacket']


def apply_commission_floor(product):
    result = dict(product)
    floor = RETAIL_PRICES.get(result.get('kind'), 0)
    if result.get('apparelPriceReviewRequired') and not result.get('kindLocked'):
        floor = max(floor, APPAREL_PRICE)
    result['price'] = max(float(result.get('price') or 0), floor)
    return result


def estimate_remainder(price, cost, *, extra_usd=0):
    paid = money(D(str(price)) * (1 - CUSTOMER_DISCOUNT))
    commission = money(paid * SELLER_COMMISSION)
    deductions = money(paid * SALES_DEDUCTIONS)
    return money(paid - commission - deductions - cost - money(D(str(extra_usd)) * FX * ACQUISITION_CUSHION))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    path = ROOT / 'public/catalog.json'
    products = json.loads(path.read_text())
    updated = [apply_commission_floor(product) for product in products]
    changed = sum(a != b for a, b in zip(products, updated))
    if args.check:
        if changed:
            raise SystemExit(f'{changed} produtos abaixo do preço mínimo autorizado.')
        expected = 'window.STREETBALL_CATALOG = ' + json.dumps(products, ensure_ascii=False, separators=(',', ':')) + ';\n'
        if (ROOT / 'public/catalog.js').read_text() != expected:
            raise SystemExit('Catálogos JSON e JS divergentes.')
    else:
        path.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + '\n')
        (ROOT / 'public/catalog.js').write_text('window.STREETBALL_CATALOG = ' + json.dumps(updated, ensure_ascii=False, separators=(',', ':')) + ';\n')
    report = {
        'policy': VERSION, 'products': len(products), 'changed': changed,
        'assumptions': {'usd_brl': str(FX), 'acquisition_cushion': str(ACQUISITION_CUSHION), 'customer_coupon': str(CUSTOMER_DISCOUNT),
                        'seller_commission': str(SELLER_COMMISSION), 'sales_deductions': str(SALES_DEDUCTIONS), 'target_remainder_brl': str(TARGET_REMAINDER)},
        'excludes': ['advertising', 'fixed_expenses'],
        'unverified_cost_kinds': list(UNKNOWN_EXACT_COSTS),
        'prices_brl': RETAIL_PRICES,
        'counts': dict(Counter(p['kind'] for p in updated)),
        'estimated_remainder_brl': {kind: str(estimate_remainder(price, acquisition_cost(kind)))
                                   for kind, price in RETAIL_PRICES.items() if acquisition_cost(kind) is not None}
    }
    if not args.check:
        (ROOT / 'scripts/commission_price_update_summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
