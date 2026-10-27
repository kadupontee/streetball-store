# Streetball — conectar o WhatsApp secundário no Mac

Alternativa local: vincular o número por QR code, guardar a sessão no Mac, testar uma mensagem na conversa do próprio número, manter a conexão em segundo plano e validar a ligação com o site. Não depende da conclusão da verificação empresarial da Meta.

**Estado desta entrega:** conexão local, fila de pedidos, envio de fotos, leitura de respostas vinculadas e avisos consentidos ao comprador. A operação real permanece desligada na configuração entregue. O pagamento ao fornecedor continua manual. O instalador verifica que Asaas Sandbox está ativo e os pagamentos/automação de produção estão desligados.

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

## Validação local

```bash
npm test
```

Os testes usam sockets simulados: não conectam ao WhatsApp nem enviam mensagens reais. A conexão real e o serviço do macOS devem ser validados no Mac após a leitura do QR code.
