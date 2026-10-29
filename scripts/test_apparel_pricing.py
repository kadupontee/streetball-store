import unittest
from copy import deepcopy
from garment_policy import APPAREL_PRICE_BRL, apply_apparel_retail_policy, apply_garment_pricing
from unify_apparel_prices import migrate


class ApparelPricingTest(unittest.TestCase):
    def item(self, kind, price, **extras):
        return {"id":"EXAMPLE", "title":"Modelo de inverno", "kind":kind, "price":price,
                "image":"/images/yupoo/example.webp", "images":["/images/yupoo/example.webp"], **extras}

    def test_every_apparel_kind_uses_the_current_shared_price_even_with_old_price_locks(self):
        for kind in ("jacket", "coat", "blouse"):
            for price in (189.90, 379.90, 450):
                original = self.item(kind, price, priceLocked=True, kindLocked=True)
                updated = apply_apparel_retail_policy(original)
                self.assertEqual(updated["price"], 409.90)
                self.assertEqual(updated["kind"], kind)
                self.assertEqual(updated["images"], original["images"])
                self.assertEqual(original["price"], price)

    def test_uncertain_piece_keeps_type_and_uses_higher_price(self):
        original = self.item("long", 189.90, title="Barcelona Training Top S-2XL")
        updated = apply_apparel_retail_policy(original)
        self.assertEqual(updated["kind"], "long")
        self.assertEqual(updated["price"], APPAREL_PRICE_BRL)
        self.assertTrue(updated["apparelPriceReviewRequired"])
        higher = self.item("set", 450, title="Barcelona Hoodie Set")
        self.assertEqual(apply_apparel_retail_policy(higher)["price"], 450)

    def test_photo_verified_shirt_with_old_hoodie_title_is_preserved(self):
        original = self.item("fan", 159.90, title="Argentina Hoodie", kindLocked=True,
                             visualReviewStatus="foto_local_conferida_2026-10-22")
        self.assertEqual(apply_apparel_retail_policy(original), original)

    def test_normal_jerseys_and_clear_sets_are_not_repriced(self):
        for original in [self.item("fan", 159.90, title="Brasil Home Jersey"),
                         self.item("retro_long", 229.90, title="Brasil Retro Jersey Long Sleeve"),
                         self.item("set", 299.90, title="Brasil Training Tracksuit")]:
            self.assertEqual(apply_apparel_retail_policy(original), original)

    def test_imported_hoodie_cannot_return_to_the_old_lower_price(self):
        updated = apply_garment_pricing(self.item("fan", 159.90, title="Barcelona Hoodie"))
        self.assertEqual(updated["kind"], "blouse")
        self.assertEqual(updated["price"], APPAREL_PRICE_BRL)

    def test_migration_changes_only_pricing_fields_and_is_idempotent(self):
        products = [self.item("jacket", 379.90), self.item("set", 299.90, id="OTHER", title="Barcelona Hoodie Set")]
        original = deepcopy(products)
        revised, report = migrate(products)
        self.assertEqual(products, original)
        self.assertEqual(report["price_changes"], 2)
        self.assertEqual([p["id"] for p in revised], [p["id"] for p in products])
        self.assertEqual(migrate(revised)[0], revised)
        self.assertEqual(migrate(revised)[1]["price_changes"], 0)


if __name__ == "__main__":
    unittest.main()
