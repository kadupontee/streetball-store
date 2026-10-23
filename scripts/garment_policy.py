"""Política conservadora de jaquetas e camisas de manga longa da Streetball Store.

Custo USD: jaqueta 30, manga longa 15, manga longa retrô 19; custo de casaco não informado.
Preços BRL: jaqueta 379,90; casaco e blusa 189,90; manga longa retrô 229,90.
Não infere pixel de imagens: exige foto cadastrada na migração e classificações
claras por título/álbum; registros ambíguos ficam no relatório de revisão.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date

PRICES_BRL = {"jacket":379.90,"coat":189.90,"blouse":189.90,"long":189.90,"retro_long":229.90}
COSTS_USD = {"jacket":30,"long":15,"retro_long":19}
# Tipos e preços antigos do importador que podem ser corrigidos automaticamente.
LEGACY_PRICES = {159.90,189.90,199.90,229.90,209.90,219.90,299.90}
JACKET = re.compile(
    r"\b(?:jackets?|jaquetas?|wind\s*breakers?|windbreakers?|"
    r"track\s*jackets?|shell\s*jackets?|softshell|"
    r"full\s*[- ]?zip(?:per)?|"
    
    r"anoraks?|parkas?|corta\s*vento)\b",re.I
)
COAT = re.compile(r"\b(?:coats?|casacos?)\b",re.I)
# Blusas de treino e moletons são peças diferentes das camisas (jerseys).
BLOUSE = re.compile(
    r"\b(?:sweatshirts?|sweaters?|pullovers?|hoodies?|hooded\s*sweatshirts?|"
    r"cardigans?|sudaderas?|blusas?|moletom|moletons|"
    r"training\s*pullovers?|training\s*sweatshirts?|fleece\s*(?:tops?|sweatshirts?)|"
    r"half\s*[- ]?zip(?:per)?|quarter\s*[- ]?zip(?:per)?|"
    r"1/2\s*[- ]?zip|1/4\s*[- ]?zip|half\s*[- ]?pull(?:over)?)\b",re.I
)
# "Training top" sem manga informada exige inspeção visual; pode ser camiseta.
TRAINING_TOP = re.compile(r"\b(?:training\s*tops?|pre\s*[- ]?match\s*tops?)\b",re.I)
LONG = re.compile(
    r"\b(?:long\s*[- ]?sleeves?|long\s*[- ]?sleeved|longsleeves?|"
    r"mangas?\s*longas?)\b",re.I
)
SHORT = re.compile(r"\b(?:short\s*[- ]?sleeves?|regata|vest\s*training|tank\s*top)\b",re.I)
SET = re.compile(
    r"\b(?:tracksuits?|jacket\s*sets?|jacket\s*kits?|coat\s*sets?|casaco\s*conjunto|windbreaker\s*sets?|"
    r"hoodie\s*sets?|training\s*suits?|conjuntos?|"
    r"jackets?\s*(?:and|\+)\s*pants?|suits?)\b",re.I
)
RETRO = re.compile(r"\b(?:retro|vintage|classic|classico|classica)\b",re.I)
SEASON = re.compile(r"(?<!\d)((?:19|20)\d{2}|\d{2})\s*[-/._]\s*((?:19|20)\d{2}|\d{2})(?!\d)")
FOUR_YEAR = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
JERSEY = re.compile(r"\b(?:jerseys?|camisas?|shirts?|football|soccer|goalkeepers?|gk|home|away)\b",re.I)
# Títulos de peças de treino sem especificação de manga não justificam reclassificação.
NO_GARMENT = {"kids","socks","shorts","shorts_player"}

def normalized(value):
    return "".join(c for c in unicodedata.normalize("NFD",str(value or "").lower())
                   if unicodedata.category(c)!="Mn")

def _year(value,current):
    year=int(value)
    return year if len(value)==4 else (2000+year if year<=current%100+2 else 1900+year)

def older_season(title, today=None):
    today=today or date.today()
    cutoff=today.year-5 if today.month>=8 else today.year-6
    for m in SEASON.finditer(title):
        first=_year(m.group(1),today.year)
        second=_year(m.group(2),today.year)
        if 1950<=first<=today.year+2 and second==first+1 and first<=cutoff:
            return True
    for m in FOUR_YEAR.finditer(title):
        year=int(m.group(1))
        if 1950<=year<=cutoff:
            return True
    return False

def garment_decision(product, *, require_photo=False):
    """(categoria, motivo) ou (None, motivo). Nunca identifica a partir de pixels."""
    if require_photo and not (product.get("image") or product.get("images")):
        return None,"sem foto cadastrada"
    title=normalized(product.get("supplierTitle") or product.get("title"))
    kind=str(product.get("kind") or "").lower()
    if not title:
        return None,"sem nome"
    if kind in NO_GARMENT or re.search(r"\b(?:kids?|children|infantil|baby)\b",title):
        return None,"produto infantil ou acessorio"
    is_coat=bool(COAT.search(title)) or kind=="coat"
    is_jacket=bool(JACKET.search(title)) or kind=="jacket"
    is_set=bool(SET.search(title)) or (
        (is_jacket or is_coat) and bool(re.search(r"\b(?:pants?|calcas?|trousers?|joggers?|bottoms?)\b",title))
    )
    if (is_jacket or is_coat) and is_set:
        return None,"conjunto com jaqueta ou casaco: preco de conjunto nao confirmado"
    if is_coat:
        return "coat","casaco identificado no titulo: mesmo preco de blusa"
    if is_jacket:
        return "jacket","jaqueta ou corta-vento com fecho integral identificado no titulo"
    if SHORT.search(title):
        return None,"peca de manga curta, regata ou colete"
    if (BLOUSE.search(title) or kind=="blouse") and not SHORT.search(title):
        return "blouse","blusa, moletom ou pullover identificado por nome"
    if TRAINING_TOP.search(title) and not LONG.search(title):
        return None,"training top sem manga confirmada: revisar foto"
    if not LONG.search(title):
        return None,"manga nao identificavel com seguranca"
    if not (JERSEY.search(title) or kind in
            {"long","retro_long","retro","fan","player_adidas","player_nike","player_puma"}):
        return None,"manga longa ambigua"
    is_retro=bool(RETRO.search(title)) or older_season(title)
    # Preserva classificação retrô já confirmada pelo usuário/importação.
    is_retro=is_retro or kind=="retro_long"
    return ("retro_long" if is_retro else "long"),"camisa manga longa retrô" if is_retro else "camisa manga longa"

def apply_garment_pricing(product, *, require_photo=False):
    """Promove kind e preço apenas quando claramente identificados e não travados."""
    item=dict(product)
    target,why=garment_decision(item,require_photo=require_photo)
    if target is None:return item
    if item.get("kindLocked") and item.get("kind")!=target:
        return item
    old_kind=item.get("kind")
    if not item.get("kindLocked"):
        item["kind"]=target
    if target in ("jacket","coat","blouse") and not item.get("categoryLocked"):
        item["category"]="treino"
    if not item.get("priceLocked"):
        try: old_price=float(item.get("price") or 0)
        except (TypeError,ValueError):old_price=0
        if target in ("coat","blouse") or old_price==0 or any(abs(old_price-old)<0.01 for old in LEGACY_PRICES):
            item["price"]=PRICES_BRL[target]
    if item.get("kind")!=old_kind or item.get("price")!=product.get("price"):
        item["garmentClassification"]="title_and_image_link"
        item["garmentPriceSource"]="supplier_usd_garment_policy_20261022"
    return item
