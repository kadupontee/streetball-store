# PUBLICAR A STREETBALL STORE E LIGAR O PAINEL LOCAL AO GITHUB

## 1. Preparar a pasta no Mac

1. Descompacte o ZIP atualizado. Dentro, abra a pasta `streetball-store`.
2. Se já atualizou produtos na versão anterior, copie para a nova pasta os arquivos `public/catalog.json`, `public/catalog.js` e a pasta `public/images` (se existir). Se já iniciou a coleta do Yupoo, preserve também `scripts/yupoo_album_index.json` e `scripts/yupoo_import_checkpoint.json`. Não copie a pasta inteira antiga por cima do novo projeto.
3. Instale e entre no [GitHub Desktop](https://desktop.github.com/) com sua conta GitHub.

## 2. Criar e publicar o repositório

1. No GitHub Desktop, clique **File > Add Local Repository** e selecione a pasta `streetball-store` (a que contém `public`, `scripts` e `.github`).
2. Se ele disser que a pasta não é um repositório, escolha **Create a Repository Here** (ou File > New Repository, usando esta pasta; confirme que ele não criou uma pasta dentro de outra).
3. Escolha a branch `main` (se necessário, Branch > Rename).
4. Faça o primeiro commit (ex.: `Primeira versão Streetball Store`).
5. Clique **Publish repository**. Escolha o nome `streetball-store`, marque **repositório público** (GitHub Pages gratuito normalmente exige público) e publique. Nunca faça upload de `.env` ou tokens de pagamento. Este projeto já ignora `scripts/costs.json`, `scripts/retail_unit_economics.csv` e `DOCUMENTACAO_INTERNA.md` para não expor as informações de custo no repositório público.
6. Verifique no site github.com que `.github/workflows/publish-pages.yml`, `public/index.html` e `public/catalog.json` estão na raiz do repositório nas pastas indicadas.

## 3. Ativar a publicação da loja

1. Abra o repositório no GitHub, vá para **Settings > Pages**.
2. Em **Build and deployment > Source**, selecione **GitHub Actions**.
3. Abra a aba **Actions > Publicar Streetball Store (GitHub Pages)** e, se necessário, **Run workflow**, branch `main`.
4. Após a execução com sucesso, o endereço será `https://SEU_USUARIO.github.io/streetball-store/` (ou `https://SEU_USUARIO.github.io/OUTRO_NOME/`, se escolher outro nome).
5. Teste no site público se os preços, categorias e fotos foram carregados. O projeto foi ajustado para endereços com `/nome-do-repositorio/`.

## 4. Conectar o gerenciamento à loja publicada

- O painel de catálogo roda **somente no Mac**: abra `Abrir_Painel_Mac.command` e acesse `http://127.0.0.1:8000/catalog-manager.html`.
- Altere preços, fotos e produtos; clique em **PUBLICAR ALTERAÇÕES NO GITHUB**.
- O painel cria um commit local e sincroniza por Git (sem guardar senhas). O GitHub Pages publica o catálogo após a rotina de implantação terminar.
- Precisa manter o GitHub Desktop autenticado e a pasta que ele publicou. O botão não edita diretamente o endereço público; ele atualiza arquivos na branch `main`.
- Se a publicação falhar, leia o **Registro da sincronização** no painel, abra o GitHub Desktop e confira autenticação, branch e conflitos. Não use `git push --force`.

## 5. Importação automática de novos produtos

O repositório tem `.github/workflows/sync-yupoo.yml`. Para ativar, no GitHub: **Settings > Secrets and variables > Actions > Variables > New repository variable**. Nome: `JAMES_IMAGES_AUTHORIZED`. Valor: `true` SOMENTE com autorização do fornecedor para reproduzir as imagens no seu site. Ative a rotina na aba Actions. O workflow de publicação também é disparado quando a sincronização termina com êxito, inclusive quando o commit foi feito pelo próprio GitHub Actions.

Pode ser necessário liberar em **Settings > Actions > General > Workflow permissions** a opção `Read and write permissions` para a rotina que salva o catálogo. No GitHub, uma rotina diária pode atrasar ou deixar de rodar quando o provedor alterar suas regras, e o Yupoo pode limitar ou bloquear a consulta. Monitore logs e resultados; não significa que os 11 mil álbuns estarão sempre atualizados.

## LIMITAÇÕES IMPORTANTES

- **GitHub Pages hospeda só arquivos estáticos.** O botão do painel não cria um gerenciador administrativo público nem sincronização ao vivo. O link `127.0.0.1` é acessível apenas no próprio Mac.
- **O checkout Pix, banco de pedidos e automação do WhatsApp não funcionam no GitHub Pages.** Exigem publicar o backend do projeto separadamente, por exemplo Cloudflare Worker, configurar pagamentos e conectar o frontend à API por HTTPS com CORS adequado.
- **Não publique `admin-local` ou uma senha/token no Pages.** O workflow publica apenas `public/`, excluindo `admin.html`.
- **Fotos e dados muito numerosos podem exceder limites do GitHub.** Evite guardar dezenas de milhares de imagens no Git; prefira armazenamento de objetos autorizado (como R2) e catálogo paginado. O site atual carrega todo o catálogo no navegador e precisará de paginação para grandes quantidades.
- **Permissão de imagem e direito de marcas:** obtenha autorização para uso comercial e confirme correspondência exata de cada modelo.
