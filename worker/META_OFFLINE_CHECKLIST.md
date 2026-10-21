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

## 4. Respostas reais dos fornecedores: classificação por intenção e etapa

A conversa real da Li Sports demonstrou respostas que **não são** confirmação automática: preço `15# Streetball Store — preparação Meta WhatsApp sem envios

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

, `15+4=19# Streetball Store — preparação Meta WhatsApp sem envios

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

, perguntas de tamanho, aplicação de patch, lista de documentos, envio de link de pagamento, `ok` e uma promessa de enviar fotos nos próximos dias. Nenhum CPF, endereço, telefone ou comprovante deve entrar em fixtures, logs ou modelos de IA.

### Tabela segura

| Exemplo fictício | Quando é resposta à consulta do estoque | Decisão |
| --- | --- | --- |
| `sim`, `s`, `ss`, `yes`, `tem`, `temos`, `disponível`, `有货` | Resposta diretamente ligada à mensagem de disponibilidade | Disponibilidade declarada; **não** equivale a pedido preparado |
| `não`, `n`, `nn`, `no`, `não temos`, `sem estoque`, `esgotado`, `没货` | Resposta diretamente ligada à consulta | Falta de estoque; tentar próximo fornecedor |
| `talvez amanhã`, `estou vendo`, `depende do tamanho` | Resposta inconclusiva | Tentar próximo fornecedor |
| `ok`, `certo`, `perfeito`, `pronto`, `👍` | Confirmação de leitura ou recebimento | **Não** confirmar estoque, pedido, pagamento ou postagem |
| `15# Streetball Store — preparação Meta WhatsApp sem envios

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

, `15+4=19# Streetball Store — preparação Meta WhatsApp sem envios

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

 | Cotação/preço com eventual frete | Conferência humana do preço. **Não** pagar nem assumir estoque |
| `qual o tamanho?`, `precisa de remendo?` | Pergunta operacional | Atenção humana; responder com dados do pedido, sem inferir disponibilidade |
| `mande o CPF`, `pague neste link` | Pedido de dados pessoais ou pagamento | Revisão manual obrigatória; conferir finalidade, segurança e destinatário |
| `aguarde alguns dias, enviarei fotos` | Atualização de andamento | Não equivale a comprovação de preparo, pagamento ou postagem |
| `CONFIRMAR abcdef12` | Após envio dos detalhes e correlação com pedido | Pode sinalizar preparação, se o estágio realmente permitir |
| Foto, áudio ou comprovante sem texto estruturado | Qualquer estágio | Não interpretar como confirmação de estoque |

**Contexto é obrigatório para respostas curtas.** Uma resposta direta à mensagem enviada pela loja traz `messages[].context.id` no webhook. A aplicação também reconhece comandos com ID curto do pedido e payloads estruturados de botões. `sim` ou `não` sem contexto não devem alterar pedidos se houver dúvida sobre a pergunta anterior.

**Nunca responder “não” à pergunta “precisa de patch?” como “não há estoque”.** Só a correlação com a **mensagem original de disponibilidade** pode autorizar a decisão de estoque.

**Ao fornecedor que respondeu preço ou uma pergunta:** destacar no painel e manter a consulta pendente; se não houver resposta válida de estoque até as 12 horas, o fallback da fila pode prosseguir. A instrução do operador deve indicar claramente a pergunta e o estágio. O prazo global permanece 72 horas.

### Respostas rápidas recomendadas para futuros templates Meta

Para reduzir erros, configurar botões de template com payloads que incluam o identificador do pedido. Sugestão de identificadores internos (exemplos fictícios):

- `STOCK_YES_1234abcd` — tem todos os itens/tamanhos
- `STOCK_NO_1234abcd` — não tem todos os itens/tamanhos
- `STOCK_UNSURE_1234abcd` — disponibilidade inconclusiva
- `ORDER_CONFIRM_1234abcd` — confirmar somente na etapa de pedido, após envio dos detalhes

Os textos apresentados nos botões podem ser `Tenho`, `Sem estoque` e `Verificar`. O próprio payload (e não apenas o rótulo) precisa corresponder ao pedido. Em mensagens de botão, a Cloud API pode enviar dados em `button.payload` ou `interactive.button_reply.id`, conforme o tipo de mensagem. Não usar payloads genéricos como `YES` sem código.

Os botões ainda **não estão configurados nem aprovados na Meta**; apenas o reconhecimento foi preparado e coberto por testes. Quando configurados, é necessário provar o vínculo entre código, telefone do fornecedor e pedido aberto, além de impedir duplicatas e mensagens atrasadas.

## 5. Critérios para sair do modo simulação

1. Verificação Meta liberada, templates aprovados, número desbloqueado.
2. Testes de assinatura de webhook (válida e inválida), deduplicação, associação por contexto e ID curto.
3. Simulação de 12h/72h com relógio controlado e prova de que nenhum cliente é notificado sem opt-in.
4. Revisão de dados enviados ao fornecedor: não enviar endereço completo antes de confirmar disponibilidade e identidade do fornecedor.
5. Revisão de importações, frete, impostos e política de devolução.
6. Teste real com número próprio autorizado; só depois ativação gradual dos fornecedores.

Até lá: `ASAAS_SANDBOX = "true"`, `WA_AUTOMATION_ENABLED = "false"` e `PAYMENTS_PRODUCTION_ENABLED = "false"`. Não altere essas configurações em testes offline.
