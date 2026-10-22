# Login e conexão com Conta do Google — Streetball Store

Integração preparada com **Google Identity Services (GIS)** para navegadores. O login só aparece depois que `GOOGLE_CLIENT_ID` for definido na Cloudflare. Não usamos senha do Google, nem pedimos acesso ao Gmail/Drive. A resposta é um ID token com escopo básico de autenticação.

## Configurar no Google Cloud (feito pelo proprietário)

1. Acesse https://console.cloud.google.com/apis/credentials e crie ou selecione um projeto.
2. Configure a tela de consentimento/branding para os usuários que poderão acessar o site e complete as informações que o Google solicitar.
3. Crie um **OAuth 2.0 Client ID**, tipo **Web application**.
4. Em **Authorized JavaScript origins**, adicione exatamente:
   `https://streetball-store.kpgmer.workers.dev`
   Se mais tarde utilizar `streetballstore.com.br` ou outro domínio próprio, inclua esse domínio **somente depois que estiver ativo**, com HTTPS.
5. Para o botão em modo popup/callback JavaScript não é necessária uma nova URL de redirecionamento.
6. Copie apenas o **Client ID** (termina com `.apps.googleusercontent.com`), nunca compartilhe client secrets. Este fluxo não exige client secret.

No Terminal, depois de puxar a atualização:

```bash
cd ~/Downloads/streetball-store
git pull --ff-only
npx wrangler d1 export streetball-db --remote --output=../streetball-backup-google.sql
npx wrangler d1 execute streetball-db --remote --file=worker/schema.sql
npx wrangler secret put GOOGLE_CLIENT_ID
npm test
npx wrangler deploy
```

No comando `wrangler secret put`, cole o **Client ID** obtido no Google Cloud; não é uma senha. O fluxo só liga se houver Client ID válido e a Cloudflare estiver configurada. O backup mantém os pedidos/fornecedores atuais.

## Como funciona

- Na tela `/account.html`, o visitante poderá clicar **Continuar com Google**. A biblioteca GIS retorna um ID token ao navegador, que é enviado ao Worker pelo mesmo domínio.
- O Worker confere criptograficamente a assinatura RS256 usando as chaves públicas oficiais Google JWKS e exige `iss`, `aud` exatamente igual ao Client ID, `exp`, `iat`, e-mail verificado, `sub` único e `nonce` de 32 bytes gerado por visita com cookie `HttpOnly; Secure; SameSite=Lax` válido por até 10 minutos.
- O ID token não é guardado no banco. O banco guarda o identificador estável Google `sub` em `customer_google_identities`, uma conta Google por cliente, e a conta recebe uma sessão Streetball de 7 dias com cookie `HttpOnly`.
- Se o e-mail Google já tiver conta Streetball com senha, **não vinculamos por coincidência de e-mail**. O proprietário entra primeiro com a senha da Streetball e clica em **Conectar Google** na área da conta, usando o mesmo e-mail.
- Um novo e-mail Google cria uma conta Streetball autenticada via Google, sem senha reutilizável para login comum.
- O rastreamento e os pedidos permanecem protegidos pela posse da sessão e do vínculo explícito; o login com Google sozinho **não recupera automaticamente compras antigas sem vínculo**.

## Antes de liberar o login para público maior

- Testar com conta Google sua e outra conta autorizada, incluindo teste de origem inválida, token expirado e tentativa de vincular e-mail diferente.
- Conferir o funcionamento do Google no Safari/iPhone e no Chrome Android; janelas popup e configurações de privacidade podem influenciar a experiência.
- Implementar política de privacidade, procedimentos de recuperação e exclusão de conta e proteção contra abuso no cadastro.
- O botão não ficará funcional até o cliente OAuth estar criado e autorizado pelo Google, além do deploy atualizado.

Fontes: https://developers.google.com/identity/gsi/web/guides/display-button
https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

As flags `WA_AUTOMATION_ENABLED="false"`, `ASAAS_SANDBOX="true"` e `PAYMENTS_PRODUCTION_ENABLED="false"` não foram alteradas.
