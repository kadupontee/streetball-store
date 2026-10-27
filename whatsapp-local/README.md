# Streetball — conectar o WhatsApp secundário no Mac

Alternativa local: vincular o número por QR code, guardar a sessão no Mac, testar uma mensagem na conversa do próprio número, manter a conexão em segundo plano e validar a ligação com o site. Não depende da conclusão da verificação empresarial da Meta.

**Estado desta entrega:** conexão local, pedidos/fotos, respostas vinculadas, avisos consentidos e executor Pix com tabela de compra compartilhada pelos cinco fornecedores. A operação da loja já foi liberada pelo proprietário; novos pagamentos ao fornecedor vêm desligados e têm preparação e ativação próprias, descritas na seção 10. Instalar/publicar o código não declara um Pix pago nem conclui a configuração de saídas da conta Asaas.

As etapas de instalação e preparação abaixo descrevem a fase anterior em Sandbox. Os instaladores `integrar-loja`/`integrar-pedidos` e os comandos `configurar-asaas`/`preparar-producao` exigem essa configuração anterior e não devem ser repetidos para liberar a configuração atual.

Baileys é um cliente não oficial do WhatsApp Web. Há risco de bloqueio do número; não há garantia de disponibilidade para operação comercial. Esta versão está fixada na versão publicada `7.0.0-rc14` (pré-lançamento). A alternativa oficial continua sendo a Meta Cloud API.

## 1. Preparar o número e instalar

O número secundário precisa estar ativo no aplicativo WhatsApp ou WhatsApp Business do celular. Não é preciso compartilhar o número, códigos de SMS ou arquivos da sessão no chat.

No Terminal, dentro desta pasta `whatsapp-local`, use Node.js 20 ou mais recente:

```bash
node --version
npm ci
npm run conectar
```

No celular, selecione a conta do **número secundário**, abra **Configurações > Aparelhos conectados > Conectar aparelho** e leia o QR code mostrado no Terminal. Uma desconexão seguida de reconexão logo após a leitura é esperada. Aguarde `Conectado`: a sessão local será salva antes dessa confirmação.

## 2. Testar somente na própria conta

No Terminal da conexão, pressione **Control+C**. Em seguida:

```bash
npm run testar
```

O teste envia uma única mensagem de texto para a conversa do próprio número autenticado e encerra. Não existe opção para escolher outro destinatário. Confira a mensagem no celular. Este teste valida conexão e envio; não valida a compra ou o atendimento aos fornecedores.

## 3. Rodar em segundo plano

Depois que o teste encerrar:

```bash
npm run iniciar
npm run status
```

O serviço usa `launchd`, inicia no login, reconecta quando a internet volta e reinicia se o processo falhar. Uma sessão revogada ou substituída interrompe o serviço para permitir correção manual. Aguarde alguns segundos para o estado passar de `starting`/`reconnecting` para `connected`.

O Mac deve permanecer **ligado, conectado à internet e sem entrar em repouso**. Bloquear a tela não é desligar o computador. Fechar a tampa normalmente coloca o Mac em repouso. Este pacote não muda configurações de energia; `launchd` não impede repouso. A ligação não significa que o processamento de pedidos esteja funcionando.

```bash
npm run logs
npm run parar
```

Pare o segundo plano antes de usar `conectar` ou `testar`: a trava local impede duas conexões concorrentes.

Se `status` mostrar `ativo: false` e `sessaoSalva: true`, reinicie aproveitando a sessão existente:

```bash
npm run reiniciar
```

O comando aguarda até 35 segundos pela confirmação de que o processo conectado é o serviço cadastrado no macOS. Se não conectar, apresenta o estado do serviço e o último código de saída. Também é possível conferir esses dados sem reiniciar:

```bash
npm run diagnostico
```

O diagnóstico não exibe a chave privada nem o conteúdo das credenciais. Um registro do serviço no macOS não é confirmação de conexão: `iniciar` e `integrar-loja` agora aguardam a conexão antes de indicar que está pronta.

O início habilita apenas o serviço `com.streetball.whatsapp`, confere se ele permaneceu carregado e solicita a execução quando necessário. O reinício aguarda a remoção do registro anterior e preserva o arquivo de inicialização e a sessão. Se o macOS remover o serviço logo após aceitar o carregamento, o comando informa essa falha imediatamente.

