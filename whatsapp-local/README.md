# Streetball — conectar o WhatsApp secundário no Mac

Primeira etapa da alternativa local: vincular o número por QR code, guardar a sessão no Mac, testar uma mensagem na conversa do próprio número e manter a conexão em segundo plano. Não depende da conclusão da verificação empresarial da Meta.

**Estado desta entrega:** conexão e teste local. Ainda não consulta pedidos do D1, não envia mensagens a fornecedores/clientes, não processa respostas e não faz pagamentos. A integração dos pedidos será a próxima etapa depois de confirmar a conexão. As configurações do site e os bloqueios de produção permanecem como estão.

Baileys é um cliente não oficial do WhatsApp Web. Há risco de bloqueio do número; não há garantia de disponibilidade para operação comercial. Esta versão está fixada na versão publicada `7.0.0-rc14` (pré-lançamento). A alternativa oficial continua sendo a Meta Cloud API.

## 1. Preparar o número e instalar

O número secundário precisa estar ativo no aplicativo WhatsApp ou WhatsApp Business do celular. Não é preciso compartilhar o número, códigos de SMS ou arquivos da sessão no chat.

No Terminal, dentro desta pasta `whatsapp-local`, use Node.js 20 ou mais recente:

```bash
node --version
npm ci
npm run conectar
```

No celular, selecione a conta do **número secundário**, abra **Configurações > Aparelhos conectados > Conectar aparelho** e leia o QR code mostrado no Terminal. Uma desconexão seguida de reconexão logo após a leitura é esperada. Aguarde `Conectado`.

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

## Validação

```bash
npm test
```

Os testes usam sockets simulados: não conectam ao WhatsApp nem enviam mensagens reais. A conexão real e o serviço do macOS devem ser validados no Mac após a leitura do QR code.
