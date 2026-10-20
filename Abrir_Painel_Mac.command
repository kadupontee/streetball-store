#!/bin/bash
cd "$(dirname "$0")" || exit 1
if [ -x .venv/bin/python ]; then
  PYTHON=.venv/bin/python
else
  PYTHON=python3
fi
echo "Painel Streetball: http://127.0.0.1:8000/catalog-manager.html"
"$PYTHON" scripts/catalog_server.py
