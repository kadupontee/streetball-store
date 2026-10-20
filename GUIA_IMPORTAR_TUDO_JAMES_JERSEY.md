# Streetball Store — importar todos os álbuns do James Jersey

## Antes de começar

A busca pública de 20/10/2026 indicava **11.184 álbuns em 94 páginas** de `https://james66jersey.x.yupoo.com/categories`. Esse número pode variar. O total só será confirmado após a coleta das páginas diretamente no seu computador. Um álbum vira um produto, com ID estável `YUP-<número>`, título, categoria, preço sugerido, URL original e **todas as fotos públicas identificadas** (até 200 por álbum). Nem todo álbum é de camisa; alguns são de acessórios, conjuntos ou artigos variados e exigem revisão de preço/tamanho.

O ambiente em que este pacote foi desenvolvido **não conseguiu acessar diretamente o Yupoo**. Portanto **os 11.184 produtos e suas fotografias NÃO estão importados de verdade dentro deste ZIP**. Este pacote é um importador pronto para rodar no Mac, quando o fornecedor estiver acessível, com retomada após interrupções. Não contorna proteção por senha, restrições de acesso ou CAPTCHA.

### Mac: sem editar código

1. Extraia o ZIP para `Downloads`, mantendo a pasta `streetball-store`.
2. Clique duas vezes em `Instalar_Importador_Mac.command`. Se o macOS bloquear a execução, abra pelo botão direito > Abrir, depois autorize a execução; ele instala dependências no `.venv` dentro da pasta da loja. Requer Python 3 e internet.
3. Clique duas vezes em `Abrir_Painel_Mac.command` e mantenha o Terminal aberto.
4. Abra `http://127.0.0.1:8000/catalog-manager.html`.
5. Use **IMPORTAR TODO O CATÁLOGO + FOTOS**. Ele percorre as páginas públicas e depois as fotos. Se quiser cadastrar os nomes e capas primeiro, use **IMPORTAR TODOS OS MODELOS PRIMEIRO**. Você pode executar o botão de fotos depois; a ferramenta não duplica os produtos.
6. Veja o acompanhamento no painel: páginas indexadas, álbuns identificados, galerias concluídas, protegidos e erros.

**Importante:** quando o computador dormir, o Terminal fechar ou o fornecedor bloquear acesso, o processo para. Execute o mesmo botão depois e o importador retoma a partir do checkpoint. Não é possível prometer que todas as fotos ficarão disponíveis, pois algumas podem ser privadas, removidas ou bloquearem links externos.

### Executar pelo Terminal (alternativa)

Na pasta `streetball-store`, depois da instalação:

```bash
.venv/bin/python scripts/import_yupoo.py --max-pages 94 --refresh-index --index-only
.venv/bin/python scripts/import_yupoo.py --max-pages 94 --max-albums 0 --pause 1.5
```

`--max-albums 0` tenta todas as galerias **ainda não concluídas**, sem prazo fixo. Para lotes menores, use `--max-albums 100`. Para captar títulos novos, use `--refresh-index`. Para atualizar as fotos de galerias já concluídas use `--refresh`, sabendo que uma execução limitada começará pelas primeiras galerias.

### Como o catálogo é armazenado

- `scripts/yupoo_album_index.json`: índice de álbuns visitados, com links de origem e capa quando recuperada.
- `scripts/yupoo_import_checkpoint.json`: páginas indexadas, álbuns com fotos concluídas, erros e protegidos.
- `public/catalog.json`: todos os produtos da loja.
- `public/catalog.js`: cópia do catálogo para visualização sem backend.

IDs são baseados no número do álbum para evitar duplicação. Preços e categorias bloqueados manualmente são preservados. Imagens enviadas pelo painel não são substituídas automaticamente.

### Atualização sem intervenção pelo GitHub

1. Publique o projeto em um repositório GitHub com permissão de escrita para Actions.
2. Obtenha autorização escrita do fornecedor para reproduzir as fotos na loja. Configure a **variável de repositório** `JAMES_IMAGES_AUTHORIZED=true` apenas após essa autorização.
3. Habilite Actions. O workflow `Importar catálogo James Jersey` executa automaticamente, em geral diariamente, consultando as 94 páginas públicas e até 100 galerias pendentes por rodada. Um acervo tão grande pode precisar de muitas execuções. Também é possível iniciar manualmente pela aba Actions.
4. Garanta que as alterações do GitHub sejam publicadas na sua hospedagem (não acontece automaticamente em hospedagens desconectadas).

### Limitações comerciais importantes

- O Yupoo é um catálogo visual, não comprova estoque nem confirma tamanhos e preço final.
- Os preços iniciais da Streetball Store são **estimativas por tipo de produto**, não preços informados no álbum. Revise especialmente outros produtos, conjuntos, calçados e acessórios.
- Fotos vinculadas externamente (`photo.yupoo.com`) podem falhar ao carregar na sua loja por restrições de hotlink. Nesse caso é necessária solução de imagens autorizadas em sua própria hospedagem/CDN.
- Não use imagens, nomes de marcas ou uniformes de terceiros sem as permissões aplicáveis, nem anuncie como produtos oficiais sem comprovação.
- O checkout e o fluxo de pedidos ao fornecedor ainda dependem de integração e confirmação operacional. Faça validação de produtos e pagamentos antes de vender.
