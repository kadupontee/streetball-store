# Pedidos pelo WhatsApp secundário no Mac

O conector agora transporta consultas com foto, detalhes após a confirmação de estoque, respostas vinculadas à consulta e avisos consentidos ao comprador. O Worker mantém a prioridade dos contatos autorizados no D1, 12 horas por fornecedor e limite total de 72 horas.

## Instalar e testar foto e resposta

No Mac já vinculado, dentro de `whatsapp-local`:

```bash
npm run integrar-pedidos
npm run simular-pedido
```

O instalador aplica as migrações aditivas, publica o projeto e reinicia o serviço com a sessão existente. A simulação usa uma foto de referência da loja e envia uma consulta fictícia **somente à própria conta secundária**. Não cria uma venda ou cobrança nem consulta fornecedores reais.

No celular, use **Responder** na foto do teste e escreva `sim`. Depois:

```bash
npm run status-loja
```

O resultado esperado é `orderBridge.latestPreview.state: "sent"` e `orderBridge.latestPreview.reply.kind: "available"`. Uma resposta sem citar a foto não identifica a consulta. Mensagens antigas, grupos e conversas sem vínculo não são encaminhados para o site.

## Operação real

A configuração entregue continua em Sandbox e com pedidos reais desativados. O instalador não libera pagamentos de produção nem muda as declarações de importação. Após concluir a configuração comercial já prevista para a loja, o Worker exige `ASAAS_SANDBOX="false"`, `PAYMENTS_PRODUCTION_ENABLED="true"`, `SALES_ENABLED="true"`, `CUSTOMER_PAYS_IMPORT_TAXES="true"`, `IMPORT_TAX_DISCLOSURE_APPROVED="true"`, `IMPORT_COMPLIANCE_APPROVED="true"`, `WA_AUTOMATION_ENABLED="true"`, `WA_TRANSPORT="local"` e `WA_LOCAL_ORDERS_ENABLED="true"`.

Somente pedidos novos com ambiente de pagamento registrado como produção e cobrança correspondente confirmada pelo evento `PAYMENT_RECEIVED` podem ser encaminhados. Pedidos antigos sem registro de ambiente e pagamentos simulados não são convertidos em pedidos reais ao trocar a configuração.

Depois que o Worker indicar que a produção está habilitada, o operador ativa também o Mac:

```bash
npm run ativar-pedidos
```

Esse comando verifica a configuração do Worker antes de ativar o transporte local. Para interromper o transporte de pedidos, mantendo os testes disponíveis:

```bash
npm run desativar-pedidos
```

## Comportamento e limites

- A consulta inicial inclui a foto, tamanho, quantidade, personalização, patch e cidade/país. Nome, CPF e endereço completo não entram nessa consulta. A quantidade comprada nunca é ampliada para obter frete grátis.
- Um pedido com vários modelos permanece em revisão manual, conforme o fluxo existente. Uma única foto não representa modelos diferentes.
- A fila só usa o fornecedor atual, com telefone autorizado no D1. A autorização e o estado do pedido são conferidos novamente imediatamente antes do envio. Um pedido reembolsado ou disputado não autoriza novos envios.
- O prazo de resposta começa quando o envio da consulta é confirmado. O comprador só é avisado após o consentimento registrado para aquele pedido.
- Respostas curtas exigem vínculo com a mensagem da consulta. Preços, links de pagamento, `ok`, dúvidas e comprovantes não são confirmações automáticas de estoque ou de pagamento.
- A fila e o estado de encaminhamento são gravados juntos. Um envio iniciado sem confirmação fica em revisão e não é repetido automaticamente. Confirmações perdidas durante uma queda são retomadas pelo histórico privado local.
- O pagamento ao fornecedor continua manual. O conector não abre links de cobrança, faz Pix ou gera comprovantes.
- O Mac precisa ficar ligado, com internet e sem repouso. A integração usa Baileys, não oficial, com risco de bloqueio.

Os históricos locais de pedidos e respostas ficam na mesma pasta privada da sessão, fora do Git. A API recebe apenas respostas novas relacionadas às mensagens enviadas pelo conector e guarda a classificação, sem reproduzir o texto do fornecedor nos logs públicos.
