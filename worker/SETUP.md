# Streetball Store — Ativar cobrança e automação (20/10/2026)

O código está preparado, **não está publicado em produção**. A loja do GitHub Pages continua sendo apenas vitrine. Para receber pedidos e pagamentos, é preciso publicar o **Cloudflare Worker** do repositório, vinculado ao banco **D1** e à conta **Asaas**. Não cole credenciais no GitHub ou no chat.

## O que já existe no código

1. Carrinho e checkout na mesma loja, com seleção de **Pix** ou **cartão de crédito**.
2. Preço de cada item e adicionais recalculados **no servidor** usando o catálogo; o navegador não decide o valor.
3. Frete fixo configurado no servidor e exibido antes do pagamento. Não habilite cobranças enquanto frete, tributos, prazo de entrega e política de troca não estiverem definidos.
4. Criação da cobrança hospedada no Asaas, que recebe os dados de cartão diretamente na própria página.
5. Webhook Asaas com token secreto e deduplicação por evento; conferência de valor, ID e referência do pedido.
6. Encaminhamento ao fornecedor **somente após PAYMENT_RECEIVED**. O evento PAYMENT_CONFIRMED isoladamente não libera o pedido.
7. Integração WhatsApp Business Cloud API para até cinco fornecedores configurados. A primeira mensagem deve usar modelo (template) de **cabeçalho com foto aprovado** pelo Meta.
8. Fornecedor pode responder **DETALHES ID** para receber os dados de envio e todas as fotos pelo WhatsApp, e **CONFIRMAR ID** para sinalizar preparação. O comprador recebe template de confirmação se o WhatsApp estiver configurado.
9. Verificação automática a cada hora: se o fornecedor não responder em 24 horas, o pedido vai para atraso e, se configurado, o administrador recebe alerta.
10. Pagamento do **fornecedor** não é realizado automaticamente: links recebidos por conversa exigem aprovação do dono da loja. Também é necessário verificar disponibilidade e reembolsos.

## Passo 1 — Criar Worker e banco de dados

Abra a pasta do repositório no seu computador, com Node e Cloudflare Wrangler instalados:

```bash
npx wrangler login
npx wrangler d1 create streetball-orders
```

Copie o `database_id` exibido e substitua `INSIRA-ID-DO-SEU-BANCO-D1` em `wrangler.toml`. Depois execute:

```bash
npx wrangler d1 execute streetball-orders --remote --file=worker/schema.sql
```

O mesmo `schema.sql` é seguro em uma base que já tem as tabelas anteriores; as três novas tabelas são criadas com `IF NOT EXISTS`.

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

## Passo 3 — Configurar os fornecedores WhatsApp

É necessário usar o WhatsApp Business Platform/Cloud API oficial. Conversas com fornecedores comuns pelo WhatsApp não fornecem API confiável para ler respostas ou efetuar pagamentos via interface. A Cloud API aceita números internacionais de fornecedores cadastrados, mas a conversa fora da janela de atendimento exige templates aprovados. Você precisará obter `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET` e `WA_VERIFY_TOKEN` da Meta, além de cadastrar os números autorizados dos fornecedores no segredo `SUPPLIERS_JSON`.

Exemplo de **formato**, NÃO de números reais: os cinco números são ilustrativos. Para fornecedores chineses use o código do país `86` e o telefone completo no padrão internacional E.164 (somente dígitos no JSON); para brasileiros use `55`.

```json
[
  {"id":"james","phone":"86NUMEROCHINES1","template":"pedido_fornecedor","mediaTemplate":"pedido_fornecedor_foto"},
  {"id":"fornecedor2","phone":"86NUMEROCHINES2","template":"pedido_fornecedor","mediaTemplate":"pedido_fornecedor_foto"},
  {"id":"fornecedor3","phone":"86NUMEROCHINES3","template":"pedido_fornecedor","mediaTemplate":"pedido_fornecedor_foto"},
  {"id":"fornecedor4","phone":"86NUMEROCHINES4","template":"pedido_fornecedor","mediaTemplate":"pedido_fornecedor_foto"},
  {"id":"fornecedor5","phone":"86NUMEROCHINES5","template":"pedido_fornecedor","mediaTemplate":"pedido_fornecedor_foto"}
]
```

O JSON deve ser fornecido ao comando `npx wrangler secret put SUPPLIERS_JSON`, **sem publicá-lo**. Configure a variável `DEFAULT_SUPPLIER_ID = "james"` em `wrangler.toml` **somente se este for realmente o fornecedor do catálogo importado**. Caso os produtos pertençam a fornecedores diferentes, cadastre o campo `supplierId` em cada produto; pedidos mistos ficam para verificação manual, não são enviados ao fornecedor errado.

Templates aprovados na Meta:
- `pedido_fornecedor_foto`: cabeçalho **IMAGE** dinâmico e **2 parâmetros de texto** no corpo (ID do pedido e resumo das peças). A foto do primeiro produto é usada no cabeçalho; outras fotos são enviadas quando o fornecedor responder `DETALHES <ID>`.
- `pedido_em_preparacao`: corpo com **1 parâmetro** (ID do pedido), para notificar o comprador após o fornecedor confirmar.
- `fornecedor_sem_resposta` (opcional): corpo com **1 parâmetro** (ID do pedido), para avisar o responsável após 24h sem resposta.

Configure webhook Meta:
- GET / POST: `https://SEU-DOMINIO/api/webhooks/whatsapp`.
- Token de verificação: `WA_VERIFY_TOKEN`.
- Validação HMAC obrigatória por `WA_APP_SECRET`; webhook só aceita respostas do número registrado no pedido.

Segredos e configurações:
```bash
npx wrangler secret put WA_TOKEN
npx wrangler secret put WA_APP_SECRET
npx wrangler secret put WA_VERIFY_TOKEN
npx wrangler secret put WA_PHONE_NUMBER_ID
npx wrangler secret put SUPPLIERS_JSON
```

Variáveis a configurar em `wrangler.toml` após aprovar os templates:
```toml
WA_AUTOMATION_ENABLED = "true"
DEFAULT_SUPPLIER_ID = "james"
STORE_PUBLIC_URL = "https://SEU-DOMINIO"
SUPPLIER_WA_TEMPLATE = "pedido_fornecedor"
SUPPLIER_WA_TEMPLATE_MEDIA = "pedido_fornecedor_foto"
BUYER_WA_TEMPLATE = "pedido_em_preparacao"
# Para alertas:
# OWNER_WA_PHONE = "55DDDNUMERO"
# OWNER_WA_TEMPLATE = "fornecedor_sem_resposta"
```

**Regras:** os destinatários precisam autorizar mensagens; templates devem estar aprovados pela Meta e os dados de envio só vão ao número de fornecedor configurado. A API não consegue forçar que o fornecedor responda.

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
