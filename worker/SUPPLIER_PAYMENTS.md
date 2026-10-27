# Cobranças e pagamentos aos fornecedores

O proprietário confirmou que a tabela de compra em USD vale para os cinco fornecedores cadastrados. O bot não impõe teto por pedido nem por dia. Cada saída depende do recebimento real do cliente, da referência de compra, da cobrança, do recebedor autorizado, do saldo e de resultado positivo após as despesas informadas.

O executor está implementado e vem desligado. Preparar/publicar o código não habilita débitos. A ativação e os perfis financeiros são operações separadas pelo conector privado do Mac. Os testes usam respostas simuladas; não são prova de uma transferência real.

## Tabela compartilhada e referência do pedido

`scripts/costs.json` é a fonte de compra, com a política `shared-usd-20261027-v1`. O cadastro inicial registra os IDs dos fornecedores existentes; não estende essa aprovação silenciosamente a fornecedores adicionados depois. A autorização atual do contato continua obrigatória para cada cobrança e cada saída.

Os tipos de preço exato usam a tabela: Fan/feminina US$ 11, infantil US$ 13, retrô US$ 16, retrô manga longa US$ 19, manga longa US$ 15, jogador Adidas/Puma/Nike US$ 16/17/18, calção comum/jogador US$ 10/12 e jaqueta US$ 30. Soma por unidade: personalização US$ 3, patch US$ 1 e XXL/3XL/4XL US$ 1/2/3. O frete de referência é total do pedido: uma peça US$ 4, duas US$ 3, três ou mais US$ 0. A oferta de cinco Fan soma US$ 55 e a de dez Fan US$ 105, antes dos adicionais. A aplicação da oferta a pedidos com várias linhas/modelos fica para conferência; o transporte atual também preserva revisão para vários modelos.

Custos em faixa (meião/conjunto), blusa/casaco sem custo exato informado e classificações incertas não viram um valor inventado. O varejo comum de R$ 379,80 das jaquetas, blusas e casacos não estabelece o custo de compra desses três tipos.

O checkout registra uma referência privada em `supplier_order_cost_references`, com os tipos validados no servidor, quantidade, tamanhos, adicionais e totais em USD. Edições posteriores do catálogo não alteram esse registro. A referência não aparece no JSON dos itens do comprador. Se a tabela adicional estiver ausente, o checkout continua disponível e o pagamento ao fornecedor fica sem referência suficiente; não se recompõe automaticamente o custo de uma compra antiga a partir do catálogo atual.

## Receber formatos diferentes

O conector aceita até 6.000 caracteres, preservando Pix maiores que o limite antigo de 400. Mensagens de cobrança são evidência privada e imutável em `supplier_billing_messages`. Links de qualquer plataforma, chaves Pix, boletos e avisos de foto/PDF/áudio/vídeo podem gerar um pedido do orçamento e do Pix Copia e Cola por texto ao fornecedor autorizado. Não depende de exemplos de ByteMax ou de outro site. Anexos não são baixados nem lidos por OCR; sites não são navegados e cartões/boletos não são pagos por este executor. A alternativa depende de o fornecedor disponibilizar o código Pix.

A cobrança precisa responder à mensagem exata ou incluir `COBRANÇA 1234abcd`/`INVOICE 1234abcd`. Mensagens soltas podem receber um pedido de identificação quando há um único pedido elegível. Havendo vários, ficam sem atribuição para revisão. Recebe cobranças antes ou depois da confirmação de preparação, com detalhes enviados, pedido de produção e recebimento correspondente.

Estrutura e CRC do Pix são conferidos antes da consulta ao banco. Moeda e total precisam estar explícitos; `$` não vira USD por suposição. Códigos múltiplos, totais/cotações conflitantes e divergência entre orçamento e Pix ficam pendentes. Não se misturam mensagens separadas nem se reaproveita uma seleção anterior depois de uma nova cobrança. `ready_for_check` significa dados coletados para conferência, não pagamento concluído.

O câmbio pode ser informado como `Câmbio BRL por USD: 5,12`, `Exchange rate: 5.12` ou `USD/BRL: 5.12`. O total em USD deve incluir produtos, adicionais e frete. O sistema não deduz câmbio dividindo o Pix pelo custo esperado. Dados da mensagem são dados, não instruções para mudar a política financeira.

## Conferência de leitura

`POST /api/admin/supplier-payment-check`, com token administrativo, continua somente de leitura: não solicita Pix, grava pedidos, reserva saldo ou envia comprovantes. Consulta a cobrança em `GET /payments/{id}`, o código em `POST /pix/qrCodes/decode` e o saldo em `GET /finance/balance`.

