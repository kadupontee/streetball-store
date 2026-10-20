# Streetball Store — Site + Gerenciador local + GitHub Pages

Leia **[GUIA_PUBLICACAO_GITHUB.md](GUIA_PUBLICACAO_GITHUB.md)** para publicar a vitrine pela primeira vez e conectar o gerenciador do Mac ao repositório.

## Estrutura

- `public/`: arquivos da loja pública (HTML, CSS, JavaScript e catálogo).
- `admin-local/` e `scripts/catalog_server.py`: gerenciador privado local, em `http://127.0.0.1:8000/catalog-manager.html`.
- `.github/workflows/publish-pages.yml`: publica somente a vitrine no GitHub Pages.
- `scripts/publish_catalog.py`: envia as atualizações do catálogo e fotos para a branch `main`.
- `.github/workflows/sync-yupoo.yml`: tentativa de sincronização automática do catálogo público do fornecedor, dependente de acesso e de autorização de imagens.

## Importante

O GitHub Pages não executa a cobrança Pix, pedidos, integrações bancárias ou WhatsApp. Para vender de verdade, é necessário instalar o backend Cloudflare Worker/Asaas e conectá-lo a um domínio compatível. A rotina automática não garante acesso aos álbuns Yupoo, estoque nem licença para reproduzir fotografias.

**Documentação de custos internos:** entregue no ZIP como `DOCUMENTACAO_INTERNA.md`, não destinada ao repositório público. Os arquivos `scripts/costs.json` e `scripts/retail_unit_economics.csv` também estão excluídos do Git via `.gitignore`.
