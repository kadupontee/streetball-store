"""Aplica classificação de jaquetas e camisas manga longa nos arquivos do site.

python scripts/reprice_garments.py           # atualiza catalog.json e catalog.js
python scripts/reprice_garments.py --check   # garante que atualização é idempotente
"""
import argparse
import json
import subprocess
from collections import Counter
from pathlib import Path
from garment_policy import garment_decision, apply_garment_pricing, COSTS_USD, PRICES_BRL
from catalog_utils import read_catalog, save_catalog, CATALOG, CATALOG_JS

OUT=Path(__file__).with_name("garment_migration_summary.json")
# Catálogo imediatamente antes da primeira migração, para restauração segura
# de falsos positivos (ex.: hoodie sem jaqueta e kit com peças múltiplas).
ORIGINAL_CATALOG_REF="272cca3590a676fc3752b8e4d3bfde033b9a752f"

def undo_ambiguous_jackets(products):
    needs=[p for p in products if p.get("garmentPriceSource")=="supplier_usd_garment_policy_20261022"
           and p.get("kind")=="jacket"
           and garment_decision(p,require_photo=True)[0] not in ("jacket","coat")]
    if not needs:return products,0
    baseline=json.loads(subprocess.check_output([
        "git","show",ORIGINAL_CATALOG_REF+":public/catalog.json"
    ],cwd=Path(__file__).resolve().parents[1]))
    originals={p["id"]:p for p in baseline}
    targets={p["id"] for p in needs}
    reverted=0
    result=[]
    for p in products:
        old=originals.get(p.get("id"))
        if p.get("id") in targets and old and not p.get("priceLocked") and abs(float(p.get("price") or 0)-379.90)<0.01:
            result.append(old)
            reverted+=1
        else:
            result.append(p)
    return result,reverted

def migrate(products):
    revised=[]
    categories=Counter()
    review=[]
    changes=[]
    for p in products:
        klass,why=garment_decision(p,require_photo=True)
        if klass:categories[klass]+=1
        elif p.get("kind") in ("long","retro_long","jacket") or any(
            word in str(p.get("supplierTitle") or p.get("title") or "").lower()
            for word in ("windbreaker set","jacket set","hoodie set","training top","track suit")):
            if len(review)<120: review.append({"id":p.get("id"),"title":str(p.get("supplierTitle") or p.get("title") or "")[:150],"reason":why,"image":p.get("image"),"old_price":p.get("price")})
        updated=apply_garment_pricing(p,require_photo=True)
        if (updated.get("kind"),updated.get("price"),updated.get("category"))!=(p.get("kind"),p.get("price"),p.get("category")):
            changes.append({
                "id":p.get("id"),"name":str(p.get("supplierTitle") or p.get("title") or "")[:150],
                "kind_before":p.get("kind"),"kind_after":updated.get("kind"),
                "price_before":p.get("price"),"price_after":updated.get("price"),
                "image":p.get("image")
            })
        revised.append(updated)
    report={
        "total_products":len(products),
        "classifiable_with_photo":dict(categories),
        "changed_items":len(changes),
        "changed_by_kind":dict(Counter(i["kind_after"] for i in changes)),
        "price_changes":sum(i["price_before"]!=i["price_after"] for i in changes),
        "supplier_costs_usd":COSTS_USD,
        "retail_brl":PRICES_BRL,
        "review_examples":review,
        "changed_examples":changes[:100],
        "methodology":"Classificação conservadora por nomes de álbum e presença de foto vinculada. Nem toda foto foi inspecionada visualmente; conjuntos ambíguos não são reprecificados.",
    }
    return revised,report

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--check",action="store_true")
    args=parser.parse_args()
    products=read_catalog()
    if not products: raise SystemExit("Catalogo vazio: migração abortada.")
    products,reverted=undo_ambiguous_jackets(products)
    updated,report=migrate(products)
    coats=[p for p in updated if p.get("kind")=="coat"]
    unlocked=[p for p in coats if not p.get("priceLocked")]
    mismatches=[p for p in unlocked if abs(float(p.get("price") or 0)-189.90)>0.01]
    if mismatches:
        bad=", ".join(str(p.get("id")) for p in mismatches[:15])
        raise SystemExit("Casacos sem preço de blusa, revisão necessária: "+bad)
    report["coat_price_audit"]={
        "coat_products":len(coats),
        "unlocked_at_blouse_price":len(unlocked),
        "price_locked":len(coats)-len(unlocked),
        "price_brl":189.90
    }
    report["reverted_false_jackets"]=reverted
    report["jacket_products_now"]=sum(1 for p in updated if p.get("kind")=="jacket")
    report["coat_products_now"]=sum(1 for p in updated if p.get("kind")=="coat")
    print(json.dumps({k:v for k,v in report.items() if k not in ("review_examples","changed_examples")},ensure_ascii=False))
    if args.check:
        if report["changed_items"] or reverted:
            raise SystemExit(f"ERR: {report['changed_items']} produtos ainda precisam ser sincronizados")
        print("OK: preço de jaquetas e mangas longas está sincronizado")
        return
    backup=CATALOG.with_suffix(".json.garment-backup")
    backup.write_bytes(CATALOG.read_bytes())
    try:
        save_catalog(updated)
        OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    except Exception:
        CATALOG.write_bytes(backup.read_bytes())
        raise
    finally:
        backup.unlink(missing_ok=True)
    print("Arquivos de catálogo atualizados:", CATALOG, CATALOG_JS)

if __name__=="__main__":
    main()