O campo `servicoDoMac.desativado` indica a política de execução desse serviço: `true` é desativado, `false` é permitido pelo `launchctl`, e `null` indica que a consulta não foi concluída. Se a execução continuar bloqueada pelo macOS, confira **Ajustes do Sistema > Geral > Itens de Início e Extensões**, na seção de atividade em segundo plano. Os nomes podem variar conforme a versão do sistema. [Orientação da Apple](https://support.apple.com/pt-br/guide/mac-help/mtusr003/mac).

Para continuar o teste com o Terminal aberto, use `npm run parar` e `npm run conectar`. Deixe essa aba aberta e use **Command + T** para abrir outra aba na mesma pasta. Nela, execute `npm run simular-pedido` e `npm run status-pedidos`. Antes de voltar ao segundo plano, encerre a conexão da primeira aba com **Control + C** e execute `npm run iniciar` na segunda.

## Sessão e recuperação

A sessão fica em `~/Library/Application Support/Streetball WhatsApp/auth`, com permissões restritas, fora do repositório. Não envie essa pasta ao GitHub ou para outras pessoas: ela permite acesso à conta vinculada. O serviço não registra conteúdo de conversas nem imprime QR code no log do segundo plano.

Se o número foi desconectado no celular ou a autenticação ficou inválida:

```bash
npm run parar
npm run desvincular
npm run conectar
```

`desvincular` apaga apenas a sessão local e exige uma nova leitura de QR code. Para revogar o aparelho no WhatsApp, remova-o em **Aparelhos conectados** no celular.

Se o Node.js ou a pasta deste pacote mudar de lugar, execute `npm run parar` e depois `npm run iniciar` na nova localização. O `launchd` utiliza caminhos absolutos.

## 4. Validar a ligação com o site

Com a conta já vinculada, execute no mesmo Mac:

```bash
npm run integrar-loja
```

O comando aplica as migrações aditivas da ponte, gera uma chave privada, cadastra essa chave como segredo do Worker e publica a versão do projeto desta pasta. Usa sua autenticação existente do Wrangler/Cloudflare; se o Cloudflare pedir login, conclua o acesso na sua própria conta. A chave fica fora do Git e não é impressa nem precisa ser enviada no chat. O comando reinicia a conexão em segundo plano depois da implantação.

Quando `npm run status` mostrar `connected`:

```bash
npm run testar-loja
npm run status-loja
```

Em poucos segundos, uma mensagem identificada como teste deve chegar à conversa do próprio número. `status-loja` deve mostrar `online: true` e, após a confirmação, `latest.state: "sent"`. Esse teste percorre site → fila no D1 → Mac → WhatsApp → confirmação no site. Ele confirma o envio aceito pelo WhatsApp; confira a chegada no celular.

O teste simples usa somente a conta secundária vinculada e uma mensagem fixa. O transporte de pedidos reais tem liberação separada, descrita abaixo. A ligação não abre portas públicas no Mac. Uma reserva expirada antes do início pode ser retomada; um envio iniciado sem confirmação fica `uncertain` e não é repetido automaticamente. As confirmações são guardadas em um histórico privado local para permitir retomar após uma queda de conexão.

Se a implantação parar, confira o erro informado pelo Wrangler e execute `npm run integrar-loja` novamente. Se o WhatsApp estiver conectado mas a ponte estiver aguardando, use `npm run status-loja` e `npm run logs`.

## 5. Testar uma consulta com foto e resposta

```bash
npm run integrar-pedidos
npm run simular-pedido
```

A foto e os dados fictícios chegam somente à própria conta secundária. No celular, use **Responder** na foto e escreva `sim`. Depois execute `npm run status-loja`: o campo `orderBridge.latestPreview.reply.kind` deve mostrar `available`.

As consultas reais exigem liberação de produção no Worker e ativação separada no Mac. Consulte `worker/LOCAL_WHATSAPP_ORDERS.md` para o fluxo e os limites. O instalador não converte pagamentos simulados em compras reais.

## 6. Preparar a chave Asaas de produção

Com a conta real do Asaas aprovada, crie uma chave em **Integrações > Chaves de API**. Nesta pasta:

```bash
npm run configurar-asaas
```

O comando verifica se o projeto e a loja publicada continuam em Sandbox e pede que a chave seja colada diretamente no campo de segredo do Wrangler. Ela será cadastrada no Worker como `ASAAS_PRODUCTION_API_KEY`, preservando a chave atual de testes. Não cole a chave no chat ou em comandos de shell.

Esta etapa prepara uma credencial. A configuração do webhook real e as definições comerciais continuam necessárias antes da liberação de vendas. O conector em segundo plano pode permanecer ativo durante o cadastro. Veja `worker/SETUP.md`, passo 5.

## 7. Publicar o cadastro e conferir a preparação

Depois de cadastrar a chave e o token de produção:

```bash
npm run preparar-producao
```

O comando publica a versão desta pasta com o cadastro público do vendedor, frete grátis, prazo e contato definidos. Exige que a configuração local e a loja publicada ainda estejam em Sandbox e preserva as variáveis de liberação existentes. Não reinicia o conector.

Após publicar, o Mac usa a ponte privada já vinculada para solicitar uma consulta somente de leitura ao Asaas: aprovação da conta, correspondência do CNPJ e configuração do webhook. A chave real permanece no Worker. O relatório traz verificações e pendências, sem valores financeiros, dados bancários privados ou credenciais.

Para repetir apenas a consulta, sem publicar novamente:

```bash
npm run status-producao
```

O cadastro do vendedor fica em `public/merchant.json`, no rodapé e no resumo do checkout. A verificação do CNPJ valida formato e correspondência com a conta; não é uma avaliação de CNAEs ou do enquadramento fiscal. O relatório mantém essa revisão separada. A correspondência entre o token salvo e o token do webhook ainda requer a validação de um evento recebido. Durante a preparação, os pagamentos reais desligados são uma pendência esperada.

Quando uma consulta falha, os resultados que dependem dela ficam `null` (não verificados). Isso não significa reprovação da conta nem ausência do webhook. O bloco `consultasAsaas` informa o status HTTP, códigos conhecidos de autenticação e o tipo da falha, distinguindo recusa de acesso, rede, timeout, redirecionamento ou resposta inesperada. Não inclui descrições brutas, URLs de redirecionamento ou valores de credenciais. Redirecionamentos não são seguidos.

## 8. Liberar vendas reais pelo número secundário

Com a conta e o webhook conferidos e a operação comercial confirmada pelo proprietário, atualize a mesma pasta no Mac vinculado:

```bash
git pull --ff-only origin codex/whatsapp-secundario-local-20261026
npm run liberar-vendas
```

O comando confere as credenciais e a configuração da conta real pelo Worker, verifica a fila de pedidos, habilita o transporte local e reinicia o serviço com a sessão salva. A publicação só começa depois que o WhatsApp está conectado e a loja confirma a presença do Mac. Ao terminar, o comando verifica checkout real, frete grátis, configuração de importação e encaminhamento de pedidos. Não solicita outro QR code se a sessão continua válida. Não cria uma cobrança de teste.

O resultado confirmado mostra `ambienteAtivo: "producao"`, `checkoutAtivo: true`, `whatsappOnline: true` e `encaminhamentoPedidosAtivo: true`. Se a etapa falhar, o comando encerra com erro e não informa que as vendas foram liberadas. Uma publicação pode ter sido concluída mesmo que uma conferência posterior falhe; confira o estado antes de repetir:

```bash
npm run status-producao
npm run status-loja
npm run status-pedidos
```

Somente pedidos de produção com cobrança recebida correspondente entram no encaminhamento. Os testes antigos permanecem como testes. A confirmação do token do webhook exige o primeiro evento real recebido. Acompanhe o pagamento no Asaas e o pedido na loja para conferir esse percurso.

O Mac deve permanecer ligado, com internet e sem repouso. Para parar somente o encaminhamento local, use `npm run desativar-pedidos`; esse comando não desativa o checkout nem cancela cobranças. O pagamento ao fornecedor continua manual até a preparação e a ativação da seção 10. Os reembolsos continuam sob operação manual.

## 9. Receber cobranças de fornecedores com formatos diferentes

Depois de atualizar esta branch, na mesma pasta `whatsapp-local` do Mac:

```bash
npm run preparar-cobrancas
npm run status-cobrancas
```

O primeiro comando aplica a tabela adicional, publica o Worker, confere a versão e reinicia a conexão já salva. Não repita os instaladores antigos de Sandbox. Não altera chaves ou as opções do checkout e não libera débitos automáticos.

O conector passa a preservar textos de até 6.000 caracteres. Ao receber um link de outra plataforma, chave Pix, boleto ou aviso de anexo, o bot pode solicitar ao fornecedor o orçamento detalhado e o Pix Copia e Cola por texto. Anexos não são baixados nem lidos; sites externos não são navegados. O fornecedor deve responder à mensagem do pedido ou indicar `COBRANÇA`/`INVOICE` e os primeiros oito caracteres do pedido. Sem referência exata, a cobrança não pode ser usada para pagamento. O bot evita repetir o mesmo pedido de detalhes.

`status-cobrancas` mostra a recepção, `costTable` com a tabela comum confirmada e `payouts` com o executor. `ready_for_check` representa total e Pix coletados para conferência, não pagamento concluído. Novos pedidos guardam a referência de compra em USD antes da cobrança; alterações do catálogo não mudam esse custo. Pedidos antigos sem referência e produtos sem custo exato ficam para conferência. A conferência seleciona a cobrança por `billingId` e preenche itens/frete pelo servidor.

## 10. Preparar o pagamento automático ao fornecedor

```bash
npm run preparar-pagamentos-fornecedores
npm run status-pagamentos-fornecedores
```

O comando aplica a migração, publica o código, confirma a tabela dos fornecedores e prepara uma chave específica de autorização. O token é guardado em arquivo privado e copiado para a área de transferência, sem aparecer no Terminal. No Asaas, em **Menu do usuário > Integrações > Mecanismos de segurança**, cadastre a URL mostrada, o e-mail `contato@streetball.com.br` e cole o token. O validador atende somente aos Pix registrados pelo bot; não atende outras modalidades nem operações opcionais pela interface.

A instalação inicial mantém débitos desligados. Quando houver uma cobrança real com Pix e custo conhecido, cadastre o recebedor e a regra financeira:

```bash
npm run configurar-pagamento-fornecedor
```

O cadastro consulta o recebedor no banco e não solicita Pix. Escolha câmbio fixo conferido ou a cotação explicitamente declarada em cada cobrança. No segundo modo, o bot confere USD, conversão, tarifas e resultado positivo, sem comparar com uma taxa de mercado. Informe despesas e validade reais; campos ausentes não viram zero.

Com o mecanismo de segurança salvo no Asaas e um perfil vigente, a ativação permite processar cobranças elegíveis presentes e futuras:

```bash
npm run ativar-pagamentos-fornecedores
npm run status-pagamentos-fornecedores
```

O executor registra uma intenção exclusiva por pedido, consulta recebimento/saldo/tarifas e não repete um POST inconclusivo. Só marca pagamento após consulta separada confirmar `DONE`, valor e recebedor. Depois, envia o link oficial do comprovante pelo transporte existente. O status distingue envio solicitado, conclusão no banco, tarifa/resultado reais e comprovante enfileirado/enviado. Não há teto fixo por pedido/dia definido no bot.

Para parar novos envios, use `npm run desativar-pagamentos-fornecedores`. Isso não desfaz um Pix já solicitado ou concluído. Repetir a preparação preserva uma ativação anterior e o histórico exclusivo. Consulte `worker/SUPPLIER_PAYMENTS.md` para as condições completas.

Um pedido já registrado como pago manualmente fica protegido contra pagamento automático, mesmo se chegar outra cobrança. Se uma tentativa perdeu a resposta do Asaas, use `npm run conferir-pix-pendente` com o ID da intenção mostrado no status e o ID correspondente na conta. O comando só consulta essa transação e exige a referência exclusiva, valor e recebedor; não solicita outro Pix. Com o executor já habilitado, uma atualização de perfil pode liberar cobranças que aguardavam esses dados.

## Validação local

```bash
npm test
```

Os testes usam sockets simulados: não conectam ao WhatsApp nem enviam mensagens reais. A conexão real e o serviço do macOS devem ser validados no Mac após a leitura do QR code.

Se o envio do token foi confirmado pela Cloudflare mas a consulta imediata ainda não o encontrou, a preparação tenta novamente a confirmação. Para retomar sem migrar, publicar ou enviar o segredo outra vez, use `npm run concluir-preparacao-pagamentos` no Mac original. O comando preserva a chave privada já salva, consulta a loja e só a copia para a área de transferência depois da confirmação. Também pode ser usado para copiar a mesma chave novamente ao preencher o formulário do Asaas. Não habilita pagamentos.
