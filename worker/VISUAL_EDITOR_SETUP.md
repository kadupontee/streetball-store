# Editor visual da Streetball Store

O editor abre em `https://lojastreetball.com.br/editor.html` e também pode ser acessado pelo botão **Abrir editor visual da loja** no painel de operações. Use o mesmo `ADMIN_TOKEN` do painel de fornecedores. A chave fica somente na aba; não aparece no iframe, no catálogo, no histórico ou no arquivo exportado.

## Instalação

Dentro do repositório da loja, atualize e publique:

```bash
git pull --ff-only origin main && npx wrangler deploy --keep-vars
```

Se o Git avisar sobre alterações locais, preserve essas alterações antes de atualizar. O Worker, o banco e as configurações atuais são reutilizados. A tabela `store_editor_versions` é criada de forma aditiva no primeiro acesso administrativo autenticado. Ela também está incluída em `worker/schema.sql`; não é necessário reaplicar todo o schema para habilitar o editor.

## Uso

1. Abra o editor e informe a chave administrativa.
2. Em **Selecionar**, clique em um produto ou texto da própria vitrine. Em **Navegar**, teste buscas, categorias, detalhes e sacola. A prévia não envia pedidos nem gera cobranças.
3. Na aba **Produtos**, busque em todo o catálogo por nome ou referência. Corrija nome, preço base em reais, categoria, tipo e visibilidade. Use **Aplicar na prévia**.
4. Na aba **Layout**, ajuste cores, colunas para computador/celular, espaçamento, cantos, enquadramento, dimensões do banner, textos e ordem/visibilidade das seções. O catálogo de produtos permanece visível.
5. Use **Computador** e **Celular** para conferir o resultado. As setas superiores desfazem e refazem alterações do rascunho.
6. Clique em **Publicar alterações** para aplicar na loja. Não é necessário outro deploy para cada edição feita pelo painel.

O preço editado é o preço base. Tamanhos extras, patches e personalização mantêm os acréscimos atuais. Cada correção fica vinculada ao ID do produto no D1 e tem prioridade sobre a classificação e o preço do arquivo importado. O checkout aplica a mesma correção. Se uma publicação acontecer enquanto um cliente estiver com uma sacola de uma versão anterior, ele receberá um pedido para atualizar a página e conferir o preço antes de gerar uma cobrança.

## Rascunhos, versões e recuperação

- Rascunhos ficam no navegador onde foram editados, sem a chave administrativa. **Exportar rascunho** baixa uma cópia JSON; **Importar** abre uma cópia para revisão.
- **Histórico** lista as vinte versões publicadas mais recentes, além da opção de dados originais. Uma restauração abre como rascunho e só chega à loja ao publicar. Versões anteriores não são apagadas ao restaurar.
- **Voltar ao publicado** desfaz o rascunho atual e permite usar Desfazer para recuperá-lo na mesma sessão.
- Se outra aba publicar primeiro, a gravação é recusada com conflito em vez de sobrescrever a versão da outra aba. Exporte seu rascunho, recarregue o editor e revise o conteúdo importado antes de publicar novamente.
- As correções acompanham o ID estável; uma peça removida do arquivo importado não é recriada pelo editor.

## Limites desta versão

Editor de seções e estilos previstos da vitrine, não um construtor livre de HTML. Não altera configurações de pagamentos, contas de clientes, impostos ou automações. Não adiciona novos produtos, não faz upload de fotos e não edita páginas de conta ou checkout. A prévia usa a própria página da loja com o mesmo catálogo e seus estilos. Há até 12.000 referências corrigidas por estado e limite de 1,4 MB por versão validada; o painel avisa se um arquivo ultrapassar esse limite.

## Validação

Com Node 24:

```bash
npm run test:editor
```

Os testes usam SQLite em memória e chamadas Asaas simuladas, verificando persistência, concorrência, histórico, autorização, proteção de origem, preço final, bloqueio de sacolas antigas e produtos ocultos. Nenhum pagamento ou mensagem real é enviado.
