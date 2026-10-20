"""Valida os parsers sem consultar o fornecedor nem alterar o catálogo do usuário."""
import unittest
from import_yupoo import album_cards,get_pictures,integrate_cards,integrate_photos,protected_album
class ImportadorTest(unittest.TestCase):
    def setUp(self):
        self.html='''<a class="album__card" href="/albums/123456?uid=1"><img data-src="//photo.yupoo.com/james66jersey/abc/big.jpg"><span class="album__name">26-27 Sao Paulo away player S-4XL</span></a><a href="/albums/123457"><img data-origin-src="//photo.yupoo.com/james66jersey/def/front.jpg"><span class="album__title">2003-04 Real Madrid Retro</span></a><a href="/categories/1">Sem álbum</a>'''
    def test_index(self):
        c=album_cards(self.html)
        self.assertEqual(len(c),2)
        self.assertEqual(c['123456']['title'],'26-27 Sao Paulo away player S-4XL')
        self.assertEqual(c['123457']['cover'],'https://photo.yupoo.com/james66jersey/def/front.jpg')
    def test_photo_list(self):
        s='''<div class="showalbum__children image__main"><img data-origin-src="//photo.yupoo.com/james66jersey/a/front.jpg" data-src="//photo.yupoo.com/james66jersey/a/big.jpg"></div><div class="showalbum__children image__main"><img data-origin-src="//photo.yupoo.com/james66jersey/a/back.jpg"></div><img src="https://malicious.example/banner.png">'''
        self.assertEqual(len(get_pictures(s)),2)
    def test_preserve_manual(self):
        existing={'YUP-123456':{'id':'YUP-123456','title':'Produto editado','price':187.0,'priceLocked':True,'category':'brasileirao','categoryLocked':True,'kind':'fan','image':'/images/meu.jpg','images':['/images/meu.jpg'],'imageOrigin':'upload_local'}}
        cards=album_cards(self.html)
        count,_=integrate_cards(existing,cards)
        self.assertEqual(count,1)
        integrate_photos(existing,cards['123456'],['https://photo.yupoo.com/james66jersey/a/01.jpg'],'Nome novo')
        self.assertEqual(existing['YUP-123456']['price'],187.0)
        self.assertEqual(existing['YUP-123456']['image'],'/images/meu.jpg')
        self.assertEqual(existing['YUP-123456']['category'],'brasileirao')
    def test_popup_not_private(self):
        self.assertFalse(protected_album('<div>请输入访问密码</div><p>Não é necessariamente protegido</p>'))
    def test_ignore_non_album_links(self):
        self.assertFalse(album_cards('<a href="/categories/999">A</a>'))
if __name__=='__main__':unittest.main()