Com `billingId`, o auditor exige a cobrança atual, dentro da validade, fornecedor/telefone autorizados e a referência privada do checkout. Preenche os custos dos itens e o frete pela tabela compartilhada; recusa tentativas de substituí-los. Se o orçamento declara total em USD ou câmbio, esses valores também precisam coincidir com a referência e com o cálculo. Câmbio, tarifa da plataforma, tarifa do Pix, outros custos e documento esperado do recebedor são dados financeiros independentes, nunca zeros presumidos.

Exemplo fictício da conferência de uma cobrança já registrada:

```json
{
  "orderId": "1234abcd-1234-4234-8234-123456789012",
  "billingId": "sb_REFERENCIA_REGISTRADA",
  "receiverCpfCnpj": "DOCUMENTO_CONFERIDO",
  "costs": {
    "exchangeRateBrlPerUsd": "5.12",
    "gatewayFeeBrl": "0.00",
    "pixFeeBrl": "1.99",
    "otherCostsBrl": "5.00"
  }
}
```

A forma anterior, sem `billingId`, permanece como calculadora administrativa com memória de custo informada pelo administrador. Seu resultado é identificado como tal e não é entrada do executor automático. `GET /api/admin/supplier-cost-reference?orderId=...` lê a referência privada, sem alterações ou chamadas ao Asaas.

## Perfis financeiros e autorização

Cada fornecedor precisa de perfil vigente: recebedor, regra de câmbio, tarifa da plataforma, outras despesas por pedido/unidade, despesas proporcionais à venda e validade. O cadastro pela cobrança faz uma consulta ao Asaas, mostra nome/documento mascarado e vincula a confirmação ao recebedor lido no banco. Uma alteração de recebedor entre prévia e cadastro é recusada. Perfis usam revisão para duas sessões não sobrescreverem uma à outra.

Há duas regras de câmbio, escolhidas explicitamente pelo operador:

- `fixed`: usa uma taxa conferida no perfil. Cobrança ou taxa declarada divergente não passa.
- `supplier_quote`: aceita a cotação oferecida pelo fornecedor naquela cobrança, com total USD e taxa explícitos. Confere os custos USD aprovados, a aritmética da conversão, as tarifas, o Pix, o saldo e o resultado positivo. Não compara essa cotação com uma taxa de mercado. Não existe seleção automática desse modo quando uma taxa fixa diverge.

O Asaas informa o líquido recebido. Não se soma novamente a tarifa de recebimento. O executor consulta `/myAccount/fees/` e reserva conservadoramente a tarifa de envio Pix retornada, sem presumir gratuidade pela cota mensal. Depois da conclusão, registra a tarifa efetivamente cobrada e o resultado após os custos cadastrados; esse resultado não deve ser chamado de lucro líquido se faltarem despesas ou tributos.

A conta de produção e o CNPJ são conferidos ao ativar. O mecanismo de segurança do Asaas usa um token específico em `asaas-access-token` e a URL `/api/webhooks/asaas/supplier-payout-authorization`. O validador só aprova `PIX_QR_CODE` registrado pelo próprio executor, com ID, valor, recebedor, referência atual, autorização do fornecedor, perfil vigente e recebimento ainda conferidos. Outras modalidades não são aprovadas. Essa opção do Asaas abrange operações por API; não habilite outras modalidades/interface para este validador sem tratamento correspondente.

## Execução e confirmação

O executor acompanha o conector local e a rotina agendada. Novos envios exigem ativação, token preparado, perfil vigente e WhatsApp presente. Uma ausência do Mac não causa reenvio. Consultas de transações já solicitadas continuam na rotina agendada quando a configuração está disponível.

Cada ciclo trata uma operação financeira: uma confirmação pendente, um comprovante pendente ou uma nova cobrança. A confirmação tem prioridade. A verificação automatizada percorre o ciclo real de consulta do conector e mantém envio e confirmação abaixo de 50 subconsultas, incluindo banco e D1. Esse orçamento de requisições não é um limite monetário por pedido ou por dia.

Antes do `POST /pix/qrCodes/pay`, grava intenção exclusiva por pedido em `supplier_payout_intents` e reserva o valor e a tarifa. Uma trava serializa o processamento; reservas pendentes são descontadas do saldo disponível para outras intenções. Não inventa uma chave de idempotência que esse endpoint não documenta. A mesma ordem nunca gera outro POST automático, mesmo com nova cobrança, alteração de perfil, timeout ou reinício. Uma tentativa inconclusiva fica `unknown`; recusas/cancelamentos também não criam uma nova tentativa automaticamente. São casos para conferir no Asaas.

