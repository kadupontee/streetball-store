# Conferência do pagamento ao fornecedor

O proprietário definiu que o bot não terá teto fixo por pedido ou por dia. O critério é conferir o recebimento, o custo esperado, a cobrança e o resultado de cada pedido. Uma despesa inferior ao preço de venda, isoladamente, não confirma a cobrança correta.

## Recepção de cobranças sem depender de uma plataforma

O conector aceita até 6.000 caracteres por mensagem, preservando códigos Pix que excedem o limite anterior de 400. Registra envelopes privados e imutáveis em `supplier_billing_messages`, com remetente, fornecedor, pedido, totais explícitos, formatos, links e Pix. Textos livres não são executados como instruções.

O bot não precisa de exemplos de cada fornecedor. Um link de qualquer plataforma, boleto, chave Pix ou aviso de foto/PDF/áudio/vídeo pode gerar uma solicitação automática do orçamento e do Pix Copia e Cola por texto, pelo WhatsApp do fornecedor atual autorizado. O arquivo não é baixado nem lido por OCR; anexos recebem esse pedido de texto. O coletor não navega sites externos, preenche cartões nem paga boletos/chaves Pix diretamente. Essa alternativa depende de o fornecedor disponibilizar um Pix Copia e Cola. Há uma única solicitação de identificação e uma de detalhes por pedido e fornecedor, evitando repetições.

Para receber a cobrança para conferência, o fornecedor deve responder à mensagem do pedido ou incluir `COBRANÇA 1234abcd`/`INVOICE 1234abcd`, usando o início correto do ID. Uma mensagem solta pode gerar um pedido de identificação quando houver exatamente um pedido elegível; ela não se torna prova para pagamento. Havendo vários pedidos, a cobrança permanece sem atribuição e aparece no status para revisão. Só entram pedidos de produção com recebimento correspondente, fornecedor autorizado e detalhes efetivamente enviados, inclusive quando o fornecedor já confirmou a preparação.

O Pix precisa ter estrutura e CRC válidos. O total em BRL deve estar explícito, por exemplo `Total BRL: 76,80`; um `$` sem moeda não vira USD por suposição. Códigos múltiplos, divergência entre Pix e orçamento, referência conflitante e dados incompletos não ficam prontos para conferência. A quantia do Pix não preenche um orçamento ausente. Nova mensagem de cobrança invalida a seleção anterior; mensagens separadas não são mescladas silenciosamente. A solicitação orienta o fornecedor a enviar os dados em uma única resposta.

`ready_for_check` significa apenas que o total e o código foram coletados e vinculados. Não confirma custo unitário, frete, câmbio, tarifa, recebedor, aprovação ou pagamento. A prova válida mais recente pode ser usada por até 24 horas, sempre com nova consulta ao banco.

Na pasta `whatsapp-local` do Mac já configurado, `npm run preparar-cobrancas` aplica a migração adicional, publica, confirma a versão recebida e reinicia o serviço existente. Não troca chaves, não altera a configuração privada e não ativa saídas de dinheiro. `npm run status-cobrancas` informa disponibilidade, fila e pendências sem expor código Pix, links ou documento do recebedor. Não repita o instalador antigo de Sandbox.

## Conferência financeira

`POST /api/admin/supplier-payment-check`, protegido pelo mesmo token administrativo, faz uma conferência **somente de leitura**. Não inicia Pix, altera pedidos, reserva saldo, envia mensagens ou declara o fornecedor pago. O resultado não constitui autorização de pagamento.

A consulta exige pedido de produção com recebimento registrado, fornecedor atual autorizado e detalhes do pedido já enviados. Faz apenas três operações no Asaas de produção:

- `GET /payments/{id}`: compara ID, referência, valor bruto, situação `RECEIVED`, estornos e valor líquido real.
- `POST /pix/qrCodes/decode`: confere o código, o total cobrado, a disponibilidade e o documento completo do recebedor.
- `GET /finance/balance`: confere disponibilidade para o Pix e a tarifa informada.

