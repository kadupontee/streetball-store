import io,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from sync_official_images import compare,parse_product_page,sync,trusted_domain,CONFIG_PATH

class OfficialImageTests(unittest.TestCase):
    def setUp(self):self.cfg=json.loads(CONFIG_PATH.read_text());self.items=json.loads((Path(__file__).parent.parent/'public'/'catalog.json').read_text());self.by={x['id']:x for x in self.items}
    def test_confirmed_examples(self):
        good={
            'SB-0003':'Camisa Brasil Nike I 2026/27 Fã Masculina',
            'SB-0004':'Camisa Brasil Jordan II 2026/27 Jogador Masculina',
            'SB-0005':'Camisa I Real Madrid 26/27',
            'SB-0006':'Camisa Corinthians Nike I 2026/27 Fã Masculina',
            'SB-0010':'Camisa Corinthians Nike II 2026/27 Jogador Masculina',
            'SB-0039':'Camisa Brasil Nike I 2026/27 Fã Feminina',
            'SB-0042':'Camisa I Real Madrid 26/27 Infantil',
        }
        for k,title in good.items():
            with self.subTest(k=k):self.assertTrue(compare(self.by[k],title),compare(self.by[k],title))
    def test_wrong_kit_year_team_or_audience(self):
        bad=[('SB-0005','Camisa II Real Madrid 26/27'),('SB-0005','Camisa I Real Madrid 25/26'),('SB-0005','Camisa I Flamengo 26/27'),('SB-0010','Camisa Corinthians Nike I 2026/27 Jogador Masculina'),('SB-0039','Camisa Brasil Nike I 2026/27 Fã Masculina'),('SB-0042','Camisa I Real Madrid 26/27 Masculina')]
        for k,title in bad:
            with self.subTest(k=k,title=title):self.assertFalse(compare(self.by[k],title)[0])
    def test_product_page_extract(self):
        sample='''<html><head><meta property="og:title" content="Camisa I Real Madrid 26/27"><meta property="og:image" content="https://assets.adidas.com.br/image1.jpg"><script type="application/ld+json">{"@type":"Product","name":"Camisa I Real Madrid 26/27","image":["https://assets.adidas.com.br/image2.jpg"]}</script></head></html>'''
        r=parse_product_page(sample,'https://www.adidas.com.br/camisa-i-real-madrid-26-27/JZ7206.html');self.assertEqual(len(r['images']),2)
    def test_no_rights_no_publication(self):
        cfg=dict(self.cfg);cfg['sources']=[x for x in cfg['sources'] if x['product_id']=='SB-0005'];product=[dict(self.by['SB-0005'])]
        html='''<meta property="og:title" content="Camisa I Real Madrid 26/27"><meta property="og:image" content="https://assets.adidas.com.br/kit26.jpg">'''
        rows,changed=sync(product,cfg,fetch=lambda url:html,publish=True,authorized=(),limit=1,pause=0)
        self.assertEqual(changed,0);self.assertEqual(product[0].get('image'),'');self.assertEqual(len(rows[0]['sources']),1)
        self.assertEqual(rows[0]['status'],'pendente_de_licenca')
    def test_rights_enabled_only_if_exact(self):
        cfg=dict(self.cfg);cfg['sources']=[x for x in cfg['sources'] if x['product_id']=='SB-0005'];product=[dict(self.by['SB-0005'])];original=product[0]['price']
        html='''<meta property="og:title" content="Camisa I Real Madrid 26/27"><meta property="og:image" content="https://assets.adidas.com.br/kit26.jpg">'''
        rows,changed=sync(product,cfg,fetch=lambda url:html,publish=True,authorized=('adidas.com.br',),approved_ids=('SB-0005',),limit=1,pause=0)
        self.assertEqual(changed,1);self.assertEqual(product[0]['price'],original)
    def test_domain_guard(self):
        self.assertFalse(trusted_domain('https://nike.com.br.evil.org/kit.jpg',self.cfg['trusted_domains']))
        self.assertTrue(trusted_domain('https://www.nike.com.br/test',self.cfg['trusted_domains']))
if __name__=='__main__':unittest.main()
