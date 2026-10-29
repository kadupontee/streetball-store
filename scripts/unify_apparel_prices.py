"""Sincroniza somente preços de jaquetas, blusas, casacos e casos ambíguos.

python scripts/unify_apparel_prices.py
python scripts/unify_apparel_prices.py --check
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from garment_policy import APPAREL_KINDS, APPAREL_PRICE_BRL, APPAREL_RETAIL_POLICY, apply_apparel_retail_policy

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_CHANGES = {"price", "apparelRetailPolicy", "apparelPriceReviewRequired", "apparelPriceReviewReason"}


def migrate(products):
    revised = [apply_apparel_retail_policy(p, require_photo=True) for p in products]
    for old, new in zip(products, revised):
        if {k:v for k,v in old.items() if k not in ALLOWED_CHANGES} != {k:v for k,v in new.items() if k not in ALLOWED_CHANGES}:
            raise ValueError("A atualização tentou alterar dados fora da política de preço: " + str(old.get("id")))
    price_changes = [p for p,q in zip(products,revised) if p.get("price") != q.get("price")]
    report = {
        "policy": APPAREL_RETAIL_POLICY,
        "retail_price_brl": APPAREL_PRICE_BRL,
        "total_products": len(products),
        "apparel_by_kind": dict(Counter(p.get("kind") for p in revised if p.get("kind") in APPAREL_KINDS)),
        "ambiguous_products_at_higher_price": sum(bool(p.get("apparelPriceReviewRequired")) for p in revised),
        "price_changes": len(price_changes),
        "price_changes_by_kind": dict(Counter(p.get("kind") for p in price_changes)),
        "updated_records": sum(p != q for p,q in zip(products,revised)),
        "images_names_categories_and_ids_preserved": True,
    }
    return revised, report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    catalog = ROOT / "public/catalog.json"
    catalog_js = ROOT / "public/catalog.js"
    products = json.loads(catalog.read_text(encoding="utf-8"))
    source_js = catalog_js.read_text(encoding="utf-8")
    prefix = "window.STREETBALL_CATALOG = "
    if not source_js.startswith(prefix) or not source_js.rstrip().endswith(";"):
        raise SystemExit("Formato do catálogo JavaScript inesperado.")
    js_products = json.loads(source_js[len(prefix):].rstrip()[:-1])
    if products != js_products:
        raise SystemExit("Os dois catálogos estão diferentes; confira antes de atualizar preços.")
    if len(products) < 10000 or len({p["id"] for p in products}) != len(products):
        raise SystemExit("Catálogo incompleto ou com identificadores repetidos.")
    revised, report = migrate(products)
    print(json.dumps(report, ensure_ascii=False))
    if args.check:
        if revised != products:
            raise SystemExit("Há produtos fora da política de preços.")
        return
    if revised == products:
        return
    # Only catalog data is generated; no images, orders or credentials are touched.
    for target, content in [
        (catalog, json.dumps(revised, ensure_ascii=False, indent=2) + "\n"),
        (catalog_js, prefix + json.dumps(revised, ensure_ascii=False, separators=(",", ":")) + ";\n"),
    ]:
        temporary = target.with_suffix(target.suffix + ".tmp")
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(target)
    (ROOT / "scripts/apparel_price_update_summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
