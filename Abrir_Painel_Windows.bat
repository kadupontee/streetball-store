@echo off
cd /d "%~dp0"
echo Abrindo o painel Streetball Store... 
echo Acesse: http://127.0.0.1:8000/catalog-manager.html
py -3 scripts\catalog_server.py
if errorlevel 1 python scripts\catalog_server.py
pause
