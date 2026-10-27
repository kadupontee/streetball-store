# Conferência do pagamento ao fornecedor

O proprietário definiu que o bot não terá teto fixo por pedido ou por dia. O critério é conferir o recebimento, o custo esperado, a cobrança e o resultado de cada pedido. Uma despesa inferior ao preço de venda, isoladamente, não confirma a cobrança correta.

## Implementado nesta etapa

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

## O que falta para iniciar pagamentos automáticos

Os fornecedores não têm uma plataforma comum confirmada. É necessário um exemplo de orçamento e cobrança dos meios efetivamente utilizados para extrair código Pix, valor, recebedor, frete, câmbio e tarifas e vincular essas informações à mensagem do fornecedor e ao pedido. A memória de cálculo desta etapa é fornecida pelo administrador; não foi inventada a partir do preço de venda nem aceita a cobrança como prova do próprio custo esperado.

Ainda não existe disparo automático de Pix ou proteção persistente contra um segundo débito. A conclusão financeira da conferência não muda isso: `pagamentoAutomaticoHabilitado` e `pagamentoIniciado` continuam `false`. Antes de executar saídas, será necessário ligar a origem confiável dos custos, registrar a operação de forma exclusiva, tratar resposta inconclusiva sem repetir o débito e acompanhar o ID da transação até `DONE`. O comprovante só pode ser enviado após essa confirmação. A configuração de autorização de saídas da conta Asaas também precisa ser conferida.

Links desconhecidos não são abertos pelo servidor e nenhum segredo Asaas é enviado a páginas de fornecedores. A loja e a conexão atual continuam operando como antes; esta etapa acrescenta somente a conferência privada.

Referências: [decodificar QR Code](https://docs.asaas.com/reference/decodificar-um-qrcode-para-pagamento), [pagar QR Code](https://docs.asaas.com/reference/pagar-um-qrcode), [consultar transação](https://docs.asaas.com/reference/recuperar-uma-unica-transacao), [consultar cobrança](https://docs.asaas.com/reference/recuperar-uma-unica-cobranca), [consultar saldo](https://docs.asaas.com/reference/recuperar-saldo-da-conta).
