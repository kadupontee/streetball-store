# Streetball Store — preparação Meta WhatsApp sem envios

Este arquivo é um **rascunho de modelos e um roteiro para testes**, não um cadastro na Meta nem aprovação de mensagens. O WhatsApp permanece desligado enquanto a conta estiver em análise.

## 1. Pré-requisitos antes de testar com pessoas

- Aprovação do portfólio/conta e desbloqueio do número de WhatsApp Business.
- WhatsApp Cloud API vinculada ao número autorizado. Configure os segredos apenas no Cloudflare Worker; nunca em arquivos públicos.
- Templates aprovados no idioma escolhido e categoria correta, respeitando as políticas da Meta.
- Webhook com assinatura HMAC validada e evento `messages` inscrito.
- Consentimento documentado de fornecedores para receber consultas e consentimento opcional do comprador para atualizações.
- Testes exclusivamente com números próprios/autorizados antes de contatar os cinco fornecedores.

## 2. Rascunhos de templates (ainda não aprovados)

### Consulta ao fornecedor com foto

Nome sugerido: `streetball_consulta_estoque`

Idioma inicial: `pt_BR` (confirmar se o fornecedor prefere outro idioma).

Cabeçalho: **imagem** (foto da camisa, com origem permitida).

Corpo:

> Streetball Store — consulta de disponibilidade para o pedido {{1}}. Precisamos confirmar o estoque do seguinte item: {{2}}. Responda DISPONIVEL {{1}} caso tenha o modelo e tamanho, ou SEM_ESTOQUE {{1}} se não tiver.

A integração atual envia duas variáveis no corpo (identificação curta e resumo dos itens) e uma imagem no cabeçalho. O nome aprovado deverá ser configurado em `SUPPLIER_WA_TEMPLATE_MEDIA`. No caso de vários itens, a confirmação precisa abranger todos os modelos/tamanhos, não apenas a foto do cabeçalho.

**Atenção:** fotos de catálogo e textos longos devem ser validados na documentação de limites e permissões antes de habilitar produção.

### Desculpas ao cliente (72 horas)

Nome sugerido: `streetball_pedido_atrasado`

Corpo:

> Pedimos desculpas pela demora na confirmação de disponibilidade do pedido {{1}}. Nossa equipe está verificando as opções e entrará em contato com uma atualização. Agradecemos pela compreensão.

A integração atual usa uma variável (ID curto do pedido). O nome aprovado deverá ser configurado em `BUYER_DELAY_WA_TEMPLATE`. Somente compradores com autorização específica podem receber a mensagem automaticamente.

### Confirmação de preparação

Nome sugerido: `streetball_pedido_preparando`

Corpo:

> Atualização Streetball Store: recebemos a confirmação de preparação do pedido {{1}}. Seguiremos acompanhando seu andamento.

A integração atual usa uma variável. Configure futuramente em `BUYER_WA_TEMPLATE` somente após aprovação.

## 3. Teste offline no painel

Abra `/suppliers.html`, informe o `ADMIN_TOKEN` e carregue os fornecedores. Na seção **Laboratório de respostas do WhatsApp — SEM ENVIO**, digite mensagens **fictícias**, sem telefones, nomes de clientes, endereços ou tokens.

Cenários mínimos:

| Texto digitado | Vínculo fictício | Resultado esperado |
| --- | --- | --- |
| `não temos` | Marcado | Sem estoque; próximo fornecedor |
| `talvez amanhã` | Marcado | Ambígua; próximo fornecedor |
| `temos em estoque` | Marcado | Disponível; aguardar confirmação |
| `não temos` | Desmarcado | Sem vínculo seguro, aguardar timeout |
| `SEM_ESTOQUE 1234abcd` | Desmarcado | Código curto; possível correlação por pedido |

O laboratório usa a **mesma função de classificação do backend**, mas não valida assinatura, entrega, autorização do contato, deduplicação real nem chama o endpoint Meta.

## 4. Critérios para sair do modo simulação

1. Verificação Meta liberada, templates aprovados, número desbloqueado.
2. Testes de assinatura de webhook (válida e inválida), deduplicação, associação por contexto e ID curto.
3. Simulação de 12h/72h com relógio controlado e prova de que nenhum cliente é notificado sem opt-in.
4. Revisão de dados enviados ao fornecedor: não enviar endereço completo antes de confirmar disponibilidade e identidade do fornecedor.
5. Revisão de importações, frete, impostos e política de devolução.
6. Teste real com número próprio autorizado; só depois ativação gradual dos fornecedores.

Até lá: `ASAAS_SANDBOX = "true"`, `WA_AUTOMATION_ENABLED = "false"` e `PAYMENTS_PRODUCTION_ENABLED = "false"`. Não altere essas configurações em testes offline.
