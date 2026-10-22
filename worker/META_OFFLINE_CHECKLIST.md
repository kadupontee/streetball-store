# Streetball Store — WhatsApp automático: preparação segura

O WhatsApp está desligado enquanto a verificação da Meta está pendente. Este documento descreve a implementação no código e os testes futuros. Não há mensagens reais disparadas.

## Consulta automática de estoque

- A confirmação `PAYMENT_RECEIVED` do Asaas inicia a consulta, quando o ambiente real estiver autorizado.
- O template `SUPPLIER_WA_TEMPLATE_MEDIA` utiliza **imagem de cabeçalho** com a foto do primeiro produto, uma variável com o ID curto do pedido e uma variável com o resumo do produto.
- O resumo inclui **modelo, tamanho, quantidade, patch e personalização**.
- Para pedidos com menos de três unidades, informa que conhecemos a condição promocional de frete grátis em pedidos a partir de três peças, mas que **queremos somente a quantidade comprada** e pedimos o valor correspondente de frete. Para três ou mais unidades, pede confirmação da elegibilidade ao frete grátis.
- **Nunca acrescentar camisas automaticamente para atingir frete grátis.** A condição pode variar por fornecedor e precisa ser confirmada.
- O template de imagem precisa estar aprovado pela Meta e a imagem precisa ser uma URL HTTPS válida e acessível; sem imagem válida, o Worker não envia a consulta e sinaliza revisão.

**Limite atual:** o cabeçalho do template usa somente a primeira foto do pedido. A apresentação de múltiplas fotos na consulta inicial de pedidos com vários modelos ainda requer uma solução aprovada pela Meta. Não presumir que todos os produtos já serão identificados visualmente em um pedido com várias camisas.

### Rascunho do template do fornecedor

Nome sugerido: `streetball_consulta_estoque`. Idioma sugerido: `pt_BR` (confirmar idioma preferido dos fornecedores).

Cabeçalho: imagem do produto.

Corpo:

> Streetball Store — consulta do pedido {{1}}. Produto e condições: {{2}}. Confirme se o modelo e tamanho estão em estoque. Responda DISPONIVEL {{1}} ou SEM_ESTOQUE {{1}}.

O próprio Worker prepara as variáveis `{{1}}` e `{{2}}`. O código não cadastra nem aprova esse template automaticamente na Meta.

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
