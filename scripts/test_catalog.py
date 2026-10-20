import json, unittest, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from import_yupoo import get_links,get_pictures,page_title
from catalog_utils import normalize_product,classify,save_catalog,read_catalog,merge_catalog,CATALOG,CATALOG_JS

class CatalogTest(unittest.TestCase):
 def test_parse_album_list(self):
  source='<a href="/albums/233970756?uid=1"><img alt="Turkey 26-27 Home S-4XL"></a><a href="/albums/988877">26-27 São Paulo II</a>'
  links=get_links(source)
  self.assertEqual(len(links),2)
  self.assertEqual(links[0][0],'233970756')
 def test_picture_urls_and_no_third_party(self):
  source='<div class="showalbum__photo"><img data-src="//photo.yupoo.com/james/1.jpg"><img src="https://other-shop.example.com/wrong.jpg"><img data-original="https://photo.yupoo.com/james/2.jpg"></div>'
  self.assertEqual(get_pictures(source),['https://photo.yupoo.com/james/1.jpg','https://photo.yupoo.com/james/2.jpg'])
 def test_classify(self):
  self.assertEqual(classify('26-27 Sao Paulo away player')[0],'brasileirao')
  self.assertEqual(classify('1994 Brazil home jersey')[0],'retro')
  self.assertEqual(classify('NBA Golden State Warriors Curry')[0],'nba')
 def test_album_stable_id_multiple_photos(self):
  p=normalize_product({'title':'Santos 26/27 Home','sourceUrl':'https://james66jersey.x.yupoo.com/albums/123456','images':['https://photo.yupoo.com/j/1.jpg','https://photo.yupoo.com/j/2.jpg']})
  self.assertEqual(p['id'],'YUP-123456');self.assertEqual(len(p['images']),2)
 def test_invalid_domain(self):
  with self.assertRaises(ValueError):normalize_product({'title':'Not mine','sourceUrl':'https://other.example.com/albums/1'})
 def test_price_lock_preservation(self):
  cat,js=CATALOG.read_bytes(),CATALOG_JS.read_bytes()
  try:
   row=normalize_product({'title':'Portugal away','sourceUrl':'https://james66jersey.x.yupoo.com/albums/123999','price':199.90,'priceLocked':True})
   merge_catalog([row]);merge_catalog([{'title':'Portugal Away 2026','sourceUrl':'https://james66jersey.x.yupoo.com/albums/123999','price':159.90}])
   saved=next(p for p in read_catalog() if p['id']=='YUP-123999')
   self.assertEqual(saved['price'],199.9)
  finally:CATALOG.write_bytes(cat);CATALOG_JS.write_bytes(js)
if __name__=='__main__':unittest.main()