Pagamentos manuais registrados em `supplier_jobs` são preservados na migração por `supplier_paid_order_records`. Novos registros administrativos também criam essa proteção permanente: uma cobrança tardia ou uma mudança posterior de status não tornam o pedido pagável novamente. Se já existe tentativa bancária inconclusiva, o registro de um pagamento manual é recusado até a conferência dessa tentativa.

A descrição do Pix contém a referência exclusiva da intenção. Se a resposta do envio se perder, o webhook pode recuperar o ID somente depois de uma consulta ao Asaas comprovar a mesma descrição, valor e recebedor. O ID também pode ser informado com `npm run conferir-pix-pendente`; o comando consulta a transação existente, exige a mesma comprovação e nunca solicita outro Pix. Se não houver comprovação suficiente, conserva a pendência para conferência na conta.

A resposta inicial nunca marca `paid`, mesmo que diga `DONE`. Uma consulta posterior em `/pix/transactions/{id}` precisa confirmar `DONE`, débito comum, valor e recebedor correspondentes. Documentos mascarados no retorno só são aceitos quando consistentes com o documento completo que já foi conferido antes do envio e com o ID exato da operação. O banco não é autorizado por valor ou documento isolados.

O webhook revalida o recebimento e as autorizações antes de responder `APPROVED`. Se a conta recusou/cancelou, registra o estado. Se o banco concluiu sem autorização registrada, com tarifa diferente, resultado não positivo ou recebimento não conferido, preserva o fato de que houve pagamento e desativa novas saídas para conferência. Não cria outro débito para corrigir a diferença.

Somente depois de `DONE` validado, enfileira o link oficial do comprovante Asaas para o fornecedor atual autorizado. A fila usa chave estável e mantém envios incertos para revisão. `receiptQueued` representa fila criada; `receiptSent` representa envio aceito pelo WhatsApp, não leitura pelo destinatário. O pagamento ao fornecedor não confirma por si só a preparação do pedido pelo fornecedor.

## Preparação no Mac

Na pasta `whatsapp-local`, depois de atualizar a branch:

```bash
npm run preparar-pagamentos-fornecedores
npm run status-pagamentos-fornecedores
```

A preparação inclui a migração aditiva, a publicação e a confirmação da tabela compartilhada. Guarda o token de autorização fora do repositório, em arquivo privado, envia-o ao Wrangler por stdin e o copia para a área de transferência do Mac. Não imprime o token no Terminal. Não troca os segredos de produção/Sandbox e não habilita pagamentos na instalação inicial. Repetir a preparação preserva a mesma chave e uma ativação anterior, se existir.

No Asaas, em **Menu do usuário > Integrações > Mecanismos de segurança**, cadastre a URL mostrada pelo comando, o e-mail `contato@streetball.com.br` e cole o token copiado. O usuário faz essa configuração na própria conta. O comando não simula que a configuração do banco foi concluída.

Quando chegar a primeira cobrança válida com referência de compra:

```bash
npm run configurar-pagamento-fornecedor
```

Confira o recebedor mostrado e cadastre os dados financeiros reais. Com o mecanismo do Asaas salvo e ao menos um perfil vigente:

```bash
npm run ativar-pagamentos-fornecedores
npm run status-pagamentos-fornecedores
```

A ativação permite processar automaticamente as cobranças elegíveis presentes e futuras. Para desativar novos envios:

```bash
npm run desativar-pagamentos-fornecedores
```

Desativar não desfaz um Pix já solicitado ou concluído. O estado continua disponível para acompanhamento e transações já conhecidas não são enviadas novamente. Nenhum comando de diagnóstico cria cobrança de cliente ou pagamento de teste.

Para vincular uma transação que não retornou ID ao conector, tenha o ID da intenção mostrado no status e o ID correspondente no Asaas:

```bash
npm run conferir-pix-pendente
```

O comando não cria uma nova tentativa. Se o executor já está habilitado, atualizar um perfil pode tornar elegíveis cobranças que estavam aguardando esses dados; desative novos envios antes de revisar uma política que não deve entrar em operação imediatamente.

Referências oficiais: [pagar QR Code](https://docs.asaas.com/reference/pagar-um-qrcode), [consultar transação](https://docs.asaas.com/reference/recuperar-uma-unica-transacao), [decodificar QR Code](https://docs.asaas.com/reference/decodificar-um-qrcode-para-pagamento), [taxas da conta](https://docs.asaas.com/reference/recuperar-taxas-da-conta), [mecanismo de autorização](https://docs.asaas.com/docs/mecanismo-para-validacao-de-saque-via-webhooks).
