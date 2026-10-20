# Streetball Store — como atualizar o catálogo sem editar código

## Método 1: atualizar pelo painel local (mais simples)

1. Extraia todo o conteúdo do ZIP, mantendo as pastas.
2. Instale **Python 3.10 ou superior** no computador.
3. Dentro da pasta `streetball-store`, abra um terminal e execute:

```bash
python scripts/catalog_server.py
```

4. Abra `http://127.0.0.1:8000/catalog-manager.html` no navegador do **mesmo computador**.
5. Use as ações do painel:
   - **Novo produto**: adicione nome, categoria, preço, tamanhos, imagens e link do álbum.
   - **Editar**: atualize uma camisa existente; preço e categoria escolhidos manualmente ficam bloqueados contra sobrescrita automática.
   - **Enviar fotos**: selecione uma ou mais fotos baixadas de forma autorizada do fornecedor. Elas são salvas em `public/images/`.
   - **Importar CSV/JSON**: adicione dezenas ou centenas de produtos em um único arquivo.
   - **Sincronizar Yupoo**: busca títulos e fotos de álbuns públicos do fornecedor quando o acesso permite.

**Importante:** o gerenciador só funciona no computador que executa o servidor. As alterações ficam nos arquivos `public/catalog.json`, `public/catalog.js` e `public/images`. Para atualizar a loja **já publicada**, envie esses arquivos para a hospedagem ou suba as alterações no repositório conectado ao deploy. O painel local não publica as alterações sozinho.

## Método 2: importar URLs ou páginas do Yupoo automaticamente

O painel usa Playwright para ler páginas públicas. Prepare uma vez:

```bash
pip install playwright beautifulsoup4
python -m playwright install chromium
```

No painel, cole URLs como `https://james66jersey.x.yupoo.com/albums/233970756` **uma por linha** e clique em **Sincronizar agora**. Não é necessário fornecer ID de produto; o script o obtém do endereço.

Se não colar links, ele tenta ler páginas de listagem em ordem, 30 álbuns por execução por padrão. Use o checkbox **Atualizar fotos de álbuns já importados** para revisar os itens anteriores. A importação **não acessa** álbuns privados, não contorna senha, captcha, restrições ou bloqueios.

A galeria do produto usa as imagens encontradas no álbum. **Todas as fotos públicas identificadas de um álbum** são incluídas (até 200 fotos por item na normalização), em vez de apenas a capa. O resultado depende do HTML que o fornecedor disponibiliza, da validação de URL e da possibilidade de carregamento da imagem no navegador. Fotografias externas são exibidas por URL: se o serviço bloquear hotlink, elas poderão falhar; nesse caso peça um export de imagens com autorização e use o upload no painel.

## Método 3: atualização diária via GitHub Actions

O arquivo `.github/workflows/sync-yupoo.yml` está incluído no projeto.

1. Publique a pasta `streetball-store` **como conteúdo de um repositório GitHub**; `.github` precisa estar na raiz do repositório.
2. Solicite autorização expressa ao fornecedor para utilizar imagens em loja comercial.
3. No GitHub vá a **Settings > Secrets and variables > Actions > Variables** e adicione `JAMES_IMAGES_AUTHORIZED` com valor `true` somente após a autorização.
4. Em **Actions > Sincronizar catálogo Yupoo**, clique em **Run workflow** para testar manualmente, começando com 1 página e 5 a 10 álbuns.
5. Após validar, o GitHub tenta executar a atualização **todos os dias às 09h15 (horário de Brasília)**; pode haver atraso. A atualização comita `catalog.json` e `catalog.js` quando detectar novidades. Configure seu deploy para recompilar ou republicar a cada commit no branch principal.

Esse fluxo depende de GitHub Actions habilitado, permissões de escrita para Actions, Playwright, acesso ao Yupoo e políticas do fornecedor. GitHub Actions tem limites de execução; **não há garantia de sincronização completa dos milhares de álbuns**. Para um catálogo muito grande é melhor obter do fornecedor export de produto e usar CSV/JSON, além de armazenamento de imagens próprio (com licença apropriada).

## Arquivos CSV aceitos

| title | category | kind | price | image | images | sourceUrl | sizes |
|---|---|---|---:|---|---|---|---|
| São Paulo 2026 I | brasileirao | fan | 159.90 | `https://.../foto.jpg` | `https://.../foto1.jpg\|https://.../foto2.jpg` | `https://james66jersey.x.yupoo.com/albums/123456` | `P,M,G,GG` |

Separe colunas por ponto e vírgula (`;`) no CSV brasileiro. Use `images` com URLs separadas por `|`. Em arquivos CSV com separador vírgula, coloque campos com vírgulas entre aspas. O link da origem deve ser do domínio James Jersey. O preço é em reais, sem o símbolo R$. O CSV também aceita categorias `europa`, `selecoes`, `retro`, `infantil`, `feminino`, `nba`, `treino`, `acessorios` e `outras`.

## Notas relevantes

- **As fotos existentes na versão inicial que vinham de outros sites foram removidas**, para evitar associar uma imagem errada ao nome de um modelo. Elas foram substituídas por uma ilustração claramente genérica até a confirmação da foto correta.
- Os 49 itens iniciais são **modelos de exemplo**; o Yupoo não foi acessível para verificação ou importação nesta execução. Não representam estoque verificado.
- Não use fotos ou logotipos sem a permissão correspondente, nem anuncie produtos não oficiais como licenciados/originais.
- O painel de catálogo **nunca deve ser publicado** como servidor HTTP de produção. Ele só abre em 127.0.0.1; os arquivos HTML/JS do gerenciador estão fora da pasta `public`.
- Pagamento automático ao fornecedor pelo WhatsApp/Pix **não está implementado**. A confirmação e o acompanhamento devem permanecer manuais até existir integração financeira e mensageria autorizadas.
