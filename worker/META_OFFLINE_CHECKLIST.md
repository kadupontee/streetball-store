# Streetball Store — WhatsApp automático: preparação segura

O WhatsApp está desligado enquanto a verificação da Meta está pendente. Este documento descreve a implementação no código e os testes futuros. Não há mensagens reais disparadas.

## Consulta automática de estoque — mensagem mínima solicitada

A consulta inicial é composta **somente pela foto da camisa no cabeçalho do template e pelo texto abaixo**, sem saudação, número do pedido ou perguntas extras. Os campos são calculados a partir do pedido real.

Exemplo fictício de uma camisa:

```text
Produto: Camisa Real Madrid Third 2016/2017 — Roxa (Retrô)

Detalhes:

* Foto do produto: enviada em anexo
* Tamanho: P (S)
* Quantidade: 1 unidade
* Personalização: Não
* Patch: Não
* Entrega: São Paulo, Brasil

Sei que vocês oferecem frete grátis para pedidos de 3 peças ou mais, mas gostaria de comprar apenas 1 unidade mesmo, pagando o frete correspondente.
```

A função `supplierPhotoRequest` está em `worker/supplier-order-format.js` e produz texto de prévia e os sete parâmetros do template:

1. Título do produto, 2. tamanho, 3. quantidade, 4. personalização, 5. patch, 6. cidade de entrega + `Brasil`, 7. quantidade repetida na frase do frete.

O template da Meta para pedidos com **1 ou 2 peças** (`SUPPLIER_WA_TEMPLATE_MEDIA`) deverá ter **imagem no cabeçalho** e o corpo exato:

```text
Produto: {{1}}

Detalhes:

* Foto do produto: enviada em anexo
* Tamanho: {{2}}
* Quantidade: {{3}}
* Personalização: {{4}}
* Patch: {{5}}
* Entrega: {{6}}

Sei que vocês oferecem frete grátis para pedidos de 3 peças ou mais, mas gostaria de comprar apenas {{7}} mesmo, pagando o frete correspondente.
```

Para **3 ou mais peças do mesmo modelo**, outro template (`SUPPLIER_WA_TEMPLATE_MEDIA_BULK`) usa o mesmo cabeçalho e as mesmas sete variáveis, mas a última frase é:

```text
Sei que vocês oferecem frete grátis para pedidos de 3 peças ou mais e gostaria de comprar exatamente {{7}}, mantendo essa quantidade.
```

**Observações importantes:**
- Os templates ainda **não foram cadastrados nem aprovados pela Meta**. A aprovação pode exigir ajustes na redação. Não habilitar envios até os nomes e corpos aprovados corresponderem ao código.
- Antes de ligar a integração, configurar `SUPPLIER_TEMPLATE_FORMAT="minimal_v1"` e os nomes dos templates aprovados apenas depois de testá-los. Enquanto isso, `WA_AUTOMATION_ENABLED="false"`, `ASAAS_SANDBOX="true"`.
- A foto real precisa estar acessível por HTTPS, na URL autorizada do catálogo. Nada é enviado quando falta foto.
- **Pedidos com mais de um modelo** ficam em revisão manual: não enviaremos a foto de uma única camisa como se ela representasse todo o pedido. Precisamos de suporte a múltiplas fotos antes de automatizá-los.
- Respostas curtas `sim`/`não` continuam exigindo correlação com a mensagem original via `context.id` ou identificação explícita segura. Não incluímos código do pedido no texto visível para respeitar o formato solicitado, mas internamente preservamos o vínculo pelo ID de mensagem.
- A promoção de frete grátis é informação relatada pelo fornecedor, não desconto garantido universalmente; a quantidade do comprador nunca é ampliada automaticamente.
- Não compartilhar nome, CPF, telefone ou endereço completo na consulta inicial.

## Entender as respostas dos fornecedores

O classificador `worker/supplier-replies.js` diferencia respostas sobre estoque, perguntas, cotações, atualização de produção e pedidos de pagamento.

| Resposta de exemplo | Ação prevista |
| --- | --- |
| `sim`, `tem`, `available`, `有货` | Disponibilidade declarada **somente se ligada à mensagem da consulta de estoque** |
| `não`, `sem estoque`, `out of stock`, `没货` | Próximo fornecedor se ligada à consulta |
| `talvez amanhã` | Resposta ambígua vinculada; próximo fornecedor |
| `ok`, `certo`, `perfeito` | Confirmação de leitura, não de estoque |
| `15 dólares`, `15+4=19$` | Preço/frete; conferência humana |
| `qual tamanho?`, `precisa de patch?` | Pergunta operacional; atenção humana |
| `pague neste link`, `envie o CPF` | Nunca autorizar pagamento ou compartilhar dados sem validação |
| `aguarde fotos` | Atualização; não comprova postagem |

O recebimento de texto solto como `sim` não altera pedidos. O webhook deve correlacionar a resposta ao ID da consulta ou ao código do pedido. A Meta também suporta botões com payloads estruturados; o sistema só deve aceitar valores identificados por pedido.

## Prazo e atendimento do comprador

- 12 horas por fornecedor sem resposta conclusiva sobre estoque; próximo contato autorizado.
- Até 72 horas totais a partir da primeira tentativa para localizar disponibilidade.
- Se ninguém confirmar, revisão manual. Mensagem de desculpas automática depende de consentimento específico do comprador e template `BUYER_DELAY_WA_TEMPLATE` aprovado.
- Pagamento ao fornecedor continua manual.

Mensagem sugerida ao comprador:

> Pedimos desculpas pela demora na confirmação de disponibilidade do pedido {{1}}. Nossa equipe está verificando as opções e entrará em contato com uma atualização. Agradecemos pela compreensão.

## Checklist para liberar mensagens reais

1. Meta libera a conta e o número oficial, e aprova o template com foto.
2. Fornecedores autorizam o recebimento; contatos e ordem constam no D1.
3. Valide URLs e permissões das fotos, sobretudo em pedidos com vários modelos.
4. Teste assinatura dos webhooks, associação pelo `context.id`, deduplicação e mensagens atrasadas.
5. Verifique preço, tamanho, personalização e frete com cada fornecedor antes de qualquer pagamento.
6. Teste com números próprios/autorizados, depois faça liberação gradual.

Até lá, manter `ASAAS_SANDBOX = "true"`, `WA_AUTOMATION_ENABLED = "false"` e `PAYMENTS_PRODUCTION_ENABLED = "false"`.
