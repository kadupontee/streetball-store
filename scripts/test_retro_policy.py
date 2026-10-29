#!/usr/bin/env python3
"""Testes da regra temporal e dos pisos comerciais para retrôs."""
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from retro_policy import apply_retro_policy, extract_season_start, is_older_than_five_seasons
from catalog_utils import classify, normalize_product, PRICES


NOW = date(2026, 10, 22)


class RetroPolicyTests(unittest.TestCase):
    def test_date_formats(self):
        for title in ('Real Madrid 2016/17 Away', 'Manchester United 98/99', 'Sao Paulo 20-21 Home',
                      'Brasil 1994 Home', 'Inter Milan 2019_20', 'Porto 21/22'):
            with self.subTest(title=title):
                self.assertTrue(is_older_than_five_seasons(title, NOW))

    def test_not_retro_recent_or_size(self):
        for title in ('Santos 22/23', 'Real Madrid 26/27', 'Kids 16-28 Away', 'Calção 2025',
                      'Camisa 2026', 'Camisa sem data'):
            with self.subTest(title=title):
                self.assertFalse(is_older_than_five_seasons(title, NOW))

    def test_wrong_sequence_not_a_season(self):
        self.assertIsNone(extract_season_start('16-28 Home', NOW))

    def test_retro_prices(self):
        standard=apply_retro_policy({'id':'x','title':'Real Madrid 2016/17 Home','category':'europa',
                                     'kind':'fan','price':159.90}, NOW)
        self.assertEqual((standard['category'],standard['kind'],standard['price']),('retro','retro',249.90))
        sleeve=apply_retro_policy({'id':'y','title':'Milan 2017/18 Long Sleeve','category':'europa',
                                   'kind':'long','price':189.90},NOW)
        self.assertEqual((sleeve['category'],sleeve['kind'],sleeve['price']),('retro','retro_long',279.90))

    def test_do_not_lower_premium(self):
        row=apply_retro_policy({'title':'Barcelona 2015/16 Player','category':'europa',
                                'kind':'player_nike','price':249.90},NOW)
        self.assertEqual(row['price'],249.90)

    def test_preserve_manual_locks(self):
        row=apply_retro_policy({'title':'Braga 2012/13','category':'europa','categoryLocked':True,
                                'kind':'fan','price':175,'priceLocked':True},NOW)
        self.assertEqual(row['category'],'europa')
        self.assertEqual(row['price'],175)
        self.assertEqual(row['kind'],'retro')

    def test_keep_other_variants_price(self):
        for kind, price in [('kids',179.90),('female',159.90),('shorts',119.90),
                            ('socks',59.90),('set',299.90)]:
            with self.subTest(kind=kind):
                row=apply_retro_policy({'title':'Brasil 2010 Uniforme','kind':kind,
                                        'category':'outras','price':price}, NOW)
                self.assertEqual(row['category'],'retro')
                self.assertEqual(row['kind'],kind)
                self.assertEqual(row['price'],price)

    def test_import_without_price(self):
        row=normalize_product({'id':'YUP-565656','title':'2018/19 Arsenal Home',
                               'sourceUrl':'https://james66jersey.x.yupoo.com/albums/565656'})
        self.assertEqual(row['price'], PRICES['retro'])
        self.assertEqual(row['category'],'retro')

    def test_nonretro_new(self):
        self.assertEqual(classify('Real Madrid 2026/27 Home'),('europa','fan'))
        row=apply_retro_policy({'title':'Real Madrid 2026/27 Home','category':'europa',
                                'kind':'fan','price':159.90}, NOW)
        self.assertEqual(row['price'],159.90)


if __name__ == '__main__':
    unittest.main()
