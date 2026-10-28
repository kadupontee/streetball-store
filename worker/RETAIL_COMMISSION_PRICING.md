# Preços para comissão de 25% e cupom de 5%

Reajuste autorizado em 28/10/2026 para preservar pelo menos R$ 10 de sobra por
peça na simulação anterior. A comissão incide sobre o valor dos produtos após
o cupom. Não inclui frete cobrado do comprador.

## Premissas da simulação

- Câmbio de planejamento: R$ 5,30 por USD, sem consulta de cotação atual.
- Compra: tabela `scripts/costs.json`, frete conservador de uma peça de USD 4
  e fator de aquisição de 1,25. Reproduz R$ 99,38 para a torcedor.
- Reservas sobre o valor pago: 4,5% processamento, 6% tributos empresariais,
  3% imprevistos. São premissas históricas, não alíquotas verificadas.
- Desconto do cliente: 5%; comissão: 25%; sobra mínima: R$ 10.
- Não inclui anúncios nem rateio de despesas fixas.

Preço mínimo antes do cupom = (custo estimado + 10) / (0,95 × 0,615).
O resultado é arredondado para cima em preços terminados em R$ 9,90.
As promoções de tabela de 20% continuam apenas na apresentação; a base
desta conta é o preço efetivamente praticado, antes do cupom adicional.

| Tipo | Novo preço | Sobra estimada sem adicionais |
| --- | ---: | ---: |
| Torcedor / feminina | R$ 189,90 | R$ 11,57 |
| Infantil | R$ 209,90 | R$ 10,01 |
| Retrô / jogador Adidas | R$ 249,90 | R$ 13,51 |
| Retrô manga longa | R$ 279,90 | R$ 11,15 |
| Manga longa | R$ 239,90 | R$ 14,28 |
| Jogador Puma | R$ 259,90 | R$ 12,72 |
| Jogador Nike | R$ 269,90 | R$ 11,94 |
| Calção | R$ 179,90 | R$ 12,36 |
| Calção jogador | R$ 199,90 | R$ 10,79 |
| Meião | R$ 149,90 | R$ 14,70 |
| Conjunto | R$ 579,90 | R$ 14,18 |
| Jaqueta | R$ 409,90 | R$ 14,24 |
| Blusa / casaco | R$ 409,90 | Custo de compra não informado |

Para meias e conjuntos foi usado o maior custo da faixa cadastrada. Blusas,
casacos e peças com classificação pendente continuam sem margem confirmada;
o preço comum de blusas/casacos segue a política existente das jaquetas, sem
inventar um custo de compra para essas peças.

Os adicionais passam a R$ 12 para patch/XXL, R$ 23 para 3XL e R$ 35 para
personalização/4XL. Assim, o cupom e a comissão não consomem a sobra mínima
quando o fornecedor cobra os adicionais da tabela atual.

## Aplicação e verificação

O piso vale no catálogo, no editor e na validação do checkout. Correções antigas
de preço no D1 não conseguem cobrar abaixo do novo piso. Preços de camisas
acima do piso são preservados. Uma sacola com política antiga recebe HTTP 409
antes de criar cobrança. Custos e pagamentos do fornecedor não são alterados.

`python scripts/commission_pricing.py` atualiza somente os preços do catálogo
e grava o relatório; `--check` confere pisos e a igualdade JSON/JS. A rotina de
importação também aplica o piso após as revisões de fotos e classificação.
`tests/commission-pricing.test.mjs` verifica as variantes com custo cadastrado
e o valor efetivamente enviado ao provedor de pagamentos, com provedor falso.

O painel de vendas permite cadastrar vendedores, definir apelido, cupom e comissão
de até 25%. O vendedor deve ter uma conta na loja; o acesso financeiro fica
vinculado ao ID dessa conta pelo administrador. O cupom concede 5% no checkout.
A atribuição guarda percentual e comissão de cada pedido; alterações posteriores
não mudam o histórico. Só pagamentos recebidos geram comissão; estornos e
contestações reduzem o saldo. A baixa administrativa apenas registra o pagamento
feito pelo proprietário e não transfere dinheiro. A publicação deve manter a loja,
o banco, as fotos, os pedidos e as configurações de pagamento existentes.

### Gestão dos vendedores — revisão 2

A navegação de `/ops/` contém uma aba Vendedores, com lista completa (inclui zero vendas), ranking por faturamento pago, e-mail, cupom, percentual, comissões acumuladas, pagas e a pagar. O detalhe por vendedor exibe pedidos com percentual e valor congelados no fechamento.

Excluir desativa o vendedor e o cupom e revoga o acesso ao painel. O registro recebe `deleted_at`; pedidos e baixas permanecem disponíveis ao dono em “Mostrar vendedores excluídos”. Editar e salvar um excluído restaura o cadastro. Não apaga a conta de cliente. A coluna é adicionada automaticamente, inclusive em bancos existentes.

Em `/vendedor.html`, o vendedor entra diretamente com e-mail e senha da sua conta da loja. O vínculo é pelo ID da conta; nenhum parâmetro de URL permite selecionar outro vendedor. Quem usa Google pode entrar pela página de conta e voltar ao painel. Cada vendedor precisa ter sua própria conta e ser vinculado pelo administrador.

### Cadastro e aparência — revisão 3

O campo interno do formulário usa `sellerId` e a delegação de envio verifica o formulário pelo seletor, evitando que controles nomeados substituam propriedades nativas como `form.id`. A confirmação de sucesso depende da resposta da gravação e de uma nova consulta que contenha o vendedor. Quando a gravação funciona mas a consulta falha, a tela diferencia as duas situações, remove o formulário já enviado e oferece atualização da lista.

A aba fica em `/ops/?tab=vendedores` e é restaurada após a autenticação; avisos de notificações não cobrem a equipe. O painel usa a paleta da vitrine (cinza, preto e lilás), cartões responsivos, busca por apelido/e-mail/cupom e indicação explícita de vendedores sem vendas. Resumos financeiros incluem o histórico de vendedores excluídos.

`tests/seller-admin-ui.test.mjs` executa os scripts da página em DOM com o Worker e SQLite de teste: cadastro, consulta após reabrir, edição, exclusão/restauração, e-mail inexistente, falha de atualização após gravação e troca entre abas. Como jsdom não implementa LegacyOverrideBuiltIns em formulários, o caso de colisão de `form.id` é modelado explicitamente em um teste.
