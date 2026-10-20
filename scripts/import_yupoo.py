#!/usr/bin/env python3
"""Importador gradual do catálogo público James Jersey.

Fases:
  1. Varre as páginas públicas de /categories, registra cada álbum e a capa
     somente se ela estiver vinculada ao próprio álbum.
  2. Visita os álbuns registrados e coleta todas as fotos públicas.

Checkpoint é persistente; pode parar e continuar sem duplicar produtos.
Não acessa conteúdo protegido, não contorna CAPTCHA/limites e não valida estoque.
Use fotos na loja somente com autorização de reprodução comercial.
"""
from __future__ import annotations
import argparse, asyncio, json, re, sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from bs4 import BeautifulSoup
from catalog_utils import ROOT, PRICES, classify, normalize_product, is_yupoo_album_url, valid_image_url, read_catalog, save_catalog

BASE = 'https://james66jersey.x.yupoo.com'
CHECKPOINT = ROOT / 'scripts' / 'yupoo_import_checkpoint.json'
INDEX = ROOT / 'scripts' / 'yupoo_album_index.json'
MAX_PUBLIC_PAGES = 94  # número observado em 20/10/2026; pode aumentar no fornecedor


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    tmp.replace(path)


def checkpoint_load():
    try: state = json.loads(CHECKPOINT.read_text(encoding='utf-8'))
    except (OSError, ValueError): return {'photosDone': [], 'pagesIndexed': [], 'protected': [], 'errors': {}}
    if isinstance(state, list):  # compatibilidade com versões anteriores
        return {'photosDone': state, 'pagesIndexed': [], 'protected': [], 'errors': {}}
    if not isinstance(state, dict): return {'photosDone': [], 'pagesIndexed': [], 'protected': [], 'errors': {}}
    return {**{'photosDone': [], 'pagesIndexed': [], 'protected': [], 'errors': {}}, **state}


def image_url(raw):
    if not isinstance(raw, str) or not raw: return ''
    raw = raw.strip()
    if raw.startswith('//'): raw = 'https:' + raw
    elif raw.startswith('/'): raw = urljoin(BASE, raw)
    if raw.startswith('http:'): raw = 'https:' + raw[5:]
    if not valid_image_url(raw): return ''
    host = (urlsplit(raw).hostname or '').lower()
    return raw if host == 'photo.yupoo.com' or host.endswith('.yupoo.com') else ''


def valid_photo(raw):
    u = image_url(raw)
    return u if u and not any(x in u.lower() for x in ('avatar', 'logo', 'qrcode', '/assets/', '/static/')) else ''


def get_pictures(html):
    soup = BeautifulSoup(html, 'html.parser')
    # Imagens dentro do álbum: não incluir sugestões, QR codes ou avatares.
    candidates = soup.select('.showalbum__children img[data-origin-src], .showalbum__children img[data-src], .image__main img[data-origin-src], .image__main img[data-src], img[data-album-id][data-origin-src], img[data-album-id][data-src]')
    if not candidates:
        candidates = soup.select('[class*="showalbum__photo"] img, [class*="album-photo"] img')
    urls = []
    for img in candidates:
        for attr in ('data-origin-src', 'data-original', 'data-src', 'src'):
            url = valid_photo(img.get(attr))
            if url:
                if url not in urls: urls.append(url)
                break
    # OG image: capa conhecida, mas não é substituto para a galeria completa.
    if not urls:
        meta = soup.select_one('meta[property="og:image"]')
        url = valid_photo(meta.get('content') if meta else '')
        if url: urls.append(url)
    return urls[:200]


