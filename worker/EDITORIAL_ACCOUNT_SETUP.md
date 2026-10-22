# Publicação do novo visual e da área de clientes — Streetball Store

## O que mudou

- Visual da loja baseado na arte aprovada: cinza-claro, lavanda, preto, tipografia editorial, conteúdo retrô e quatro fotos rotativas por cena em um carrossel com quatro cenas.
- As fotos são obtidas de **produtos do catálogo cuja utilização comercial foi autorizada** e não das fotografias editoriais de jogadores que apareciam na imagem ilustrativa. O catálogo de 11 mil itens, as fotos individuais e as operações de compra anteriores foram preservados.
- Novo menu **Conta** com links para criar conta, entrar, meus pedidos e acompanhar.
- `/account.html` permite cadastrar, entrar, sair e consultar pedidos vinculados. Contas são criadas no D1 com senha derivada por PBKDF2 SHA-256 e salt individual. Cookie de sessão assinado por token aleatório armazenado apenas em hash e definido como `HttpOnly; Secure; SameSite=Lax`.
- Um pedido feito enquanto o cliente estiver autenticado é vinculado à conta se o e-mail informado no checkout corresponder ao e-mail da sessão.
- Um pedido antigo pode ser vinculado pelo proprietário do **link privado de rastreamento** `track.html#<id>.<assinatura>`. O backend verifica a assinatura HMAC e evita acesso a pedidos por mera coincidência de e-mail.
- `/track.html` passou a combinar com a nova identidade visual.

## Publicação segura

Primeiro faça backup do D1, depois aplique a migração aditiva e só então publique o código:

```bash
cd ~/Downloads/streetball-store
git pull
npx wrangler d1 export streetball-db --remote --output=../streetball-backup-contas.sql
npx wrangler d1 execute streetball-db --remote --file=worker/schema.sql
npm test
npx wrangler deploy
```

**Não comite nem compartilhe** a cópia de segurança. O script SQL usa `CREATE TABLE IF NOT EXISTS`, mantendo pedidos/fornecedores existentes.

Se `TRACKING_LINK_SECRET` ainda não estiver configurado, use `npx wrangler secret put TRACKING_LINK_SECRET` e defina um segredo aleatório de 32+ caracteres; sem ele links privados, reivindicação de pedidos antigos e acompanhamento completo podem ficar indisponíveis.

Teste o fluxo: abrir a página inicial em desktop e celular, clicar em Conta > Criar conta, criar cadastro com e-mail de teste e senha de pelo menos 12 caracteres, sair e entrar, abrir Pedidos e vincular somente um pedido de teste que tenha seu link privado. Verificar também que uma conta não autenticada recebe 401 na API de pedidos. Não insira dados reais de terceiros nos testes.

**Ambiente permanece em simulação:** `ASAAS_SANDBOX=true`, `PAYMENTS_PRODUCTION_ENABLED=false`, `WA_AUTOMATION_ENABLED=false`. Nenhuma alteração desta atualização realiza pagamentos reais nem envia mensagens do WhatsApp.

## Pendências antes de vendas reais

- Verificação de e-mail e recuperação de senha com fornecedor de e-mails transacionais.
- Proteção antirrobô/antifraude adicional no cadastro (por exemplo, Turnstile e rate limits na borda).
- Revisão de acessibilidade/mobile na implantação publicada.
- Verificação da Meta e aprovação do template do fornecedor.
- Continuidade da revisão operacional e fiscal já iniciada; a nova conta de cliente não modifica as condições tributárias da Opção B.
