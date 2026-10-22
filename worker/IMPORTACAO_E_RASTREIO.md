# Streetball Store — impostos, acompanhamento e Correios (outubro de 2026)

## Regime tributário real

Fonte principal: Receita Federal, seção de tributação de encomendas internacionais, atualizada em setembro de 2026.

- Remessa Conforme (PRC) com compra elegível de pessoa física em plataforma certificada: Imposto de Importação (II) federal **0%** até US$ 50; acima disso, **60% do valor aduaneiro menos US$ 30**. Mesmo até US$ 50 o **ICMS de 17% a 20%** permanece.
- Fora do PRC ou compra por pessoa jurídica: **II de 60% desde US$ 0,01**, além do ICMS. **Não aplicar isenção geral de US$ 50** ao dropshipping direto via fornecedor WhatsApp.
- Base: valor real do produto + frete + seguro. ICMS por dentro: (base + II) × taxa / (1 − taxa).
- Não dividir artificialmente uma venda em remessas para evitar tributos nem pedir subdeclaração ao fornecedor. Não assumir que um link de AliExpress transforma a venda em PRC.
- A Receita esclarece que importação de bens destinados à revenda por remessa internacional é permitida **por pessoa jurídica, cumpridas condições**, com documentos em nome do CNPJ. Obter orientação tributária e contratual antes de vender com envio direto ao CPF do comprador.
- A estimativa local em `/imports.html` usa USD e faixa selecionável de ICMS (17–20%). Não inclui despacho postal, outras taxas ou o câmbio definitivo. Não cobra nada.

Fontes oficiais:
- https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/manuais/remessas-postal-e-expressa/topicos/tributacao
- https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/manuais/remessas-postal-e-expressa/topicos/declaracao
- https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/manuais/remessas-postal-e-expressa/calculadora-de-impostos-portal-aduana-e-comercio-exterior

## Quem paga, quando e como

- Fora do PRC, eventuais II, ICMS e serviço Despacho Postal devem ser verificados e pagos no **Minhas Importações** ou aplicativo oficial dos Correios (ou no ambiente da transportadora, se courier).
- Correios informam prazo geral de **20 dias corridos** desde a disponibilização da cobrança, não desde a saída da China e não desde o evento cadastrado no painel da loja.
- O status `tax_payment_due` apenas informa a necessidade de verificar o canal oficial. O sistema **não gera Pix, não efetua pagamento, nem inventa prazo individual**.
- Se o destinatário discordar da tributação, a revisão deve ser solicitada no ambiente oficial, antes da emissão do boleto ou pagamento, dentro do prazo aplicável.
- Definir e divulgar por escrito quem assume tributos inesperados antes de ativar vendas reais; conferir com contador/assessoria jurídica.

Fonte: https://www.correios.com.br/receber/encomenda/internacional

## Rastreamento e mensagens

- O fornecedor informa código e transportadora após postagem, e o operador confere o dado. No painel `/admin.html`, clicar em **ACOMPANHAMENTO**, registrar etapa, origem conferida e código (obrigatório nas etapas de transporte).
- `order_tracking_events` mantém eventos confirmados; `order_tracking_meta` guarda transportadora e código. Nenhum evento é extraído automaticamente dos Correios nesta fase.
- O cliente recebe um link privado `/track.html#<uuid>.<assinatura>`, disponível se `TRACKING_LINK_SECRET` estiver configurado (segredo distinto do `ADMIN_TOKEN`). Link também fica no navegador do comprador após checkout e o operador pode copiá-lo no painel.
- A chave de acesso é assinada por HMAC e a página retorna só o identificador curto, status do pagamento, etapas, código e transportadora. Não retorna CPF, telefone, nome ou endereço.
- O cliente pode acessar a página e ver as atualizações registradas. **Não há notificação automática por WhatsApp ou e-mail por novo evento nesta fase.** Quando a Meta liberar e templates/opt-in estiverem configurados, podemos acrescentar notificações sem alterar a consulta ao portal.
- API oficial Rastro dos Correios tem restrições de contrato/remetente e credenciais; não usar scraping/CAPTCHA como API, nem afirmar status oficial sem integração autorizada.
- O link deve ser tratado como privado e compartilhado apenas com o comprador correspondente.

Fontes:
- https://www.correios.com.br/central-de-informacoes/boletim-aos-clientes/correios-aprimoram-ciberseguranca-para-rastreamento-de-pacotes
- https://www.correios.com.br/atendimento/developers/

## Publicação, ainda sem produção

Na máquina de trabalho:

```bash
cd ~/Downloads/streetball-store
git pull
npx wrangler d1 export streetball-db --remote --output=../streetball-backup-acompanhamento.sql
npx wrangler d1 execute streetball-db --remote --file=worker/schema.sql
npm test
openssl rand -hex 32 | npx wrangler secret put TRACKING_LINK_SECRET
npx wrangler deploy
```

Não compartilhe ou comite o backup nem o segredo. Se o comando para adicionar segredo falhar, execute `npx wrangler secret put TRACKING_LINK_SECRET` e cole um valor aleatório de pelo menos 32 caracteres. A migração usa `CREATE TABLE IF NOT EXISTS`, não remove os fornecedores nem os pedidos anteriores.

Confirmar ao final:
- `/admin.html` — registrar um marco de um pedido Sandbox com o checkbox de evidência.
- `/track.html` — abrir pelo link privado gerado no painel, sem dados pessoais.
- `/imports.html` — comparar com a calculadora oficial da Receita, sem assumir PRC.
- `WA_AUTOMATION_ENABLED = "false"`, `ASAAS_SANDBOX = "true"`, `PAYMENTS_PRODUCTION_ENABLED = "false"` continuam iguais.

Não liberar pedidos reais sem solução tributária/contratual, orçamento de frete e logística, integridade do catálogo e validação dos meios de pagamento.
