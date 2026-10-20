#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "STREETBALL — Preparação do importador Yupoo"
echo "Criando ambiente Python isolado..."
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install playwright beautifulsoup4
.venv/bin/python -m playwright install chromium
echo ""
echo "IMPORTADOR INSTALADO. Abra Abrir_Painel_Mac.command e use IMPORTAR TODO O CATÁLOGO + FOTOS."
read -r -p 'Pressione Enter para sair...'
