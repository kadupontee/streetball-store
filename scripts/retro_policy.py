"""Política central de classificação e preço para temporadas antigas.

As temporadas normalmente começam em agosto. Na data de 22/10/2026,
2021/22 e anteriores já têm mais de cinco anos desde o início.
Apenas a data no NOME do produto ou no título original do fornecedor é
considerada, jamais IDs de álbuns, URLs, nomes de fotos ou números de tamanhos.

O limite inferior de preço retrô (adulto padrão R$ 199,90;
manga longa R$ 229,90) não é cálculo de margem líquida.
Preços travados manualmente (priceLocked) são preservados.
"""
from __future__ import annotations

from datetime import date
import re
import unicodedata

RETRO_STANDARD_BRL = 199.90
RETRO_LONG_BRL = 229.90
RETR0_MARKERS = re.compile(r'\b(retro|vintage|classic|classica|classico)\b', re.I)
SEASON_PATTERN = re.compile(
    r'(?<!\d)((?:19|20)\d{2}|\d{2})\s*[-/._]\s*((?:19|20)\d{2}|\d{2})(?!\d)'
)
SINGLE_YEAR_PATTERN = re.compile(r'(?<!\d)((?:19|20)\d{2})(?!\d)')
LONG_SLEEVE = re.compile(r'long\s*[- ]?sleeves?|manga\s*longa|retro_long', re.I)
ADULT_KINDS = {'fan', 'long', 'retro', 'retro_long',
               'player_nike', 'player_adidas', 'player_puma'}


def normalized(text):
    return ''.join(
        char for char in unicodedata.normalize('NFD', str(text).lower())
        if unicodedata.category(char) != 'Mn'
    )


def expand_year(value, today):
    number = int(value)
    if len(value) == 4:
        return number
    return 2000 + number if number <= today.year % 100 + 2 else 1900 + number


def extract_season_start(title, today=None):
    """Retorna o primeiro ano de temporada plausível; ignora faixa de tamanhos 16-28."""
    today = today or date.today()
    source = normalized(title)
    for match in SEASON_PATTERN.finditer(source):
        first = expand_year(match.group(1), today)
        second = expand_year(match.group(2), today)
        if second == first + 1 and 1950 <= first <= today.year + 2:
            return first
    for match in SINGLE_YEAR_PATTERN.finditer(source):
        first = int(match.group(1))
        if 1950 <= first <= today.year + 2:
            return first
    return None


def is_older_than_five_seasons(title, today=None):
    today = today or date.today()
    start_year = extract_season_start(title, today)
    # Temporada que começou em agosto. 2021/22 torna-se retrô em agosto/2026.
    season_cutoff = today.year - 5 if today.month >= 8 else today.year - 6
    return start_year is not None and start_year <= season_cutoff


def apply_retro_policy(product, today=None):
    """Altera apenas cópia do produto, preserva IDs, variantes e preços bloqueados."""
    item = dict(product)
    # Jaquetas antigas não são camisas retrô e mantêm sua categoria de vestuário.
    if str(item.get('kind') or '').lower() == 'jacket':
        return item
    title = str(item.get('supplierTitle') or item.get('title') or '')
    if not is_older_than_five_seasons(title, today):
        return item

    if not item.get('categoryLocked'):
        item['category'] = 'retro'
    kind = str(item.get('kind') or 'fan').lower()
    is_adult_shirt = kind in ADULT_KINDS
    long_sleeve = kind in {'long', 'retro_long'} or bool(LONG_SLEEVE.search(normalized(title)))

    if is_adult_shirt:
        target_kind = 'retro_long' if long_sleeve else 'retro'
        if not item.get('kindLocked'):
            item['kind'] = target_kind
        if not item.get('priceLocked'):
            try:
                old_price = float(item.get('price') or 0)
            except (TypeError, ValueError):
                old_price = 0
            minimum = RETRO_LONG_BRL if long_sleeve else RETRO_STANDARD_BRL
            item['price'] = round(max(old_price, minimum), 2)

    if not item.get('badgeLocked') and str(item.get('badge') or '').strip().upper() in ('', 'NOVO', 'NEW'):
        item['badge'] = 'RETRÔ'
    return item
