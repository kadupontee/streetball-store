"""Correções de vestuário conferidas diretamente nas fotos do catálogo.

A foto, não a sugestão automática do CLIP, fundamenta cada alteração.
Não substitui imagem, URL do fornecedor ou descrição de personalização.
Produtos com travas manuais conflitantes são preservados.
"""
from __future__ import annotations

from copy import deepcopy

# id: (categoria, tipo, preço BRL, nome público)
PHOTO_CONFIRMED = {
    # Jaquetas / corta-ventos com zíper completo
    "253733487": ("treino", "jacket", 379.90, "Brasil — Jaqueta Corta-Vento Rosa"),
    "240293645": ("treino", "jacket", 379.90, "México — Jaqueta de Treino Branca"),
    "239985687": ("treino", "jacket", 379.90, "Brasil — Jaqueta Corta-Vento Amarela"),
    "239985290": ("treino", "jacket", 379.90, "Holanda — Jaqueta Corta-Vento Laranja"),
    "239984784": ("treino", "jacket", 379.90, "Noruega — Jaqueta Corta-Vento Azul-Marinho"),
    "235451056": ("treino", "jacket", 379.90, "Barcelona — Jaqueta de Treino Marrom"),
    "231665554": ("treino", "jacket", 379.90, "Paris Saint-Germain — Jaqueta Corta-Vento Preta"),
    "230605620": ("treino", "jacket", 379.90, "França — Jaqueta de Treino Azul-Marinho"),
    "220752866": ("treino", "jacket", 379.90, "Corinthians — Jaqueta de Treino Preta"),
    # Casacos acolchoados (preço de casaco já definido na política comercial)
    "224576022": ("treino", "coat", 189.90, "Bélgica — Casaco Acolchoado Preto"),
    "224575992": ("treino", "coat", 189.90, "Bayern de Munique — Casaco Acolchoado Preto"),
    "224575931": ("treino", "coat", 189.90, "Alemanha — Casaco Acolchoado Preto"),
    "224575800": ("treino", "coat", 189.90, "Real Betis — Casaco Acolchoado Preto"),
    "224575760": ("treino", "coat", 189.90, "Espanha — Casaco Acolchoado Preto"),
    "224575686": ("treino", "coat", 189.90, "Arsenal — Casaco Acolchoado Preto"),
    "224575624": ("treino", "coat", 189.90, "Colômbia — Casaco Acolchoado Preto"),
    "224573190": ("treino", "coat", 189.90, "Japão — Casaco Acolchoado Preto"),
    "224573126": ("treino", "coat", 189.90, "México — Casaco Acolchoado Preto"),
    "220746711": ("treino", "coat", 189.90, "Brasil — Casaco Longo Acolchoado Preto"),
    # Segunda rodada: inspeção humana de fotos que o modelo CLIP havia classificado com menor confiança.
    "253737092": ("treino", "jacket", 379.90, "Itália — Jaqueta de Treino Verde e Azul"),
    "249150245": ("treino", "jacket", 379.90, "Real Madrid — Jaqueta de Treino Azul"),
    "248514946": ("treino", "jacket", 379.90, "Argentina — Jaqueta Branca de Treino"),
    "248095837": ("treino", "jacket", 379.90, "Brasil — Jaqueta Corta-Vento Azul"),
    "247430287": ("treino", "blouse", 189.90, "Espanha — Moletom Azul com Capuz"),
    "240293298": ("treino", "jacket", 379.90, "País de Gales — Jaqueta de Treino Branca"),
    "239985025": ("treino", "jacket", 379.90, "Inglaterra — Jaqueta Corta-Vento Azul"),
    "236313526": ("treino", "jacket", 379.90, "Brasil — Jaqueta de Treino Azul-Claro"),
    "235853547": ("treino", "jacket", 379.90, "Real Madrid — Jaqueta Azul-Marinho de Treino"),
    "229794834": ("treino", "jacket", 379.90, "Inter de Milão — Jaqueta Clara com Capuz"),
    "229794745": ("treino", "jacket", 379.90, "Paris Saint-Germain — Jaqueta Azul com Capuz"),
    "229794657": ("treino", "blouse", 189.90, "Manchester United — Moletom Preto com Capuz"),
    "224572812": ("treino", "blouse", 189.90, "México — Blusa Rosa de Treino com Meio Zíper"),
    "223009182": ("treino", "blouse", 189.90, "Manchester City — Moletom Azul-Claro Manga Longa"),
    "222838822": ("treino", "jacket", 379.90, "Paris Saint-Germain — Jaqueta Branca de Treino"),
    "222024504": ("treino", "blouse", 189.90, "Oasis — Blusa Branca e Azul-Marinho"),
    "220839632": ("treino", "coat", 189.90, "São Paulo — Casaco Longo Preto"),
    "220839618": ("treino", "jacket", 379.90, "São Paulo — Jaqueta Vermelha e Preta"),
    "220838810": ("treino", "coat", 189.90, "Palmeiras — Casaco Longo Preto"),
    "220752322": ("treino", "blouse", 189.90, "Celtic — Moletom Vermelho com Capuz"),
    "220637843": ("treino", "jacket", 379.90, "São Paulo — Jaqueta Corta-Vento Cinza"),
    "220637341": ("treino", "jacket", 379.90, "Corinthians — Jaqueta de Treino Cinza e Preta"),
    # Terceira rodada: camisetas de treino com manga curta incorretamente marcadas 'long'.
    "238767432": ("treino", "fan", 159.90, "Brasil — Camiseta de Treino Cinza"),
    "250242076": ("treino", "fan", 159.90, "Espanha — Camiseta de Treino Azul"),
    "213864520": ("treino", "fan", 159.90, "Portugal — Camiseta Vermelha de Treino"),
    "244882480": ("treino", "fan", 159.90, "Corinthians — Camiseta Preta de Pré-Jogo"),
    "233362819": ("treino", "fan", 159.90, "Brasil — Camiseta Preta de Treino"),
    "213863996": ("treino", "fan", 159.90, "Newcastle — Camiseta Estampada de Pré-Jogo"),
    "244834881": ("treino", "fan", 159.90, "Real Madrid — Camiseta Estampada de Treino"),
    "258349011": ("treino", "fan", 159.90, "Real Madrid — Camiseta Azul de Treino"),
    "245820955": ("treino", "fan", 159.90, "Brasil — Camiseta Estampada de Treino"),
    "223321809": ("acessorios", "shorts", 119.90, "Flamengo — Calção de Treino Preto"),
    # Fotos são camisas: os álbuns vinham com a indicação incorreta 'hoodie'
    "250929923": ("selecoes", "fan", 159.90, "Argentina — Camiseta Branca Adidas"),
    "250929853": ("selecoes", "fan", 159.90, "Itália — Camiseta Branca Adidas"),
    # Uniforme de goleiro de manga longa; não é jaqueta
    "223011413": ("selecoes", "long", 189.90, "Brasil — Camisa de Goleiro Manga Longa"),
}
AUDIT_TAG = "foto_local_conferida_2026-10-22"

