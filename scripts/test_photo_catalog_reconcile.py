"""Testes do reconciliador automatico em amostras sem gravar o catalogo."""
from photo_catalog_reconcile import proposed, reconcile
def row(number, kind="fan", title="Canada Windbreaker Jacket", price=159.90):
    return {"id":"YUP-"+str(number),"kind":kind,"price":price,"category":"outras",
            "image":"/images/yupoo/"+str(number)+".webp","supplierTitle":title}
def vision(p, cls, score=.92, runner_up=.03):
    return {"id":p["id"],"image":p["image"],"top":[{"class":cls,"probability":score},{"class":"jersey_short","probability":runner_up}]}
one=row(123)
assert proposed(one,vision(one,"jacket_windbreaker"))[0]=="jacket"
assert proposed({**one,"kindLocked":True},vision(one,"jacket_windbreaker")) is None
assert proposed(one,vision(one,"jacket_windbreaker",.34,.28)) is None
assert proposed(row(1,title="Argentina Windbreaker Set"),vision(row(1,title="Argentina Windbreaker Set"),"jacket_full_zip")) is None
blouse=row(2,kind="fan",title="Manchester United Hoodie")
assert proposed(blouse,vision(blouse,"blouse_hoodie"))[0]=="blouse"
short=row(3,kind="long",title="Brasil Training Jersey")
assert proposed(short,vision(short,"jersey_short"))[0]=="fan"
long=row(4,kind="long",title="Brasil Long Sleeve Training Jersey")
assert proposed(long,vision(long,"jersey_short")) is None
print("OK: regras conservadoras para jaquetas, blusas e camisas, com travas manuais")