def album_cards(html):
    """Extrai apenas links exatos de álbum, título e capa se vinculada ao cartão.

    Retorno: dict[album_id] = {id,title,url,cover}; um álbum nunca é
    identificado apenas pelo nome, porque o Yupoo tem títulos repetidos.
    """
    soup = BeautifulSoup(html, 'html.parser')
    cards = {}
    for a in soup.select('a[href*="/albums/"]'):
        url = urljoin(BASE, a.get('href') or '').split('?')[0].rstrip('/')
        if not is_yupoo_album_url(url): continue
        aid = url.rsplit('/', 1)[-1]
        node = a
        candidates = [a]
        # Descubra o cartão sem invadir contêineres de várias fotos.
        for _ in range(3):
            parent = node.parent
            if not parent or not getattr(parent, 'name', None): break
            siblings = parent.select('a[href*="/albums/"]')
            unique = {urljoin(BASE, x.get('href', '')).split('?')[0].rstrip('/') for x in siblings}
            if len(unique) != 1 or url not in unique: break
            candidates.append(parent)
            node = parent
        title = ''
        for scope in candidates:
            n = scope.select_one('.album__name, .album__title, .album__info-title, [class*="album__name"], [class*="album__title"]')
            if n:
                title = n.get_text(' ', strip=True)
                if len(title) > 3: break
        if len(title) < 4:
            for scope in candidates:
                val = scope.get_text(' ', strip=True)
                if 4 <= len(val) <= 220:
                    title = val; break
        if len(title) < 4:
            img = a.select_one('img[alt],img[title]')
            if img: title = img.get('alt') or img.get('title') or ''
        title = re.sub(r'^\s*\d+\s+', '', ' '.join(title.split())).strip()[:170]
        if len(title) < 3: title = 'Produto do álbum ' + aid
        cover = ''
        for scope in candidates:
            img = scope.select_one('img[data-origin-src],img[data-src],img[src]')
            if not img: continue
            for key in ('data-origin-src', 'data-src', 'src'):
                cover = valid_photo(img.get(key))
                if cover: break
            if cover: break
        # Quando há vários links para um álbum, prefira o cartão com descrição/foto.
        other = cards.get(aid)
        if not other or (other['title'].startswith('Produto do álbum') and not title.startswith('Produto do álbum')) or (not other['cover'] and cover):
            cards[aid] = {'id': aid, 'title': title, 'url': url, 'cover': cover}
    return cards


def get_links(html):
    """Compatibilidade com versão anterior."""
    return [(aid, (row['title'], row['url'])) for aid, row in album_cards(html).items()]


def page_title(html, fallback):
    soup = BeautifulSoup(html, 'html.parser')
    for selector in ('.showalbum__title', 'h1', 'meta[property="og:title"]'):
        node = soup.select_one(selector)
        if node:
            title = node.get('content', '') if node.name == 'meta' else node.get_text(' ', strip=True)
            title = ' '.join(title.split()).strip()
            if 4 <= len(title) < 170 and not title.lower().startswith('james jersey'):
                return re.sub(r'\s+\d+$', '', title)
    return fallback


def protected_album(html):
    """Confirma proteção apenas por marcador explícito, não por modal genérico.

    O Yupoo insere textos de "informe a senha" no HTML de páginas públicas.
    Marcar todos esses casos como privados perderia milhares de produtos.
    """
    if get_pictures(html): return False
    return bool(re.search(r'(?:"isEncrypted"\s*:\s*true|"isPasswordProtected"\s*:\s*true|data-album-locked\s*=\s*["\']true|<body[^>]*class=["\'][^"\']*password-only)', html, re.IGNORECASE))


def integrate_cards(by_id, new_cards):
    added = changed = 0
    for card in new_cards.values():
        pid = 'YUP-' + card['id']
        old = by_id.get(pid)
        if old:
            # Não sobrescreve preço, categoria, edição manual ou fotos existentes.
            patch = {'sourceUrl': card['url'], 'source': 'import_yupoo_publico'}
            if not old.get('images') and card['cover']:
                patch.update(image=card['cover'], images=[card['cover']], imageOrigin='fornecedor_yupoo')
            if old['title'].startswith('Produto do álbum') and not card['title'].startswith('Produto do álbum'):
                patch['title'] = card['title']
            by_id[pid] = {**old, **patch}
            changed += 1
            continue
        cat, kind = classify(card['title'])
        raw = {'id': pid, 'title': card['title'], 'sourceUrl': card['url'], 'category': cat,
               'kind': kind, 'price': PRICES[kind], 'image': card['cover'],
               'images': [card['cover']] if card['cover'] else [], 'source':'import_yupoo_publico',
               'importStatus':'capa_catalogo' if card['cover'] else 'aguardando_fotos',
               'description': 'Produto importado do catálogo do fornecedor. Fotos, tamanho e disponibilidade sujeitos à confirmação.'}
        by_id[pid] = normalize_product(raw)
        added += 1
    return added, changed


def integrate_photos(by_id, card, images, title):
    pid = 'YUP-' + card['id']
    cat, kind = classify(title)
    raw = {'id': pid, 'title': title, 'sourceUrl': card['url'], 'category': cat,
           'kind': kind, 'price': PRICES[kind], 'image': images[0], 'images': images,
           'source': 'import_yupoo_publico', 'importStatus':'fotos_catalogadas',
           'description': 'Modelo sob encomenda. Tamanhos, variantes e disponibilidade devem ser confirmados.'}
    normalized = normalize_product(raw)
    if old := by_id.get(pid):
        if old.get('priceLocked'): normalized['price'] = old['price']; normalized['priceLocked'] = True
        if old.get('categoryLocked'): normalized['category'] = old['category']; normalized['categoryLocked'] = True
        if old.get('imageOrigin') in ('upload_local', 'cache_autorizado') and old.get('images'):
            normalized['images'] = old['images']; normalized['image'] = old['image']; normalized['imageOrigin'] = old['imageOrigin']
            if old.get('sourceImageUrl'):
                normalized['sourceImageUrl'] = old['sourceImageUrl']
        by_id[pid] = {**old, **normalized}
        return False
    by_id[pid] = normalized
    return True


