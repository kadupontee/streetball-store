# Streetball Store — fila de fornecedores para o catálogo compartilhado

## Como funciona

Todos os cinco fornecedores são candidatos a atender qualquer camisa do catálogo. **Não associe cada produto a um fornecedor.**

1. Após o Asaas informar `PAYMENT_RECEIVED`, o pedido fica apto a uma consulta.
2. O primeiro fornecedor da fila recebe foto e resumo do pedido por template WhatsApp aprovado.
3. O fornecedor responde `SEM_ESTOQUE ID` se não tiver os modelos/tamanhos, ou responde à própria mensagem com “sem estoque” ou “não temos”.
4. A negativa inequívoca é armazenada em `supplier_attempts`. O sistema passa ao próximo contato configurado.
5. Quando responder `DISPONIVEL ID`, são enviados os detalhes necessários para preparar o pedido. Só após `CONFIRMAR ID` o cliente poderá receber confirmação de preparação.
6. Se os cinco responderem sem estoque, o pedido fica em `all_unavailable` para revisão manual. Não é cancelado nem reembolsado automaticamente.
7. Respostas ambíguas, sem referência a uma mensagem/pedido, não são interpretadas como negativa: exigem conferência.

O acompanhamento de 24 horas é um **alerta por ausência de resposta**, não uma declaração automática de falta de estoque.

## Cadastro na Streetball Store

Execute no Mac:

```bash
cd ~/Downloads/streetball-store
git pull
npx wrangler d1 execute streetball-db --remote --file=worker/schema.sql
npm test
npx wrangler deploy
```

A migração é aditiva; preserva as tabelas existentes. Publique somente quando todos os testes passarem.

Acesse `https://streetball-store.kpgmer.workers.dev/suppliers.html` e informe seu `ADMIN_TOKEN`. Cadastre os nomes reais, IDs internos e números de WhatsApp com DDI de até cinco fornecedores. Também é possível alterar o telefone de um cadastro já existente.

**Alterar a ordem de preferência:** abra `/suppliers.html`, autentique com `ADMIN_TOKEN` e clique em **↑** ou **↓** ao lado de um fornecedor. Em seguida clique em **SALVAR ORDEM DE PREFERÊNCIA**. A ordem será armazenada na tabela `supplier_priority` do D1. O primeiro da lista será consultado antes dos demais, mas apenas fornecedores com WhatsApp cadastrado e autorização para consultas são elegíveis. Nenhuma mensagem é enviada ao mudar a prioridade.

Os telefones ficam **apenas no Cloudflare D1** (`supplier_contacts`) e são exibidos no painel somente pelos últimos quatro dígitos. O campo **Autorizou consultas automáticas?** documenta consentimento; sem ele, o contato não entra na fila elegível de mensagens. Credenciais da Meta continuam em secrets, nunca no catálogo público.

Depois do cadastro, os contatos autorizados do D1 passam a compor a fila de consultas **na ordem de cadastro**. A lista antiga `SUPPLIERS_JSON` serve apenas como fallback de compatibilidade quando não há fornecedores cadastrados no D1. Os campos de template continuam dependentes da aprovação da Meta e de configuração segura no Worker.

Depois, quando a Meta aprovar sua conta, configure os modelos de mensagem aprovados no Worker, sem copiar tokens ou números para o código público. Os telefones já cadastrados no D1 não precisam ser repetidos no `SUPPLIERS_JSON`.

Exemplo de estrutura (valores fictícios; não utilizar como números reais):

```json
[
 {"id":"fornecedor_a","phone":"8613800138000","template":"consulta_estoque","mediaTemplate":"pedido_fornecedor_foto"},
 {"id":"fornecedor_b","phone":"8613800138001","template":"consulta_estoque","mediaTemplate":"pedido_fornecedor_foto"}
]
```

O segredo `SUPPLIERS_JSON` é legado e não é necessário se os contatos do D1 estiverem cadastrados. Se usado por compatibilidade, nunca publique contatos ou segredos no GitHub.

## Prévia dos pedidos

No painel `/admin.html`, clique em **PRÉVIA SEM ENVIO**. A prévia mostra a fila de fornecedores autorizados, apenas os quatro últimos dígitos dos contatos, tentativas de consulta e verificações pendentes. Ela não envia mensagens nem realiza Pix.

## Estado atual — NÃO ATIVAR ENVIOS

- `ASAAS_SANDBOX = "true"`
- `WA_AUTOMATION_ENABLED = "false"`
- `PAYMENTS_PRODUCTION_ENABLED = "false"`
- O código impede qualquer disparo automático pelo Sandbox, mesmo se uma variável de automação for alterada isoladamente.
- O campo do telefone não envia nenhuma mensagem ao ser salvo e não modifica pedidos antigos.
- Os pagamentos aos fornecedores continuam manuais, com conferência de destinatário e valor.
- A Meta ainda está analisando o portfólio empresarial; é preciso resolver o erro `131031`, validar destinatários e templates, testar webhooks e só depois avaliar uma ativação gradual.

**Não trate a resposta “disponível” como prova de postagem ou entrega.** A confirmação deve ser auditada, e dados do comprador só devem ser enviados ao fornecedor certo quando necessários.
