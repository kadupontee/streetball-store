# Streetball Store — Prévia segura dos pedidos para fornecedores

## Cadastro da origem de cada produto (cinco fornecedores)

O catálogo da Streetball Store contém produtos de fornecedores diferentes. **Nome do clube, foto e link de álbum não bastam para inferir o vendedor correto.** As atribuições deverão ser conferidas pelo responsável antes de salvar.

1. Atualize o código com `git pull`.
2. Faça a migração no D1 existente com `npx wrangler d1 execute streetball-db --remote --file=worker/schema.sql`. O script usa `CREATE TABLE IF NOT EXISTS`, preservando pedidos e pagamentos já registrados.
3. Execute `npm test` e publique apenas após aprovação dos testes: `npx wrangler deploy`.
4. Acesse `https://streetball-store.kpgmer.workers.dev/suppliers.html` (ou use o link do painel administrativo) e informe seu `ADMIN_TOKEN`.
5. Cadastre de um a cinco **nomes reais** e IDs estáveis, por exemplo `fornecedor_a`, `fornecedor_b` etc. Esses exemplos **não** são fornecedores cadastrados automaticamente.
6. Pesquise produtos pelo nome, ID ou link do álbum. Confira com qual fornecedor cada produto realmente é fornecido.
7. Selecione o fornecedor em cada linha e clique em **SALVAR**, ou marque até 25 produtos de origem comprovadamente igual e use o botão de lote. Você pode remover uma atribuição usando “Não identificado”.

A tabela `supplier_product_map` guarda o vínculo por ID estável no D1, então novos imports e mudanças de imagem não apagam as atribuições. A loja acrescenta a atribuição aos **novos pedidos feitos após a publicação**. Pedidos anteriores também podem ser consultados na prévia administrativa a partir do mapa atual, mas não são encaminhados automaticamente.

**Pedidos mistos:** se um carrinho tiver itens de fornecedores distintos ou sem identificação, a automação não pode eleger um único fornecedor e fica pendente de revisão humana. O projeto não divide pedidos entre múltiplos fornecedores nesta versão.

**Somente cadastro:** telefones, tokens, templates aprovados, envios de WhatsApp e Pix ao fornecedor não são configurados por esta tela. O envio continua desativado com `WA_AUTOMATION_ENABLED = "false"`.


Este recurso permite conferir o **texto, as variantes e a primeira foto** antes de conectar a API do WhatsApp.

## Estado atual (modo de testes)

- Asaas Sandbox: ativo.
- `WA_AUTOMATION_ENABLED = "false"`: **mantido**. Nenhuma mensagem é enviada.
- `PAYMENTS_PRODUCTION_ENABLED = "false"`: cobranças reais bloqueadas.
- Pagamento Pix aos fornecedores: requer aprovação humana e conferência de beneficiário, valor e comprovante.
- Meta Business: aguardando análise da verificação empresarial para investigar o erro `131031`.

## Publicar a prévia

No Mac, dentro da pasta do repositório:

```bash
git pull
npm test
npx wrangler deploy
```

Acesse `https://streetball-store.kpgmer.workers.dev/admin.html`, informe o `ADMIN_TOKEN`, clique em **CARREGAR PEDIDOS** e escolha **PRÉVIA SEM ENVIO** no pedido. O botão somente consulta a API administrativa autenticada.

## O que a prévia revela

- Identificador reduzido do pedido, status de pagamento, itens, quantidade, tamanho, nome/número personalizado e patch;
- Identificador do fornecedor e últimos quatro dígitos do WhatsApp (quando houver fornecedor cadastrado);
- Resumo da mensagem inicial e URL permitida da primeira foto;
- Checagens de configuração (fornecedor, foto, template, token e ID do número).

A prévia **não** cria cobrança, não envia WhatsApp, não modifica pedidos, não revela o token do WhatsApp e não apresenta o endereço ou CPF do comprador.

## Preparação dos até cinco fornecedores

Os dados precisam ser validados antes do uso:
- ID interno único de cada fornecedor, por exemplo `fornecedor1`;
- Número completo com DDI (para fornecedores chineses, `86` + número);
- Autorização do fornecedor para receber mensagens comerciais por WhatsApp;
- Modelo aprovado pela Meta com cabeçalho **IMAGE** e duas variáveis de corpo: ID curto do pedido e resumo dos produtos.

Salve a lista como **segredo**, nunca em arquivo versionado, usando `npx wrangler secret put SUPPLIERS_JSON` no Terminal. O JSON deve conter no máximo cinco objetos no formato descrito em `worker/SETUP.md`. Nunca envie a lista de números pessoais em prints públicos.

Antes de enviar mensagens, vincule o produto ao fornecedor certo via `supplierId`, ou configure `DEFAULT_SUPPLIER_ID` **somente** se todos os produtos vierem realmente do mesmo fornecedor. Pedidos com fornecedores misturados devem seguir para revisão manual.

## Por que pode aparecer "PENDENTE"

É normal: enquanto `SUPPLIERS_JSON` e `DEFAULT_SUPPLIER_ID` não forem configurados, a prévia não identifica o destinatário. Sem `WA_TOKEN` válido e template aprovado, a integração também não está pronta. **Não habilite `WA_AUTOMATION_ENABLED` ainda.**

## Quando a Meta aprovar

1. Conferir no WhatsApp Manager se a conta deixou de apresentar `131031` e se a API entrega mensagens ao número autorizado de teste.
2. Trocar o token temporário da Meta por token adequado à operação contínua, com permissões mínimas.
3. Configurar `WA_PHONE_NUMBER_ID`, `WA_TOKEN`, `WA_APP_SECRET` e `WA_VERIFY_TOKEN` como segredos no Cloudflare.
4. Validar a URL `/api/webhooks/whatsapp` na Meta e inscrever o campo `messages`.
5. Aprovar os templates, autorizar destinatários, testar cabeçalho com foto e respostas `DETALHES ID` e `CONFIRMAR ID`.
6. Testar com pedido **simulado**, confirmando que nenhuma mensagem nem transferência é enviada a fornecedores reais inesperadamente.
7. Só depois planejar ativação gradual do envio, com autorização explícita do proprietário.

> Os dados de compradores são pessoais. Não use compradores reais em testes e não envie endereços aos fornecedores antes de validar o destinatário e a necessidade da informação.
