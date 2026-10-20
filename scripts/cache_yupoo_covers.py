#!/usr/bin/env python3
"""Baixa capas autorizadas do James Jersey para a vitrine (sem hotlink).
Mantem o catalogo editado, valida imagens reais e continua por lotes.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import os
import re
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from PIL import Image, ImageOps, UnidentifiedImageError

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
CATALOG = PUBLIC / "catalog.json"
JS = PUBLIC / "catalog.js"
DEST = PUBLIC / "images" / "yupoo"
REPORT = ROOT / "scripts" / "yupoo_image_probe.json"
FAILURES = ROOT / "scripts" / "yupoo_cover_failures.json"
YUP_PREFIX = "https://photo.yupoo.com/james66jersey/"
MAX_STORED_BYTES = 650_000_000
MAX_DOWNLOAD = 3_000_000


def load_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback


def atomic_write(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(content, encoding="utf-8")
    temp.replace(path)


def safe_cached(p):
    image = str(p.get("image") or "")
    if not re.fullmatch(r"/images/yupoo/[a-zA-Z0-9_-]+\.(?:webp|jpe?g|png)", image):
        return False
    return (PUBLIC / image.lstrip("/")).is_file()


def source_urls(p):
    seen = set()
    for value in [p.get("image"), *(p.get("images") or []), p.get("sourceImageUrl")]:
        if isinstance(value, str) and value.startswith(YUP_PREFIX) and value not in seen:
            seen.add(value)
            yield value


def read_image(url: str, referer: str):
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        "Accept": "image/webp,image/avif,image/jpeg,image/png,image/*",
    }
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=12) as response:
        raw = response.read(MAX_DOWNLOAD + 1)
        mime = response.headers.get("Content-Type", "").lower()
    if len(raw) > MAX_DOWNLOAD:
        raise ValueError("Imagem excede 3 MB")
    if len(raw) < 2000 or not raw.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"RIFF")):
        raise ValueError("Resposta nao e imagem valida: " + mime[:60])
    with Image.open(io.BytesIO(raw)) as original:
        original.load()
        if min(original.size) < 180 or original.width * original.height > 35_000_000:
            raise ValueError("Dimensoes inesperadas")
        im = ImageOps.exif_transpose(original).convert("RGB")
        im.thumbnail((640, 640), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        im.save(out, format="WEBP", quality=73, method=5)
        result = out.getvalue()
        if len(result) < 1500:
            raise ValueError("WebP suspeito")
        return result


def fetch_cover(p):
    msg = []
    for url in list(source_urls(p))[:2]:
        for ref in ("", str(p.get("sourceUrl") or "https://james66jersey.x.yupoo.com/")):
            try:
                data = read_image(url, ref)
                return {"id": p["id"], "image": data, "src": url, "digest": hashlib.sha256(data).hexdigest()}
            except (urllib.error.URLError, TimeoutError, OSError, ValueError, UnidentifiedImageError) as e:
                msg.append(str(e)[:110])
    return {"id": p["id"], "error": "; ".join(msg[-3:]) if msg else "sem capa Yupoo valida"}


def run(limit: int, workers: int):
    now = datetime.now(timezone.utc)
    products = load_json(CATALOG, [])
    if not isinstance(products, list):
        raise ValueError("catalog.json nao contem lista de produtos")
    failed = load_json(FAILURES, {})
    if not isinstance(failed, dict):
        failed = {}
    DEST.mkdir(parents=True, exist_ok=True)
    current_size = sum(p.stat().st_size for p in DEST.glob("*") if p.is_file())
    if current_size > MAX_STORED_BYTES:
        print("LIMITE DE SEGURANCA: imagens locais acima de 650 MB; migre para hospedagem de imagens", flush=True)
        return 2

    eligible = []
    for p in products:
        pid = str(p.get("id") or "")
        if not pid.startswith("YUP-") or safe_cached(p):
            continue
        # Evite rebaixar produtos modificados manualmente.
        if str(p.get("image") or "").startswith("/images/"):
            continue
        if not any(source_urls(p)):
            continue
        error = failed.get(pid)
        if isinstance(error, dict):
            when = error.get("at")
            try:
                if when and now - datetime.fromisoformat(when) < timedelta(hours=18):
                    continue
            except ValueError:
                pass
        eligible.append(p)
        if len(eligible) >= limit:
            break

    print("INICIO: catalogo=", len(products), "candidatos=", len(eligible), "imagens_locais_bytes=", current_size, flush=True)
    completed = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch_cover, p): p for p in eligible}
        for future in as_completed(futures):
            result = future.result()
            completed.append(result)
            if result.get("error"):
                print("FALHA", result["id"], result["error"][:110], flush=True)

    digests = Counter(r["digest"] for r in completed if "digest" in r)
    byid = {p["id"]: p for p in products}
    saved = 0
    errors = []
    added_bytes = 0
    for r in completed:
        pid = r["id"]
        if "error" in r:
            failed[pid] = {"at": now.isoformat(), "reason": r["error"][:250]}
            errors.append({"id": pid, "reason": r["error"][:200]})
            continue
        if digests[r["digest"]] >= 4:
            reason = "Capa identica em 4+ modelos no lote; possivel imagem generica anti-hotlink"
            failed[pid] = {"at": now.isoformat(), "reason": reason}
            errors.append({"id": pid, "reason": reason})
            continue
        p = byid[pid]
        filename = pid.replace("YUP-", "") + ".webp"
        dest = DEST / filename
        raw = r["image"]
        if current_size + added_bytes + len(raw) > MAX_STORED_BYTES:
            print("LIMITE DE SEGURANCA atingido neste lote", flush=True)
            break
        dest.write_bytes(raw)
        added_bytes += len(raw)
        local = "/images/yupoo/" + filename
        p["sourceImageUrl"] = r["src"]
        p["image"] = local
        p["images"] = [local]
        p["imageOrigin"] = "cache_autorizado"
        failed.pop(pid, None)
        saved += 1

    if saved:
        text = json.dumps(products, ensure_ascii=False, indent=2) + "\n"
        atomic_write(CATALOG, text)
        atomic_write(JS, "window.STREETBALL_CATALOG = " + json.dumps(products, ensure_ascii=False, separators=(",", ":")) + ";\n")
    atomic_write(FAILURES, json.dumps(failed, ensure_ascii=False, indent=2) + "\n")
    count_cached = sum(1 for p in products if p.get("id", "").startswith("YUP-") and safe_cached(p))
    report = {
        "testedAt": now.isoformat(),
        "checked": len(eligible),
        "savedLocal": saved,
        "validFiles": sum("image" in r for r in completed),
        "cachedTotal": count_cached,
        "totalYupooProducts": sum(str(p.get("id", "")).startswith("YUP-") for p in products),
        "batchBytes": added_bytes,
        "errors": errors[:30],
        "pendingWithExternal": sum(str(p.get("id", "")).startswith("YUP-") and any(source_urls(p)) and not safe_cached(p) for p in products),
        "failedRetryLater": len(failed),
    }
    atomic_write(REPORT, json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("RESULTADO", json.dumps({k: v for k, v in report.items() if k != "errors"}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--workers", type=int, default=5)
    args = parser.parse_args()
    if not 1 <= args.limit <= 500 or not 1 <= args.workers <= 8:
        parser.error("Limites fora de intervalo seguro")
    raise SystemExit(run(args.limit, args.workers))
