# Streetball Store — Ativar cobrança e automação (20/10/2026)

O código já está publicado no Cloudflare em modo Sandbox; **vendas reais e automação WhatsApp continuam desativadas**. A notificação de desculpas exige consentimento opcional do comprador no checkout e template aprovado pela Meta. A loja do GitHub Pages continua sendo apenas vitrine. Para receber pedidos e pagamentos, é preciso publicar o **Cloudflare Worker** do repositório, vinculado ao banco **D1** e à conta **Asaas**. Não cole credenciais no GitHub ou no chat.

## O que já existe no código

1. Carrinho e checkout na mesma loja, com seleção de **Pix** ou **cartão de crédito**.
2. Preço de cada item e adicionais recalculados **no servidor** usando o catálogo; o navegador não decide o valor.
3. Frete fixo configurado no servidor e exibido antes do pagamento. Não habilite cobranças enquanto frete, tributos, prazo de entrega e política de troca não estiverem definidos.
4. Criação da cobrança hospedada no Asaas, que recebe os dados de cartão diretamente na própria página.
5. Webhook Asaas com token secreto e deduplicação por evento; conferência de valor, ID e referência do pedido.
6. Encaminhamento ao fornecedor **somente após PAYMENT_RECEIVED**. O evento PAYMENT_CONFIRMED isoladamente não libera o pedido.
7. Integração WhatsApp Business Cloud API para até cinco fornecedores configurados. A primeira mensagem deve usar modelo (template) de **cabeçalho com foto aprovado** pelo Meta.
8. Os cinco fornecedores compartilham o catálogo. Negativa explícita de estoque passa ao próximo contato. Apenas após disponibilidade confirmada são enviados os dados de envio, e **CONFIRMAR ID** marca preparação. O comprador só recebe atualização após essa confirmação.
9. Verificação automática a cada hora: se o fornecedor não responder em **12 horas**, o pedido vai ao próximo; respostas ambíguas vinculadas ao pedido também avançam. Após **72 horas corridas** sem confirmação, vai à revisão manual e prepara aviso de desculpas ao cliente.
10. Pagamento do **fornecedor** não é realizado automaticamente: links recebidos por conversa exigem aprovação do dono da loja. Também é necessário verificar disponibilidade e reembolsos.

## Passo 1 — Criar Worker e banco de dados

O banco D1 `streetball-db` **já foi criado** e seu `database_id` já está configurado no `wrangler.toml`. **Não crie outro banco.** Abra a pasta deste repositório no seu computador, com Node.js instalado, e autentique o Wrangler:

```bash
npx wrangler login
```

Para criar as tabelas necessárias ao checkout no banco existente, execute:

```bash
npx wrangler d1 execute streetball-db --remote --file=worker/schema.sql
```

O mesmo `schema.sql` é aditivo e seguro em uma base que já possui tabelas anteriores: as novas tabelas são criadas com `IF NOT EXISTS`.

Defina um domínio do Worker (ou `*.workers.dev`) capaz de atender tanto à loja quanto às rotas `/api/*`. **Não é possível finalizar compras pelo site estático do GitHub Pages**: ele continuará com botão de pagamento desativado.

## Passo 2 — Testar Asaas em sandbox