async def main(args):
    from playwright.async_api import async_playwright
    by_id = {p['id']: p for p in read_catalog()}
    state = checkpoint_load()
    done = set(state.get('photosDone') or [])
    protected = set(state.get('protected') or [])
    pages_done = set(state.get('pagesIndexed') or [])
    errors = state.get('errors') or {}
    try: index = json.loads(INDEX.read_text(encoding='utf-8'))
    except (OSError, ValueError): index = {}
    if not isinstance(index, dict): index = {}
    seen_count = new_count = photo_count = 0
    fail_count = 0

    def save_state():
        save_catalog(list(by_id.values()))
        atomic_json(INDEX, index)
        atomic_json(CHECKPOINT, {'photosDone': sorted(done), 'protected': sorted(protected),
                                 'pagesIndexed': sorted(pages_done), 'errors': errors,
                                 'updatedAt':datetime.now(timezone.utc).isoformat(),
                                 'indexCount':len(index), 'photosComplete':len(done)})

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=not args.show_browser)
        ctx = await browser.new_context(locale='en-US', user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36')
        page = await ctx.new_page()
        page.set_default_timeout(25000)

        async def load_page(url):
            response = await page.goto(url, wait_until='domcontentloaded', timeout=40000)
            status = response.status if response else 0
            if status in (401, 403, 429, 503): raise RuntimeError(f'Acesso limitado HTTP {status}; encerrando sem contornar bloqueio')
            if status >= 400 or not response: raise RuntimeError(f'HTTP {status} ao consultar {url}')
            # O Yupoo pode renderizar os cartões depois do evento DOMContentLoaded.
            if '/categories?' in url:
                try: await page.wait_for_selector('a[href*="/albums/"]',timeout=9000)
                except Exception: pass
            await page.wait_for_timeout(args.wait_ms)
            return await page.content()

        try:
            if args.album_url:
                for url in args.album_url:
                    url = url.split('?')[0].rstrip('/')
                    if not is_yupoo_album_url(url): raise ValueError('Álbum inválido: '+url)
                    aid = url.rsplit('/', 1)[-1]
                    index[aid] = index.get(aid) or {'id': aid, 'title': 'Produto do álbum '+aid, 'url': url, 'cover': ''}
            else:
                print(f'ETAPA 1/2 — INDEXAR ÁLBUNS (páginas {args.start_page} a {args.max_pages})', flush=True)
                for pno in range(args.start_page, args.max_pages + 1):
                    if str(pno) in pages_done and not args.refresh_index: continue
                    url = f'{BASE}/categories?page={pno}'
                    print(f'LISTAGEM {pno}/{args.max_pages}: {url}', flush=True)
                    try:
                        html = await load_page(url)
                        found = album_cards(html)
                        if not found:
                            print('SEM ÁLBUNS: página sem itens ou estrutura alterada; confira acesso pelo navegador.', flush=True)
                            fail_count += 1
                            break
                        index.update(found)
                        # Indexar sem publicar capas quando a autorização não foi confirmada.
                        added = 0
                        if not args.stage_only:
                            added, _ = integrate_cards(by_id, found)
                        new_count += added; seen_count += len(found)
                        pages_done.add(str(pno))
                        print(f'INDEXADOS NA PÁGINA {pno}: {len(found)} álbuns, {added} novos, total {len(index)}',flush=True)
                        save_state()  # checkpoint por página: interrupções não perdem progresso
                    except Exception as exc:
                        print('ERRO DE LISTAGEM: '+str(exc)[:250], flush=True)
                        fail_count += 1
                        break  # Evita assumir que o catálogo foi completamente importado
                    await asyncio.sleep(max(0.2, args.pause))

            if args.index_only:
                print(f'FINAL — INDEXADOS={len(index)}, novos={new_count}, completos_fotos={len(done)}, catálogo={len(by_id)}', flush=True)
                return 1 if fail_count else 0

            print(f'ETAPA 2/2 — FOTOS de álbuns públicos; encontrados={len(index)}; completos={len(done)}', flush=True)
            scanned = 0
            # Ordem de indexação por página; não repetir álbuns já processados.
            for aid, card in list(index.items()):
                if aid in done and not args.refresh: continue
                if aid in protected: continue
                previous_error = errors.get(aid)
                if previous_error and not args.refresh:
                    # Erros não ocupam eternamente o lote diário: aguardar 3 dias.
                    retry_at = previous_error.get('at') if isinstance(previous_error,dict) else None
                    if retry_at:
                        try:
                            if datetime.now(timezone.utc) - datetime.fromisoformat(retry_at) < timedelta(days=3): continue
                        except ValueError: pass
                if args.max_albums and scanned >= args.max_albums: break
                scanned += 1
                title = card['title']; url = card['url']
                try:
                    html = await load_page(url)
                    for _ in range(args.scroll_steps):
                        await page.evaluate('window.scrollBy(0, Math.max(500, window.innerHeight * 1.3))')
                        await page.wait_for_timeout(180)
                    if args.scroll_steps: html = await page.content()
                    images = get_pictures(html)
                    if not images:
                        if protected_album(html):
                            protected.add(aid)
                            print(f'ÁLBUM PROTEGIDO {aid}: ignorado sem solicitar senha',flush=True)
                        else:
                            errors[aid] = {'message':'Sem fotos públicas extraíveis','at':datetime.now(timezone.utc).isoformat()}
                            print(f'SEM FOTO {aid}: {title}',flush=True)
                    else:
                        title = page_title(html,title)
                        created = integrate_photos(by_id, card, images, title)
                        done.add(aid)
                        errors.pop(aid,None)
                        photo_count += 1
                        print(f'FOTOS {photo_count} / {scanned}: {aid} {title} ({len(images)} imagens)',flush=True)
                except Exception as exc:
                    errors[aid] = {'message':str(exc)[:140], 'at':datetime.now(timezone.utc).isoformat()}
                    print(f'ERRO ÁLBUM {aid}: {str(exc)[:180]}',flush=True)
                    fail_count += 1
                    if any(t in str(exc) for t in ('HTTP 429', 'HTTP 403', 'HTTP 503', 'HTTP 401')):
                        print('INTERROMPIDO: fornecedor limitou acesso; será possível continuar depois.',flush=True)
                        break
                if scanned % 25 == 0: save_state()
                await asyncio.sleep(max(args.pause,0.2))
        finally:
            save_state()
            await browser.close()

    print(f'FINAL: catalogados={len(by_id)}, álbuns_no_índice={len(index)}, fotos_completas={len(done)}, fotos_nesta_execução={photo_count}, protegidos={len(protected)}, pendentes={len(index)-len(done)-len(protected)}, erros={fail_count}',flush=True)
    return 1 if fail_count and not photo_count and not seen_count else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Importação incremental de TODOS os álbuns públicos do James Jersey')
    parser.add_argument('--max-pages', type=int, default=2, help='Última página de /categories; usar 94 para catálogo completo')
    parser.add_argument('--start-page', type=int, default=1)
    parser.add_argument('--max-albums', type=int, default=30, help='Álbuns a processar fotos nesta execução; 0 = todos os pendentes')
    parser.add_argument('--index-only', action='store_true', help='Indexa todos os álbuns e capas, sem entrar nas galerias')
    parser.add_argument('--stage-only', action='store_true', help='Registra álbuns sem publicar os produtos ou fotos na vitrine')
    parser.add_argument('--refresh-index', action='store_true', help='Revisita as páginas já indexadas para captar novidades')
    parser.add_argument('--photos-per-album', type=int, default=0, help='Compatibilidade; agora coleta todas as fotos disponíveis até 200')
    parser.add_argument('--pause', type=float, default=1.2)
    parser.add_argument('--wait-ms', type=int, default=850)
    parser.add_argument('--scroll-steps', type=int, default=3)
    parser.add_argument('--album-url', action='append')
    parser.add_argument('--refresh', action='store_true', help='Revisita galerias importadas, mantendo preços bloqueados')
    parser.add_argument('--show-browser', action='store_true')
    options = parser.parse_args()
    if not (1 <= options.start_page <= options.max_pages <= 200):parser.error('Páginas inválidas')
    if not 0 <= options.max_albums <= 100000: parser.error('Limite inválido')
    if options.stage_only and not options.index_only: parser.error('--stage-only exige --index-only')
    try: sys.exit(asyncio.run(main(options)))
    except (ValueError,KeyboardInterrupt) as exc:
        print('ERRO:',str(exc),file=sys.stderr);sys.exit(1)
