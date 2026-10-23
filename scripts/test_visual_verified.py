"""Testes puros da lista de classificações conferidas por fotografia."""
from visual_verified import PHOTO_CONFIRMED, REVIEW_ONLY, AUDIT_TAG, expected_image, apply_reviewed_visual_fix

assert len(PHOTO_CONFIRMED) == 54
assert len(REVIEW_ONLY) == 9
assert set(PHOTO_CONFIRMED).isdisjoint(REVIEW_ONLY)
for number, (category, kind, price, title) in PHOTO_CONFIRMED.items():
    p = {"id":"YUP-"+number, "image":expected_image(number),
         "kind":"fan" if kind!="fan" else "blouse",
         "category":"outras", "price":99.90,
         "supplierTitle":"Fornecedor original","sourceUrl":"https://james66jersey.x.yupoo.com/albums/"+number}
    fixed = apply_reviewed_visual_fix(p)
    assert (fixed["category"],fixed["kind"],fixed["price"],fixed["title"]) == (category,kind,price,title)
    assert fixed["visualReviewStatus"] == AUDIT_TAG
    assert fixed["sourceUrl"] == p["sourceUrl"]
    assert fixed["supplierTitle"] == p["supplierTitle"]
    assert all(fixed[x] for x in ("kindLocked","priceLocked","categoryLocked"))
    assert apply_reviewed_visual_fix(fixed)==fixed, number
    changed_photo = {**p, "image":"/images/yupoo/other.webp"}
    assert apply_reviewed_visual_fix(changed_photo)==changed_photo
    manual = {**p, "priceLocked":True}
    assert apply_reviewed_visual_fix(manual)==manual
print("OK: 54 revisões idempotentes, 9 em revisão, preservação de preços manuais e fotos")