Crie uma conta no [Asaas Sandbox](https://sandbox.asaas.com/) e obtenha sua chave de API. Configure-a como segredo:

```bash
npx wrangler secret put ASAAS_API_KEY
npx wrangler secret put ASAAS_WEBHOOK_TOKEN
npx wrangler secret put ADMIN_TOKEN
```

No painel do Asaas, cadastre webhook para `https://SEU-DOMINIO/api/webhooks/asaas` com um token aleatório de **32 a 255 caracteres**, que deve ser **exatamente igual** ao segredo `ASAAS_WEBHOOK_TOKEN`. Assine `PAYMENT_RECEIVED`, `PAYMENT_REFUNDED` e `PAYMENT_CHARGEBACK_REQUESTED` (além dos outros estados que desejar acompanhar). O token de webhook **não** é a chave de API do Asaas.

Em `wrangler.toml`, configure, por exemplo:

```toml
[vars]
ASAAS_SANDBOX = "true"
SALES_ENABLED = "true"
PAYMENTS_PRODUCTION_ENABLED = "false"
WA_AUTOMATION_ENABLED = "false"
SHIPPING_FLAT_BRL = "29.90"  # EXEMPLO; substitua pelo frete REAL definido para a operação
```

**ATENÇÃO:** não use R$29,90 como valor real até apurar origem, destino, frete internacional, tributos e eventuais taxas. Se você não puder garantir entrega e tributos para todos os CEPs, implemente cotação por CEP antes de aceitar pagamentos. Para testar o fluxo, execute `npx wrangler deploy`, abra a URL do Worker e teste uma transação no sandbox. O site identifica quando o modo é teste.

## Passo 3 — Configurar o catálogo compartilhado e os cinco fornecedores

A loja usa **um catálogo comum** e consulta fornecedores em sequência. Não é necessário `supplierId` por produto nem `DEFAULT_SUPPLIER_ID`.

Cadastre os IDs e nomes dos cinco fornecedores em `/suppliers.html` após migrar o D1, conforme `worker/PREVIA_FORNECEDORES.md`.

Quando a Meta aprovar o aplicativo e os testes estiverem liberados, cadastre `SUPPLIERS_JSON` como segredo com até cinco objetos `{id,phone,template,mediaTemplate}`. A **ordem dos objetos** define a ordem preferida das consultas; use números completos com DDI, e somente fornecedores que autorizaram receber os contatos.

A primeira mensagem requer template aprovado com cabeçalho de imagem e duas variáveis (ID curto do pedido e resumo dos itens). São suportadas respostas `SEM_ESTOQUE ID`, `DISPONIVEL ID`, `DETALHES ID` e `CONFIRMAR ID`. Respostas curtas como “não temos” também podem ser associadas quando o fornecedor responde diretamente à mensagem de consulta. Texto ambíguo ou sem contexto vai para revisão manual, não para conclusão automática.

O sistema avança ao próximo fornecedor quando há negativa, resposta ambígua vinculada ao pedido ou **12 horas de silêncio**. Todos podem ser consultados durante a janela de **72 horas** a partir do primeiro contato. Se nenhum fornecedor confirmar, após 72 horas o pedido vai para revisão manual. **Silêncio não equivale a falta de estoque.** O cliente recebe uma mensagem de desculpas somente com opt-in explícito e template `BUYER_DELAY_WA_TEMPLATE` aprovado; sem isso, o painel indica contato manual. Não existe reembolso nem pagamento automático ao fornecedor.

Webhook Meta: `GET/POST https://SEU-DOMINIO/api/webhooks/whatsapp`; cadastre `WA_VERIFY_TOKEN`, `WA_APP_SECRET`, `WA_TOKEN` e `WA_PHONE_NUMBER_ID` como segredos no Cloudflare e inscreva o campo `messages`. Não copie tokens para o código nem para o GitHub.

**Segurança:** enquanto `ASAAS_SANDBOX = "true"` ou `WA_AUTOMATION_ENABLED = "false"`, a automação **não envia mensagens**. Antes de qualquer liberação real, valide números, consentimento, templates, fotos, dados de entrega e políticas de devolução.

## Passo 4 — Publicar / checar

```bash
npm test
npx wrangler deploy
```

Cheque `https://SEU-DOMINIO/api/health` e `https://SEU-DOMINIO/api/checkout/config`. A segunda rota só retorna `enabled:true` com banco, conta, frete e modo de venda corretamente configurados.

Acompanhe pedidos apenas com token secreto de administrador, por exemplo no terminal:

```bash
curl -H "Authorization: Bearer SEU_ADMIN_TOKEN" https://SEU-DOMINIO/api/admin/orders
```

Nunca inclua token nos arquivos públicos ou nos prints de divulgação.

## Passo 5 — Produção, depois da validação

Troque a chave Sandbox pela chave Asaas real **no Worker**, cadastre webhook real, e apenas após teste de frete, nota fiscal/tributos, fluxo de compra, SLA e reembolsos altere:

```toml
ASAAS_SANDBOX = "false"
SALES_ENABLED = "true"
PAYMENTS_PRODUCTION_ENABLED = "true"
```

O ambiente Sandbox e o ambiente real são diferentes. Não coloque valores de cartão no site; o Asaas faz a captura na própria fatura. Defina termos comerciais e política de privacidade/LGPD antes de disponibilizar o checkout real.

## Limites deste MVP

- **Nenhuma compra real é ativada automaticamente** pela inclusão destes arquivos no GitHub; falta provisionar os serviços e inserir segredos/endereços.
- **Pix recebido de cliente ≠ Pix repassado ao fornecedor.** Não foi implementado um robô que clica em links de pagamento de terceiros ou envia comprovantes sem uma transação bancária validada. Para automatizar futuramente, use uma API financeira oficial com beneficiário verificado, limites, auditoria e autorização explícita.
- A conferência do fornecedor por mensagem confirma que ele **afirmou** estar preparando, não que tenha pago, expedido ou comprovado estoque.
- O checkout atual aceita **frete fixo configurado**, não calcula entrega por CEP, frete internacional, impostos ou regras de importação. Sem esses valores confiáveis, **não ative a produção**.
- Se o Whatsapp/API ou download da foto falhar, o pedido é encaminhado para revisão, sem envio repetido automático (evita duplicidade).
