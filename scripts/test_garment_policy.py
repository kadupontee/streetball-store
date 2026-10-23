"""Regressões de precificação de jaquetas e mangas longas."""
import unittest
from garment_policy import garment_decision, apply_garment_pricing

def product(title,kind="fan",price=159.90,**kw):
    return {"id":"T-001","title":title,"kind":kind,"price":price,
            "image":"/images/yupoo/258348731.webp",**kw}

class GarmentPolicyTest(unittest.TestCase):
    def test_jacket_individual(self):
        p=apply_garment_pricing(product("America Adidas Hooded jacket long zipper"))
        self.assertEqual((p["kind"],p["price"],p["category"]),("jacket",379.90,"treino"))
    def test_coat_same_price_as_blouse(self):
        for title in ("Real Madrid Long Coat", "Winter coat Flamengo", "Casaco Portugal 2026", "Manchester United Trench Coat"):
            p=apply_garment_pricing(product(title, kind="jacket", price=379.90))
            self.assertEqual((p["kind"],p["price"]),("coat",189.90),title)
            self.assertEqual(apply_garment_pricing(p),p)

    def test_coat_without_manual_price_change_and_without_image(self):
        locked=apply_garment_pricing(product("Casaco São Paulo",kind="jacket",price=379.90,priceLocked=True))
        self.assertEqual(locked["price"],379.90)
        absent=product("Chelsea coat",kind="jacket",price=379.90)
        absent["image"]=""
        self.assertEqual(apply_garment_pricing(absent,require_photo=True)["price"],379.90)

    def test_jaquetas_continuam_com_preco_original(self):
        a=apply_garment_pricing(product("Arsenal Windbreaker Jacket",kind="jacket",price=379.90))
        self.assertEqual((a["kind"],a["price"]),("jacket",379.90))
        b=apply_garment_pricing(product("Barcelona Half-Zip Training Top",kind="jacket",price=379.90))
        self.assertEqual((b["kind"],b["price"]),("blouse",189.90))

    def test_conjunto_de_casaco_nao_muda(self):
        p=apply_garment_pricing(product("Chelsea Coat Set",kind="set",price=299.90))
        self.assertEqual((p["kind"],p["price"]),("set",299.90))

    def test_coat_kind_without_label_keeps_blouse_price(self):
        item=product("Modelo de inverno",kind="coat",price=379.90)
        self.assertEqual(apply_garment_pricing(item)["price"],189.90)
        higher=product("Casaco Casual Benfica",kind="coat",price=329.90)
        self.assertEqual(apply_garment_pricing(higher)["price"],189.90)

    def test_hoodie_pullover_e_sweatshirt_sao_blusas(self):
        for name in ("Real Madrid Hoodie S-2XL","Barcelona Sweatshirt S-3XL","São Paulo Moletom preto", "Arsenal Fleece Pullover"):
            item=product(name,kind="fan",price=159.90)
            revised=apply_garment_pricing(item)
            self.assertEqual((revised["kind"],revised["price"]),("blouse",189.90),name)

    def test_half_zip_nao_deve_ser_jaqueta(self):
        item=product("Betis Half-Zip Training Top S-2XL",kind="jacket",price=379.90)
        revised=apply_garment_pricing(item)
        self.assertEqual((revised["kind"],revised["price"]),("blouse",189.90))

    def test_jaqueta_com_zip_eh_diferente_de_blusa_half_zip(self):
        item=product("Chelsea Half-Zip Jacket",kind="jacket",price=379.90)
        self.assertEqual(apply_garment_pricing(item)["kind"],"jacket")

    def test_hoodie_em_conjunto_nao_reprecifica(self):
        item=product("Portugal Hoodie Set",kind="set",price=299.90)
        self.assertEqual((apply_garment_pricing(item)["kind"],apply_garment_pricing(item)["price"]),("set",299.90))

    def test_jacket_set_needs_review(self):
        p=apply_garment_pricing(product("Barcelona windbreaker set S-2XL",kind="set",price=299.90))
        self.assertEqual(p["kind"],"set")
        self.assertEqual(p["price"],299.90)
    def test_long_regular(self):
        p=apply_garment_pricing(product("26-27 Real Madrid Home Long Sleeve S-4XL",kind="long",price=189.90))
        self.assertEqual(p["kind"],"long")
        self.assertEqual(p["price"],189.90)
    def test_retro_long(self):
        p=apply_garment_pricing(product("2002 Brazil home jersey long sleeves",kind="retro",price=199.90))
        self.assertEqual((p["kind"],p["price"]),("retro_long",229.90))
        q=apply_garment_pricing(product("retro Argentina jersey long sleeves",kind="retro_long",price=229.90))
        self.assertEqual((q["kind"],q["price"]),("retro_long",229.90))
    def test_lock_respected(self):
        p=apply_garment_pricing(product("Brasil Windbreaker jacket",price=270.90,priceLocked=True))
        self.assertEqual(p["price"],270.90)
        q=apply_garment_pricing(product("Brasil Windbreaker jacket",kindLocked=True))
        self.assertEqual(q["kind"],"fan")
        self.assertEqual(q["price"],159.90)
    def test_no_photo_not_migrated(self):
        p=product("Brasil Windbreaker jacket")
        p["image"]=""
        self.assertEqual(apply_garment_pricing(p,require_photo=True)["price"],159.90)
    def test_short_sleeve_training_top_not_jacket(self):
        p=product("Aston Villa Short Sleeve Training Top",kind="long",price=189.90)
        self.assertIsNone(garment_decision(p)[0])
    def test_kids_goalkeeper_not_retro_long(self):
        p=product("Kids 2026 Spain Goalkeeper Long Sleeves 16-28",kind="kids",price=179.90)
        self.assertIsNone(garment_decision(p)[0])
        self.assertEqual(apply_garment_pricing(p)["price"],179.90)
    def test_idempotence(self):
        p=product("Arsenal Classic Retro Windbreaker Jacket",kind="retro",price=199.90)
        a=apply_garment_pricing(p)
        b=apply_garment_pricing(a)
        self.assertEqual(a,b)
        self.assertEqual(a["price"],379.90)
    def test_plain_hoodies_are_not_individual_jackets(self):
        for name in ("Barcelona fleece hoodie","Huamian Embroidered Cardigan Hoodie White"):
            item=product(name)
            self.assertEqual(garment_decision(item)[0],"blouse",name)
            self.assertEqual(apply_garment_pricing(item)["price"],189.90)
        self.assertIsNone(garment_decision(product("Flamengo Jacket kits 815"))[0])
    def test_halfzip_blusa_e_zip_frontal_jaqueta(self):
        top=product("Manchester United Half-Zip Training Top")
        self.assertEqual(garment_decision(top)[0],"blouse")
        jacket=product("Manchester United Full-Zip Training Jacket")
        self.assertEqual(garment_decision(jacket)[0],"jacket")
    def test_old_retro_jacket_cost_overrides_jersey(self):
        item=product("1998 Arsenal Retro Windbreaker Jacket",kind="retro",price=199.90)
        self.assertEqual(apply_garment_pricing(item)["price"],379.90)
    def test_no_unrelated_products(self):
        p=product("Manchester City Home Jersey 2026",kind="fan")
        self.assertEqual(p,apply_garment_pricing(p))
    def test_plain_ambiguous_training_top(self):
        p=product("Barcelona plain training top",kind="long",price=189.90)
        self.assertIsNone(garment_decision(p)[0])

if __name__=="__main__":
    unittest.main()
