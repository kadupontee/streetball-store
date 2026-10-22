"""Relatório de custo de compra em USD e margem parcial opcional em BRL.

O preço do fornecedor não altera o preço de venda publicado na loja.
Exemplo: python scripts/pricing_report.py --usd-brl 5.50
Sem cotação: exibe apenas custo USD e preço atual em BRL (sem estimar margem).
"""
from __future__ import annotations

import argparse
import csv
import json
import pathlib

from catalog_utils import PRICES

DIR = pathlib.Path(__file__).resolve().parent


def usd_range(entry):
    if isinstance(entry, dict):
        return (float(entry["min"]), float(entry["max"]))
    value = float(entry)
    return (value, value)


def display_range(low, high):
    return f"{low:.2f}" if low == high else f"{low:.2f}–{high:.2f}"


def produce_report(usd_brl=None, output=None):
    config = json.loads((DIR / "costs.json").read_text(encoding="utf-8"))
    delivery = float(config["shipping_usd"]["one_piece"])
    output = pathlib.Path(output) if output is not None else DIR / "retail_unit_economics.csv"
    if usd_brl is not None and usd_brl <= 0:
        raise ValueError("Cotação USD/BRL precisa ser positiva.")
    with output.open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file)
        writer.writerow([
            "tipo", "compra_USD", "frete_estimado_1_peca_USD",
            "custo_produto_mais_frete_BRL", "preco_venda_referencia_BRL",
            "diferenca_antes_tributos_taxas_BRL", "margem_bruta_parcial_percentual"
        ])
        for code, entry in config["supplier_usd"].items():
            low, high = usd_range(entry)
            price = PRICES.get(code)  # Variante ainda sem preço de venda próprio: deixar vazio.
            landed = (round((low + delivery) * usd_brl, 2),
                      round((high + delivery) * usd_brl, 2)) if usd_brl is not None else None
            gross = (round(price - landed[1], 2), round(price - landed[0], 2)) if landed and price else None
            margin = (round(100 * gross[0] / price, 1),
                      round(100 * gross[1] / price, 1)) if gross and price else None
            writer.writerow([
                code, display_range(low, high), f"{delivery:.2f}",
                display_range(*landed) if landed else "",
                f"{price:.2f}" if price is not None else "",
                display_range(*gross) if gross else "",
                display_range(*margin) if margin else "",
            ])
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--usd-brl", type=float, default=None,
                        help="Cotação de referência USD/BRL informada manualmente")
    args = parser.parse_args()
    path = produce_report(args.usd_brl)
    print("Relatório criado:", path)
    if args.usd_brl is None:
        print("Sem cotação: colunas de custo e margem em BRL ficam vazias.")
