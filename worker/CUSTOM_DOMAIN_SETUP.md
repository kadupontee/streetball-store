# Ativar lojastreetball.com.br

O código está preparado para `lojastreetball.com.br` e `www.lojastreetball.com.br` no Worker existente `streetball-store`. O endereço `streetball-store.kpgmer.workers.dev` continua habilitado. O banco `streetball-db` e as credenciais existentes são reutilizados.

## 1. DNS e Cloudflare

1. Na mesma conta Cloudflare que contém o Worker, adicione o domínio `lojastreetball.com.br` como zona e escolha o plano Free, se disponível para a conta.
2. Copie os dois nameservers atribuídos pelo Cloudflare. Não use servidores de outro domínio nem um IP obtido de `workers.dev`.
3. No Registro.br, abra `lojastreetball.com.br` → DNS → Alterar servidores DNS. Informe exatamente os nameservers atribuídos pelo Cloudflare. Se já existirem registros de e-mail ou outros serviços, copie-os para a zona antes da troca. Se DNSSEC já estiver ativo no Registro.br, siga a orientação do Cloudflare para migrar a assinatura antes da troca.
4. Aguarde a zona aparecer como **Active** no Cloudflare.

## 2. Publicar o código

No Terminal do Mac, dentro do repositório `streetball-store`, com o Wrangler autenticado na conta existente:

```bash
git pull --ff-only origin main
npx wrangler deploy --keep-vars --var STORE_PUBLIC_URL:https://lojastreetball.com.br
```

Se o Git informar alterações locais, pare e preserve essas alterações antes de atualizar; não use `reset --hard`. `--keep-vars` preserva as variáveis configuradas no painel; `--var STORE_PUBLIC_URL:...` atualiza explicitamente a URL pública usada em novos links de pedidos e fotos. O deploy usa os dois `custom_domain` de `wrangler.toml` para conectar os nomes ao Worker. Se houver conflito com DNS já existente para os mesmos nomes, confira o registro apontado pelo Cloudflare antes de substituí-lo.

Não é necessário criar outro Worker, outro banco ou novas credenciais de pagamento. Os webhooks existentes no endereço `workers.dev` continuam disponíveis.

## 3. Login Google

No projeto Google Cloud **Streetball Store**, edite o cliente OAuth Web existente e acrescente em **Authorized JavaScript origins**:

```text
https://lojastreetball.com.br
https://www.lojastreetball.com.br
```

Mantenha também `https://streetball-store.kpgmer.workers.dev`. Não inclua `/account.html` nem barra no final. O fluxo usa popup/callback JavaScript; não exige novo redirect URI nem novo Client ID.

Em **Google Auth Platform → Branding**, ajuste a página inicial para `https://lojastreetball.com.br/` e cadastre `lojastreetball.com.br` em **Authorized domains**, se solicitado. Não invente links de política/termos: use somente páginas publicadas. Se o Google solicitar comprovação da propriedade, adicione a propriedade de domínio no Search Console e publique no DNS do Cloudflare o TXT fornecido pelo Google.

Veja [GOOGLE_SIGN_IN_SETUP.md](GOOGLE_SIGN_IN_SETUP.md) para a integração. O valor `GOOGLE_CLIENT_ID` existente continua sendo o mesmo; não envie client secret.

## 4. Conferir

- Abrir a página inicial e `/account.html` com HTTPS no domínio novo e com `www`.
- Consultar `/api/health` e `/api/account/google/config`; esta última deve retornar `enabled: true` quando o Client ID estiver configurado.
- Entrar com uma conta Google autorizada e conferir `/api/account/me` e a lista de pedidos.
- No novo domínio, é necessário entrar novamente: cookies do endereço `workers.dev` não são transferidos entre domínios. As contas continuam no mesmo D1.
- A caixa `contato@lojastreetball.com.br` não é criada pela configuração do domínio. O rodapé mantém o aviso de endereço ilustrativo até o serviço de e-mail ser configurado.

Referências: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
