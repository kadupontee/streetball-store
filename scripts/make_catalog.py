import json, pathlib, re
root=pathlib.Path(__file__).resolve().parents[1]
photos={
'spfc1': 'https://www.afabricadastailandesas.com/cdn/shop/files/CAMISOLASAOPAULOI2627homem_VERSAOJOGADOR_8.jpg?v=1772837258',
'spfc2': 'https://img.favjersey.com/goods-img/So-Paulo-2627-Away-Jersey-S-4XL-238632844-001.jpg',
'brasil1':'https://futbolistastores.com/cdn/shop/files/4DE2AAD8-C547-418C-80FA-F266F9B7F1F6.jpg?v=1777000946&width=1445',
'brasil2':'https://vexor-9436.myshopify.com/cdn/shop/files/0FCBCD1C-0E22-4E8B-8142-5D9B152C2168.jpg?v=1774197068&width=1946',
'real':'https://www.prodirectsport.de/cdn/shop/files/1054071_list.jpg?v=1779904978',
'corinthians':'https://thumblr.uniid.it/product/462654/4df56f477a04.jpg?format=webp&q=75&width=3840',
'warriors':'https://cdn.nba.com/teams/uploads/sites/1610612744/2026/01/Icon-Edition.png',
'brasil94':'https://www.thekitdealer.com/cdn/shop/files/UntitledCatalog0947-Photoroom.png?v=1739555410&width=1080',
'flamengo':'https://cdn.staticyy.com/101013/2026/02/07/8/b/8bb86669efa7d3bb.jpg',
'corinthians2':'https://imgnike-a.akamaihd.net/1920x1920/103996IDA12.jpg'
}
# Nome, grupo, preço-por-tipo, cor principal, detalhes, foto, etiqueta
raw=[
('São Paulo 26/27 I — Jogador','brasileirao','player_puma','#f8f9f9','#da2437','spfc1','JOGADOR'),
('São Paulo 26/27 II — Jogador','brasileirao','player_puma','#c51e2d','#161e1c','spfc2','NOVO'),
('Brasil 2026 I — Torcedor','selecoes','fan','#ebd02c','#22634b','brasil1','COPA 2026'),
('Brasil 2026 II — Jogador','selecoes','player_nike','#0d2253','#2696d3','brasil2','JOGADOR'),
('Real Madrid 26/27 I — Torcedor','europa','fan','#f3f3f1','#a84d74','real','NOVO'),
('Corinthians 26/27 I — Torcedor','brasileirao','fan','#f4f4f2','#1b2124','corinthians','DESTAQUE'),
('Golden State Warriors — Curry 30','nba','nba','#174c9d','#f3d222','warriors','NBA'),
('Brasil 1994 II — Retrô','retro','retro','#12518c','#efefec','brasil94','CLÁSSICO'),
('Flamengo 25/26 I — Torcedor','brasileirao','fan','#c7272e','#1c1b1b','flamengo',''),
('Corinthians 26/27 II — Jogador','brasileirao','player_nike','#1c1d1b','#f4f4f4','corinthians2','JOGADOR'),
('Palmeiras 26/27 I — Torcedor','brasileirao','fan','#176443','#ecf4e1',None,''),
('Santos 26/27 I — Torcedor','brasileirao','fan','#f3f4f1','#151b15',None,'NOVO'),
('Grêmio 26/27 I — Torcedor','brasileirao','fan','#3086b6','#17181d',None,''),
('Internacional 26/27 II — Torcedor','brasileirao','fan','#f0ece5','#c53433',None,''),
('Botafogo 26/27 I — Torcedor','brasileirao','fan','#181b18','#e5e5e2',None,''),
('Bahia 26/27 I — Torcedor','brasileirao','fan','#e6e6ec','#28589b',None,''),
('Vasco 26/27 I — Torcedor','brasileirao','fan','#161a1a','#e5e5e4',None,''),
('Cruzeiro 26/27 I — Torcedor','brasileirao','fan','#194793','#f1f0ea',None,''),
('Palmeiras 26/27 I — Infantil','infantil','kids','#195c43','#f1efea',None,'INFANTIL'),
('São Paulo 26/27 II — Infantil','infantil','kids','#df2731','#14181a',None,''),
('Brasil 2026 I — Infantil','infantil','kids','#e4c92d','#185b49',None,'COPA 2026'),
('Argentina 2026 I — Infantil','infantil','kids','#f4f8fa','#7bb7d7',None,''),
('Barcelona 26/27 I — Torcedor','europa','fan','#803149','#163b79',None,''),
('Manchester City 26/27 I — Torcedor','europa','fan','#83c8e9','#eef0ed',None,'NOVO'),
('Manchester United 26/27 I — Jogador','europa','player_adidas','#ae232d','#16191a',None,'JOGADOR'),
('Arsenal 26/27 II — Torcedor','europa','fan','#1b2b55','#f4efed',None,''),
('Benfica 26/27 I — Torcedor','europa','fan','#c22230','#f0eaea',None,''),
('Juventus 03/04 I — Retrô','retro','retro','#f7f7f7','#181818',None,'CLÁSSICO'),
('Manchester United 98/99 II — Retrô','retro','retro','#fcf4ee','#181a1b',None,'CLÁSSICO'),
('Manchester United 98/99 — Retrô Manga Longa','retro','retro_long','#cf2629','#1b1b1b',None,''),
('Barcelona 03/04 — Retrô','retro','retro','#293c88','#97384b',None,''),
('França 2026 I — Torcedor','selecoes','fan','#253d8e','#c6c1c1',None,''),
('Portugal 2026 I — Torcedor','selecoes','fan','#af2431','#175b3e',None,''),
('Japão 2026 I — Jogador','selecoes','player_adidas','#25529b','#e8e6e4',None,'JOGADOR'),
('Inglaterra 2026 I — Torcedor','selecoes','fan','#e8e9e9','#17265a',None,''),
('Alemanha 2026 I — Torcedor','selecoes','fan','#eceae8','#161718',None,''),
('México 2026 I — Torcedor','selecoes','fan','#217452','#efe8e1',None,''),
('Marrocos 2026 II — Torcedor','selecoes','fan','#f4ece4','#ad1e29',None,''),
('Brasil 2026 I — Feminina','feminino','female','#e5c729','#215c49',None,''),
('Corinthians 26/27 I — Feminina','feminino','female','#f5f4f1','#272827',None,''),
('Flamengo 26/27 II — Feminina','feminino','female','#f4ecea','#c12a2c',None,''),
('Real Madrid 26/27 I — Infantil','infantil','kids','#f2f3f1','#a84474',None,''),
('Santos 26/27 I — Feminina','feminino','female','#f3f3f1','#141b1b',None,''),
('Camiseta de treino Brasil 2026','treino','long','#196438','#e8d52e',None,'TREINO'),
('Conjunto de treino Brasil 2026','treino','set','#232d37','#c8c9c2',None,''),
('Calção Brasil 2026','acessorios','shorts','#214b7f','#e7e9e6',None,''),
('Meião Brasil 2026','acessorios','socks','#f2d334','#1b523e',None,''),
('Regata de basquete Real Madrid','nba','nba','#efefee','#2f5589',None,'BASQUETE'),
('Regata de basquete Barcelona','nba','nba','#243785','#b83b43',None,'BASQUETE'),
]
price_map={'fan':159.90,'player_adidas':209.90,'player_puma':219.90,'player_nike':229.90,'female':159.90,'retro':199.90,'retro_long':229.90,'long':189.90,'kids':179.90,'nba':219.90,'shorts':119.90,'shorts_player':143.90,'socks':59.90,'jacket':379.90,'coat':189.90,'blouse':189.90,'set':299.90}
ret=[]
for idx,(title,category,kind,color,accent,photo,badge) in enumerate(raw,1):
    ret.append({'id':f'SB-{idx:04}', 'title':title,'category':category,'kind':kind,'price':price_map[kind],
                'image':photos.get(photo) if photo else None,
                'imageOrigin':'referencia_externa_temporaria' if photo else 'ilustracao_svg',
                'primary':color,'accent':accent,'badge':badge, 'source':'catalogo_yupoo_indexado',
                'sourceUrl':'https://james66jersey.x.yupoo.com/albums?tab=gallery',
                'sizes':['16','18','20','22','24','26','28'] if kind=='kids' else ['P','M','G','GG','XXL','3XL','4XL'] if kind not in ('socks',) else ['Único'],
                'description':'Modelo referenciado no catálogo do fornecedor. Foto, composição, detalhes, tamanho e disponibilidade devem ser confirmados antes da publicação.'})
(root/'public'/'catalog.json').write_text(json.dumps(ret,ensure_ascii=False,indent=2),encoding='utf-8')
(root/'public'/'catalog.js').write_text('window.STREETBALL_CATALOG = '+json.dumps(ret,ensure_ascii=False,separators=(',',':'))+';',encoding='utf-8')
print('seed count',len(ret),'images references',sum(x['image'] is not None for x in ret))