A memória de cálculo identifica cada produto e quantidade e exige custo unitário em USD, frete em USD, câmbio, tarifa da plataforma, tarifa do Pix e outros custos. Valores ausentes não viram zero automaticamente. O custo unitário deve incluir os adicionais daquela linha, como tamanho, patch e personalização. A conversão usa inteiros e arredonda o total para centavos uma única vez.

A cotação em BRL precisa coincidir com o custo calculado e com o Pix. O valor líquido recebido precisa cobrir o fornecedor, a tarifa de saída e os outros custos informados, com resultado positivo. Esse resultado representa a diferença após os custos informados; não deve ser chamado de lucro líquido caso ainda faltem tributos ou despesas.

## Contrato de entrada

Exemplo fictício, sem credenciais e sem código Pix válido:

```json
{
  "orderId": "1234abcd-1234-4234-8234-123456789012",
  "quotedTotalBrl": "76.80",
  "receiverCpfCnpj": "DOCUMENTO_COMPLETO_CONFERIDO",
  "pixPayload": "CODIGO_PIX_COPIA_E_COLA",
  "costs": {
    "items": [{"productId": "product-example", "qty": 1, "unitUsd": "11.00"}],
    "freightUsd": "4.00",
    "exchangeRateBrlPerUsd": "5.12",
    "gatewayFeeBrl": "0.00",
    "pixFeeBrl": "1.99",
    "otherCostsBrl": "5.00"
  }
}
```

As linhas de custo seguem a mesma ordem dos itens gravados no pedido. Decimais usam ponto, sem símbolo de moeda. A taxa de câmbio aceita até seis casas decimais. A resposta omite chave de API, código Pix e documento do recebedor.

Para usar evidência registrada, envie `billingId` no lugar de `pixPayload` e `quotedTotalBrl`, mantendo `orderId`, `receiverCpfCnpj` e a memória de custo independente em `costs`. O servidor lê a cobrança imutável, verifica que ela ainda é a última, confere idade, fornecedor e autorização atuais e recusa substituições de código/valor feitas pelo cliente. Valores e instruções enviados pelo próprio fornecedor não viram a referência confiável de custo esperado ou de recebedor.

## O que falta para iniciar pagamentos automáticos

A recepção e o pedido de padronização já são independentes de ByteMax ou de exemplos de plataformas. A memória de cálculo da conferência ainda é fornecida pelo administrador. Falta uma referência de custos, adicionais, frete, câmbio, tarifas e recebedores autorizados que seja confiável para cada fornecedor. O histórico de preços de um fornecedor não foi aplicado aos outros quatro por suposição. O preço de venda comum de R$ 379,80 também não estabelece o custo de compra das blusas/casacos.

Ainda não existe disparo automático de Pix ou proteção persistente contra um segundo débito. A conclusão financeira da conferência não muda isso: `pagamentoAutomaticoHabilitado` e `pagamentoIniciado` continuam `false`. Antes de executar saídas, será necessário ligar a origem confiável dos custos, registrar a operação de forma exclusiva, tratar resposta inconclusiva sem repetir o débito e acompanhar o ID da transação até `DONE`. O comprovante só pode ser enviado após essa confirmação. A configuração de autorização de saídas da conta Asaas também precisa ser conferida.

Links desconhecidos não são abertos pelo servidor e nenhum segredo Asaas é enviado a páginas de fornecedores. Esta entrega acrescenta recepção privada, solicitação de detalhes pelo transporte existente e seleção da cobrança para conferência, sem executar pagamentos.

Referências: [decodificar QR Code](https://docs.asaas.com/reference/decodificar-um-qrcode-para-pagamento), [pagar QR Code](https://docs.asaas.com/reference/pagar-um-qrcode), [consultar transação](https://docs.asaas.com/reference/recuperar-uma-unica-transacao), [consultar cobrança](https://docs.asaas.com/reference/recuperar-uma-unica-cobranca), [consultar saldo](https://docs.asaas.com/reference/recuperar-saldo-da-conta).
