# Streetball Store — fila de fornecedores para o catálogo compartilhado

## Como funciona

Todos os cinco fornecedores compartilham o catálogo. O código usa a ordem de preferência salva no D1 e só considera fornecedores com contato e autorização registrados.

1. Após `PAYMENT_RECEIVED`, começa o prazo de **72 horas corridas** a partir da criação de `supplier_dispatch` (início da busca do pedido pago).
2. A primeira consulta pede a disponibilidade do modelo e tamanho usando um template com foto, após liberação da Meta.
3. **Sem resposta por 12 horas**, a execução programada (a cada hora) marca a tentativa como `timed_out` e consulta o próximo.
4. **Resposta ambígua**, desde que associada inequivocamente ao pedido (por ID ou resposta direta à mensagem), marca `ambiguous` e consulta o próximo imediatamente. Respostas sem vínculo seguro não mudam pedidos; o timeout cuida da passagem depois.
5. **Sem estoque declarado** marca `unavailable` e consulta o seguinte.
6. **Disponibilidade declarada** interrompe a busca, mas o cliente só pode receber o aviso de preparação após confirmação do fornecedor. O pagamento ao fornecedor continua sujeito a validação manual.
7. Se ninguém confirmar a preparação em até **72 horas**, o sistema marca `deadline_review` e `manual_review`. Mesmo se a fila se esgotar antes, o sistema mantém `waiting_deadline` até o término do prazo.
8. Na revisão de 72 horas, o cliente deve receber desculpas pelo atraso. Envio automático só com consentimento opcional registrado no checkout, configuração correta do WhatsApp e template `BUYER_DELAY_WA_TEMPLATE` aprovado. Caso contrário, o painel marca `needs_manual_contact` e mostra um texto para atendimento humano.
9. Nenhum silêncio ou resposta ambígua é interpretado como prova de falta de estoque. Tampouco se faz cancelamento ou reembolso sem revisão humana.

**Atenção:** o agendador roda de hora em hora. Um limite de 12 horas pode ser processado na execução seguinte, não necessariamente no segundo exato. O prazo de 72 horas é calculado desde a primeira abertura da busca e não é reiniciado ao trocar de fornecedor. Pedidos que já tiverem um fornecedor confirmado não entram na revisão de atraso.

### Mensagem de desculpas para template do WhatsApp

Use a seguinte redação como base para o template aprovado pela Meta, com uma variável de identificação do pedido:

> Pedimos desculpas pela demora na confirmação de disponibilidade do pedido {{1}}. Nossa equipe está verificando as opções e entrará em contato com uma atualização. Agradecemos pela compreensão.

Registre o nome real do template no segredo/configuração `BUYER_DELAY_WA_TEMPLATE`. **O texto no repositório não cria nem aprova o template sozinho.** O número de telefone do cliente só deve receber notificações quando houver autorização explícita. Pedidos anteriores à criação do opt-in requerem atendimento manual se não houver consentimento documentado.

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

**Editar ou excluir fornecedores:** no painel `/suppliers.html`, use **EDITAR** ao lado do contato para mudar o nome, o WhatsApp (com DDI) ou a autorização. Um campo de telefone vazio mantém o número salvo. O ID interno permanece estável para preservar referências.

O botão **EXCLUIR** pede duas confirmações, incluindo digitar exatamente o ID do fornecedor. A operação elimina apenas o cadastro, o contato, a prioridade e os vínculos de produto antigos. **Pedidos, tentativas e histórico de compra não são excluídos.** A exclusão é bloqueada quando o fornecedor está associado a um pedido em andamento. Confirme antes de excluir: telefone e cadastro removidos não são restaurados automaticamente.

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

## Testar a fila antes de liberar o WhatsApp

Abra `/suppliers.html` e carregue os fornecedores com `ADMIN_TOKEN`. A seção **Simulador de consultas de estoque — SEM ENVIO** aparece abaixo das configurações.

1. O simulador considera a ordem atual e apenas fornecedores com telefone e autorização.
2. Escolha uma resposta fictícia para cada fornecedor: **sem estoque**, **disponível**, **não respondeu após 12h** ou **resposta ambígua**.
3. Clique em **SIMULAR CONSULTAS SEM ENVIO** para conferir qual seria a próxima ação.
4. Se o fornecedor afirmar disponibilidade, ainda é necessária confirmação do pedido. Silêncio ou ambiguidade avançam ao próximo; sem confirmação após 72 horas, ocorre revisão manual e aviso de desculpas autorizado.

Essa funcionalidade roda **inteiramente no navegador**: não consulta, não grava e não altera pedidos no D1; não dispara mensagens, pagamento ou testes reais contra Asaas ou Meta. É um ensaio lógico, não uma certificação da integração WhatsApp.

## Prévia dos pedidos

No painel `/admin.html`, clique em **PRÉVIA SEM ENVIO**. A prévia mostra a fila de fornecedores autorizados, apenas os quatro últimos dígitos dos contatos, tentativas de consulta e verificações pendentes. Ela não envia mensagens nem realiza Pix.

## Estado atual — NÃO ATIVAR ENVIOS

- `ASAAS_SANDBOX = "true"`
- `WA_AUTOMATION_ENABLED = "false"`
- A automação de 12h/72h não contata ninguém nem altera o fluxo dos pedidos enquanto o Sandbox ou o WhatsApp desativado estiverem em uso.
- `PAYMENTS_PRODUCTION_ENABLED = "false"`
- O código impede qualquer disparo automático pelo Sandbox, mesmo se uma variável de automação for alterada isoladamente.
- O campo do telefone não envia nenhuma mensagem ao ser salvo e não modifica pedidos antigos.
- Os pagamentos aos fornecedores continuam manuais, com conferência de destinatário e valor.
- A Meta ainda está analisando o portfólio empresarial; é preciso resolver o erro `131031`, validar destinatários e templates, testar webhooks e só depois avaliar uma ativação gradual.

**Não trate a resposta “disponível” como prova de postagem ou entrega.** A confirmação deve ser auditada, e dados do comprador só devem ser enviados ao fornecedor certo quando necessários.
