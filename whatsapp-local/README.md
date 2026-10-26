# Streetball — conectar o WhatsApp secundário no Mac

Alternativa local: vincular o número por QR code, guardar a sessão no Mac, testar uma mensagem na conversa do próprio número, manter a conexão em segundo plano e validar a ligação com o site. Não depende da conclusão da verificação empresarial da Meta.

**Estado desta entrega:** conexão local e ponte de teste entre Cloudflare/D1 e o Mac. Ainda não consulta pedidos do D1, não envia mensagens a fornecedores/clientes, não processa respostas e não faz pagamentos. A integração dos pedidos será a próxima etapa depois de confirmar a ponte. O instalador verifica que Asaas Sandbox está ativo e os pagamentos/automação de produção estão desligados.

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

O comando cria somente as duas tabelas de teste da ponte, gera uma chave privada, cadastra essa chave como segredo do Worker e publica a versão do projeto desta pasta. Usa sua autenticação existente do Wrangler/Cloudflare; se o Cloudflare pedir login, conclua o acesso na sua própria conta. A chave fica fora do Git e não é impressa nem precisa ser enviada no chat. O comando reinicia a conexão em segundo plano depois da implantação.

Quando `npm run status` mostrar `connected`:

```bash
npm run testar-loja
npm run status-loja
```

Em poucos segundos, uma mensagem identificada como teste deve chegar à conversa do próprio número. `status-loja` deve mostrar `online: true` e, após a confirmação, `latest.state: "sent"`. Esse teste percorre site → fila no D1 → Mac → WhatsApp → confirmação no site. Ele confirma o envio aceito pelo WhatsApp; confira a chegada no celular.

A ponte só aceita a conta secundária vinculada e mensagens fixas de teste, sem campos para destinatário ou texto livre. Ela não abre portas públicas no Mac. Uma reserva expirada antes do início pode ser retomada; um envio iniciado sem confirmação fica `uncertain` e não é repetido automaticamente. As confirmações são guardadas em um histórico privado local para permitir retomar após uma queda de conexão.

Se a implantação parar, confira o erro informado pelo Wrangler e execute `npm run integrar-loja` novamente. Se o WhatsApp estiver conectado mas a ponte estiver aguardando, use `npm run status-loja` e `npm run logs`.

## Validação

```bash
npm test
```

Os testes usam sockets simulados: não conectam ao WhatsApp nem enviam mensagens reais. A conexão real e o serviço do macOS devem ser validados no Mac após a leitura do QR code.
