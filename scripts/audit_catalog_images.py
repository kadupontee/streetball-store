#!/usr/bin/env python3
"""Auditoria de fotos: nao confunde URL cadastrada com arquivo validado."""
from __future__ import annotations
import json, re, sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "public/catalog.json"
INDEX = ROOT / "scripts/yupoo_album_index.json"
REPORT = ROOT / "public/catalog-image-audit.json"

def local_ok(path):
    if not isinstance(path, str) or not re.fullmatch(r"/images/[a-zA-Z0-9_./-]+", path) or ".." in path:
        return False
    dest = (ROOT / "public" / path.lstrip("/"))
    if not dest.is_file() or dest.stat().st_size < 1500:
        return False
    with dest.open("rb") as file:
        signature = file.read(12)
    return signature.startswith(b"\xff\xd8\xff") or signature.startswith(b"\x89PNG\r\n\x1a\n") or (signature.startswith(b"RIFF") and signature[8:12] == b"WEBP")

def remote_ok(url):
    try:
        parsed = urlparse(url)
        return parsed.scheme == "https" and parsed.hostname == "photo.yupoo.com" and parsed.path.startswith("/james66jersey/")
    except (TypeError, ValueError):
        return False

def main():
    products = json.loads(CATALOG.read_text(encoding="utf-8"))
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    categories = Counter()
    missing_ids = []
    remote_ids = []
    for p in products:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id", ""))
        if p.get("kind") == "nba" or p.get("category") == "nba":
            categories["nbaExcluded"] += 1
            continue
        categories["catalogProducts"] += 1
        if pid.startswith("YUP-"):
            categories["supplierAlbumsInCatalog"] += 1
        sources = [p.get("image"), *(p.get("images") or []), p.get("sourceImageUrl")]
        if pid.startswith("YUP-"):
            sources.append((index.get(pid[4:]) or {}).get("cover"))
        if any(local_ok(s) for s in sources):
            categories["localFilesValidated"] += 1
        elif any(remote_ok(s) for s in sources):
            categories["remoteLinkNotValidatedInBrowser"] += 1
            remote_ids.append(pid)
        else:
            categories["missingAnyUsableSource"] += 1
            missing_ids.append(pid)
    categories["supplierAlbumsIndexed"] = len(index)
    categories["withSource"] = categories["localFilesValidated"] + categories["remoteLinkNotValidatedInBrowser"]
    report = {
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        **dict(categories),
        "missingIds": missing_ids,
        "remoteExamples": remote_ids[:20],
        "method": "Local: arquivo existente e assinatura JPEG/PNG/WebP. Remoto: URL valida, sem teste de acesso do navegador. Fotos do fornecedor so sao validadas ao baixar e conferir o arquivo.",
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
