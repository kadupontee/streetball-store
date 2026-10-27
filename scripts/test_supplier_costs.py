"""Regression tests for the supplier-cost table and reporting.

Run: python scripts/test_supplier_costs.py
"""
import csv
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from catalog_utils import PRICES, classify, normalize_product
from pricing_report import produce_report

DATA = Path(__file__).with_name("costs.json")


class SupplierCostTests(unittest.TestCase):
    def test_regular_and_player_shorts_have_separate_usd_costs(self):
        data = json.loads(DATA.read_text(encoding="utf-8"))
        self.assertEqual(data["currency"], "USD")
        self.assertEqual(data["supplier_usd"]["shorts"], 10)
        self.assertEqual(data["supplier_usd"]["shorts_player"], 12)
        self.assertEqual(data["supplier_usd"]["retro_long"], 19)
        self.assertEqual(data["supplier_usd"]["jacket"], 30)
        self.assertEqual(data["shipping_usd"]["one_piece"], 4)

    def test_supplier_cost_and_retail_price_are_distinct(self):
        # A product's published BRL price must remain unchanged by this update.
        self.assertEqual(PRICES["shorts"], 119.90)
        self.assertEqual(PRICES["shorts_player"], 143.90)
        self.assertEqual(PRICES["jacket"], 379.80)
        self.assertEqual(PRICES["coat"], PRICES["jacket"])
        self.assertEqual(PRICES["coat"], 379.80)
        self.assertEqual(PRICES["retro_long"], 229.90)

    def test_report_shows_both_costs_without_inventing_retail(self):
        with TemporaryDirectory() as directory:
            path = produce_report(usd_brl=5.0, output=Path(directory) / "pricing.csv")
            with path.open(encoding="utf-8", newline="") as file:
                entries = {line["tipo"]: line for line in csv.DictReader(file)}
            self.assertEqual(entries["shorts"]["compra_USD"], "10.00")
            self.assertEqual(entries["shorts_player"]["compra_USD"], "12.00")
            self.assertEqual(entries["shorts_player"]["custo_produto_mais_frete_BRL"], "80.00")
            self.assertEqual(entries["shorts"]["custo_produto_mais_frete_BRL"], "70.00")
            self.assertEqual(entries["shorts_player"]["preco_venda_referencia_BRL"], "143.90")
            self.assertEqual(entries["shorts_player"]["margem_bruta_parcial_percentual"], "44.40")

    def test_player_shorts_category_and_existing_prices(self):
        self.assertEqual(classify("Sao Paulo Player Shorts 26-27"), ("acessorios", "shorts_player"))
        self.assertEqual(classify("Calção jogador Brasil 2026"), ("acessorios", "shorts_player"))
        self.assertEqual(classify("Calção comum Brasil 2026"), ("acessorios", "shorts"))
        old = normalize_product({"id": "TEST-PLAYER-SHORTS", "title": "Sao Paulo Player Shorts", "kind": "shorts", "price": 119.90})
        self.assertEqual(old["kind"], "shorts_player")
        self.assertEqual(old["price"], 143.90)
        locked = normalize_product({"id": "TEST-LOCKED-SHORTS", "title": "Sao Paulo Player Shorts", "kind": "shorts", "price": 119.90, "priceLocked": True})
        self.assertEqual(locked["price"], 119.90)

    def test_without_exchange_rate_does_not_guess_margin(self):
        with TemporaryDirectory() as directory:
            path = produce_report(output=Path(directory) / "pricing.csv")
            with path.open(encoding="utf-8", newline="") as file:
                player = next(line for line in csv.DictReader(file) if line["tipo"] == "shorts_player")
            self.assertEqual(player["custo_produto_mais_frete_BRL"], "")
            self.assertEqual(player["compra_USD"], "12.00")


if __name__ == "__main__":
    unittest.main()