# Modelo CLIP marcou divergência, mas inspeção humana mostrou que não deve
# haver alteração automática ou exige verificação de custo/álbum.
REVIEW_ONLY = {
    "258349411": "Colete acolchoado São Paulo: custo/preço de colete não informado",
    "247829255": "Polo Manchester United manga curta: custo de polo não informado",
    "247296871": "Conjunto infantil PSV (blusa e calça): preço de conjunto infantil não informado",
    "242243267": "Jaqueta Argentina já classificada corretamente",
    "239347372": "Álbum McLaren apresenta polo Mercedes: confirmar identidade com fornecedor",
    "226917927": "Camiseta Corinthians já classificada como fan",
    "226917893": "Camiseta Corinthians já classificada como fan",
    "220838919": "Colete acolchoado Paris: custo de colete não informado",
    "220612500": "Colete acolchoado Paris: custo de colete não informado",
}

def expected_image(number: str) -> str:
    return "/images/yupoo/" + number + ".webp"

def apply_reviewed_visual_fix(product: dict) -> dict:
    sku = str(product.get("id") or "")
    number = sku.removeprefix("YUP-")
    spec = PHOTO_CONFIRMED.get(number) if sku == "YUP-" + number else None
    if not spec or product.get("image") != expected_image(number):
        return product
    category, kind, price, title = spec

    # Não anular decisão manual do lojista que conflite com o relatório.
    if (product.get("kindLocked") and product.get("kind") != kind
        or product.get("categoryLocked") and product.get("category") != category
        or product.get("priceLocked") and abs(float(product.get("price") or 0)-price)>0.009):
        return product

    result = deepcopy(product)
    result.update({
        "title": title, "kind": kind, "category": category, "price": price,
        "kindLocked": True, "categoryLocked": True, "priceLocked": True,
        "visualReviewStatus": AUDIT_TAG,
        "visualReviewedImage": expected_image(number)
    })
    return result

def validate_and_apply(products: list[dict]) -> tuple[list[dict], dict]:
    by_id = {str(p.get("id")): p for p in products}
    missing = []
    mismatched_photos = []
    blocked = []
    for num, (cat, kind, price, title) in PHOTO_CONFIRMED.items():
        sku = "YUP-" + num
        row = by_id.get(sku)
        if not row:
            missing.append(sku)
        elif row.get("image") != expected_image(num):
            mismatched_photos.append(sku)
        else:
            fixed = apply_reviewed_visual_fix(row)
            if (fixed.get("kind"), fixed.get("category"), fixed.get("price"), fixed.get("title")) != (kind, cat, price, title):
                blocked.append(sku)
    if missing or mismatched_photos or blocked:
        raise ValueError(f"Conferência interrompida: ausentes={missing}; fotos trocadas={mismatched_photos}; travas conflitantes={blocked}")
    revised = [apply_reviewed_visual_fix(p) for p in products]
    changes = [p["id"] for p, q in zip(products, revised) if p != q]
    confirmed_present = sum(p.get("visualReviewStatus") == AUDIT_TAG for p in revised)
    return revised, {"catalog_products":len(products),
        "photo_confirmed":len(PHOTO_CONFIRMED), "confirmed_present":confirmed_present, "changed":len(changes),
        "changed_ids":changes,"review_only":REVIEW_ONLY,
        "safety":"Sem mudanças de imagem, link ou produtos com travas manuais conflitantes."}

def main():
    import json
    from pathlib import Path
    from catalog_utils import ROOT, read_catalog, save_catalog
    products = read_catalog()
    if len(products) < 10000:
        raise SystemExit("Catálogo menor que 10 mil itens: atualização interrompida")
    revised, report = validate_and_apply(products)
    if report["changed"]:
        save_catalog(revised)
    report_path = ROOT / "scripts" / "visual_verified_result.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k not in ("changed_ids","review_only")}, ensure_ascii=False))

if __name__ == "__main__":
    main()
