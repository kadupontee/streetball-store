# Avisos de venda e acompanhamento no iPhone

Na pasta `whatsapp-local` do Mac autenticado, execute `npm run preparar-notificacoes` após atualizar a branch `codex/whatsapp-secundario-local-20261026`. O comando publica com `--keep-vars`; não muda credenciais Asaas, libera pagamentos, altera catálogo, reinicia o bot nem modifica as autorizações financeiras. A primeira entrada administrativa cria apenas tabelas novas de notificações e uma chave VAPID privada no D1. Essa chave não é publicada no navegador, no GitHub ou em logs.

1. Abra `https://lojastreetball.com.br/ops/` no Safari do iPhone (iOS 16.4 ou posterior).
2. Compartilhar → Adicionar à Tela de Início. Abra pelo novo ícone Streetball.
3. Entre com a mesma chave administrativa usada no painel. Ela é enviada por HTTPS, permanece fora de URLs e não é gravada no armazenamento do navegador.
4. Ative as notificações e permita os avisos no iPhone.
5. Use **Enviar teste para este aparelho**. Toque na notificação para conferir a abertura.

O acesso salvo é uma sessão privada, em cookie Secure/HttpOnly/SameSite, com validade de 180 dias e permissões limitadas à consulta de vendas e aos avisos do próprio aparelho. Não dá acesso a pagamentos ou às operações administrativas existentes. Sair desativa os avisos daquele aparelho e encerra a sessão. Os dados dos pedidos não são guardados para acesso offline.

## Venda e entrega do aviso

Os webhooks autenticados e validados `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` registram uma única venda por pedido. O primeiro evento gera o aviso aos aparelhos já inscritos; o segundo atualiza o acompanhamento sem repetir o aviso. O modo Sandbox não dispara avisos reais. A função de teste é explícita e identificada como teste.

A entrega usa Web Push com criptografia aes128gcm e autenticação VAPID. O pedido e a inscrição têm uma chave única na fila persistente. Falhas temporárias mantêm a entrega pendente, com repetição em uma rotina própria a cada cinco minutos, sem executar os fluxos financeiros nesse agendamento. Um envio interrompido pode ser repetido; a mesma tag do pedido substitui o aviso no aparelho. Inscrições expiradas (HTTP 404/410) são desativadas. Uma resposta aceita pelo serviço push não comprova que o usuário leu ou viu a notificação. Preferências de alertas, internet e Foco do iOS continuam valendo. O serviço push pode guardar a mensagem por até 24 horas.

O aviso contém somente a referência curta do pedido. Ao tocar, abre `/ops/?orderId=...`, sem segredo na URL. O painel consulta os dados autenticados atuais e atualiza a cada 20 segundos enquanto está visível, além de atualizar ao voltar para ele. Uma falha de rede mantém a última consulta identificada com data e aviso.

## O que cada status comprova

- **Pagamento do cliente:** confirmação e recebimento são mostrados separadamente. `CONFIRMED` não libera o fornecedor antes de `RECEIVED`.
- **Consulta ao fornecedor:** a fila do Mac fica como aguardando envio. A confirmação de envio usa o registro do conector; não implica leitura.
- **Pedido ao fornecedor:** os dados e fotos só aparecem como enviados após a confirmação de todos os envios do grupo.
- **Confirmação do fornecedor:** usa a confirmação reconhecida pelo fluxo de pedidos.
- **Pagamento ao fornecedor:** uma intenção, cobrança ou autorização não significa pagamento concluído. O Pix automático só aparece como pago com estado `paid` e `bank_status=DONE` do executor existente. Um registro manual é identificado como manual. O link de comprovante só é exibido para pagamento automático confirmado e domínio Asaas HTTPS.
- **Envio e entrega:** mostram os eventos de rastreamento verificados existentes, sem inferir postagem a partir de uma conversa.

Os avisos rodam no Cloudflare, independentemente do Mac. O envio WhatsApp pelo conector local ainda exige o Mac conectado; o acompanhamento informa quando o sinal recente do conector está ausente. Este recurso não ativa nem muda o executor Pix.
