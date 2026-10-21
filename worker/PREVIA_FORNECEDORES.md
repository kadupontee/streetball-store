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

Acesse `https://streetball-store.kpgmer.workers.dev/suppliers.html` e informe seu `ADMIN_TOKEN`. Cadastre os nomes reais e os IDs internos de até cinco fornecedores. **Números e credenciais não entram nessa tela**.

Depois, quando a Meta aprovar sua conta, será possível configurar os cinco telefones e templates aprovados no segredo `SUPPLIERS_JSON` do Cloudflare. **A ordem dos objetos nesse segredo será a prioridade de consulta.** IDs precisam corresponder aos IDs administrativos.

Exemplo de estrutura (valores fictícios; não utilizar como números reais):

```json
[
 {"id":"fornecedor_a","phone":"8613800138000","template":"consulta_estoque","mediaTemplate":"pedido_fornecedor_foto"},
 {"id":"fornecedor_b","phone":"8613800138001","template":"consulta_estoque","mediaTemplate":"pedido_fornecedor_foto"}
]
```

Use `npx wrangler secret put SUPPLIERS_JSON` com até cinco fornecedores reais autorizados; não publique esses contatos ou segredos no GitHub.

## Prévia dos pedidos

No painel `/admin.html`, clique em **PRÉVIA SEM ENVIO**. A prévia mostra a fila de fornecedores configurados, tentativas de consulta e verificações pendentes. Ela não envia mensagens nem realiza Pix.

## Estado atual — NÃO ATIVAR ENVIOS

- `ASAAS_SANDBOX = "true"`
- `WA_AUTOMATION_ENABLED = "false"`
- `PAYMENTS_PRODUCTION_ENABLED = "false"`
- O código impede qualquer disparo automático pelo Sandbox, mesmo se uma variável de automação for alterada isoladamente.
- Os pagamentos aos fornecedores continuam manuais, com conferência de destinatário e valor.
- A Meta ainda está analisando o portfólio empresarial; é preciso resolver o erro `131031`, validar destinatários e templates, testar webhooks e só depois avaliar uma ativação gradual.

**Não trate a resposta “disponível” como prova de postagem ou entrega.** A confirmação deve ser auditada, e dados do comprador só devem ser enviados ao fornecedor certo quando necessários.
