# Streetball Store — Catálogo, cobrança e automação de pedidos

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

## Checkout Pix/cartão + automação dos fornecedores

Foi preparado o backend `worker/index.js`, o envio de pedidos por WhatsApp em `worker/fulfillment.js`, as tabelas `worker/schema.sql` e o checkout da vitrine. **As cobranças reais continuam DESATIVADAS por padrão**, até configurar contas e credenciais, frete e domínio.

Leia o **[guia de implantação do checkout e WhatsApp](worker/SETUP.md)**. Nele estão os passos de Cloudflare D1/Worker, Asaas Sandbox, webhook, templates WhatsApp e cadastro dos até cinco fornecedores. O pagamento ao fornecedor por Pix continua exigindo aprovação explícita; não há robô bancário clicando em links externos.

Teste a base do checkout com `npm test`. O GitHub Pages é somente a vitrine; publique via Cloudflare Worker para receber pedidos reais.
