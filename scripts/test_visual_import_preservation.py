"""Verifica que sincronizações do fornecedor não desfazem revisão humana."""
from catalog_utils import preserve_reviewed_entry
old={"id":"YUP-1","title":"Brasil — Jaqueta Corta-Vento",
     "image":"/images/yupoo/1.webp","kind":"jacket","category":"treino",
     "price":379.90,"kindLocked":True,"categoryLocked":True,"priceLocked":True,
     "visualReviewStatus":"foto_local_conferida_2026-10-22"}
new={"id":"YUP-1","title":"Brazil Match Jersey",
     "image":"/images/yupoo/1.webp","kind":"fan","category":"selecoes","price":159.90}
kept=preserve_reviewed_entry(old,new)
assert (kept["title"],kept["kind"],kept["price"],kept["category"]) == (
    old["title"],old["kind"],old["price"],old["category"])
assert kept["visualReviewStatus"] == old["visualReviewStatus"]
assert new["kind"]=="fan"  # sem mutação da entrada
changed_photo=preserve_reviewed_entry(old,{**new,"image":"/images/yupoo/different.webp"})
assert changed_photo["title"]==new["title"]
assert changed_photo["price"]==old["price"]  # trava manual continua valendo
print("OK: importacao preserva correcoes de categoria e preco")
