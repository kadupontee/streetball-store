# Streetball Store — atualização automática das imagens usando outras fontes

**Versão 3 • 20/10/2026**

## O que já está implementado

1. Pesquisa automática de fotos e páginas de produto em sites conhecidos, com prioridade às referências verificadas da Nike e adidas. Configuração: `scripts/official_image_sources.json`.
2. Comparação estrita do clube, temporada, kit I/II/III, versão (quando identificada), feminino e infantil. Diferenças ficam fora da vitrine.
3. Busca experimental por páginas de produto em outros domínios confiáveis (Nike, adidas, New Balance, Netshoes, FutFanatics e Centauro) através de RSS público, sem API paga. Esse serviço NÃO garante resultados nem disponibilidade constante; erros aparecem no relatório.
4. Consulta automática às páginas encontradas para extrair imagens estruturadas JSON-LD (`Product.image`) e `og:image`. Quando o HTML é carregado só via Javascript, pode não retornar fotos.
5. Fila de correspondências e motivos de falha em `scripts/official_image_candidates.json`. O painel local mostra os links e os resultados.
6. Agenda diária em `.github/workflows/sync-official-images.yml`. Depois da publicação no GitHub e habilitação do Actions, roda automaticamente e faz commit do relatório.
7. Os preços, IDs e categorias originais NÃO são recalculados. Não substitui fotos enviadas manualmente.

## Acesse sem importar nada manualmente

Abra o painel no seu computador:

```bash
cd streetball-store
python scripts/catalog_server.py
```

Acesse `http://127.0.0.1:8000/catalog-manager.html`, vá a **04 / Fotos de outras lojas**, pressione **BUSCAR FOTOS**, espere a execução e clique **VER RESULTADOS**. Clique na fonte de cada produto para ver a página original. O relatório é produzido automaticamente; não é necessário preencher CSV ou links de cada camisa.

Também é possível usar diretamente:

```bash
python scripts/sync_official_images.py --discover --max-products 49
```

Somente para verificar as fontes cadastradas sem rede:

```bash
python scripts/sync_official_images.py --no-fetch
```

## Atualização automática no GitHub

Publique o repositório e habilite **Actions**. O arquivo `sync-official-images.yml` programa uma execução diária às 10:35 no horário de Brasília (sujeita a atrasos do GitHub). Por padrão, a rotina **encontra e registra fotos**, mas não importa nenhuma imagem de terceiros para a vitrine sem autorização.

Para permitir o uso COMERCIAL de imagens de determinado site, você precisa de autorização/licença que inclua utilização na sua loja, e de confirmação de que a foto retrata o mesmo produto/versão que o comprador receberá. Não assuma que a foto do fabricante é igual ao uniforme fornecido por outra empresa.

Somente depois de verificar as duas condições, configure nas **Variables** do repositório:

- `IMAGE_LICENSE_CONFIRMED`: `true`
- `AUTHORIZED_IMAGE_DOMAINS`: lista de domínios licenciados, separada por vírgulas, por exemplo `nike.com.br`
- `APPROVED_PRODUCT_IMAGE_IDS`: IDs dos produtos cuja correspondência física foi comprovada, separados por vírgula, por exemplo `SB-0003,SB-0006`

**Atenção:** configurar essas variáveis é uma declaração de autorização do responsável pela loja, não uma licença concedida pelo site. As fotos de clubes e marcas têm direitos de propriedade intelectual; verifique também seu direito de vender e anunciar os produtos.

## Referências de uniformes encontradas em 20/10/2026

| Produto da loja | Modelo encontrado | Loja | Página |
|---|---|---|---|
| SB-0003 | Brasil I 2026/27 Fã Masculina | Nike | https://www.nike.com.br/camisa-brasil-nike-i-2026-27-fa-masculina-098437.html?cor=00 |
| SB-0004 | Brasil II 2026/27 Jogador Masculina (Jordan) | Nike | https://www.nike.com.br/camisa-brasil-jordan-ii-2026-27-jogador-masculina-097619.html |
| SB-0005 | Real Madrid I 26/27 torcedor | adidas | https://www.adidas.com.br/camisa-i-real-madrid-26-27/JZ7206.html |
| SB-0006 | Corinthians I 26/27 Fã Masculina | Nike | https://www.nike.com.br/camisa-corinthians-nike-i-2026-27-fa-masculina-110130.html |
| SB-0010 | Corinthians II 26/27 Jogador Masculina | Nike | https://www.nike.com.br/camisa-corinthians-nike-ii-2026-27-jogador-masculina-103996.html |
| SB-0023 | Barcelona I 26/27 Torcedor Pro Masculina | Nike | https://www.nike.com.br/camisa-barcelona-nike-i-2026-27-torcedor-pro-masculina-110158.html |
| SB-0039 | Brasil I 2026/27 Fã Feminina | Nike | https://www.nike.com.br/camisa-brasil-nike-i-2026-27-fa-feminina-098715.html?cor=00 |
| SB-0042 | Real Madrid I 26/27 Infantil | adidas | https://www.adidas.com.br/camisa-i-real-madrid-26-27-infantil/KC3993.html |

Existem ainda páginas de listagem de referência, não importadas como fotos por não serem páginas de produto específicas (ex.: Flamengo I 25/26 na adidas). O programa tenta localizar o produto exato quando a busca externa estiver acessível.

## Limites

- O acesso externo HTTP foi bloqueado no ambiente em que esta versão foi preparada. Por isso, as oito páginas acima foram verificadas por consulta web, e **não foram baixadas ou vinculadas às fotos reais** agora. O relatório inicial traz as oito referências, sem imagens.
- Sem licença de imagem e confirmação do produto exato, não é seguro usar fotos de outra loja em publicidade de uma camisa fornecida por terceiros. As referências podem ser usadas para conferência e pesquisa.
- A busca via RSS é best-effort. Algumas lojas bloqueiam robôs ou mudam a marcação de suas páginas; a automação registra erro e preserva o catálogo anterior.
- A etapa de busca de imagens não verifica estoque nem autoriza mostrar “disponível” no site. Os fornecedores continuam precisando confirmar cada pedido.
- Não conectei ou publiquei o repositório na sua conta GitHub. Os arquivos estão prontos para publicação, mas o agendamento não está ativo ainda.

## Testes incluídos

```bash
python scripts/test_catalog.py
python scripts/test_official_images.py
```

Ambos usam testes locais, sem rede. Isso garante as verificações de texto, não garante disponibilidade das páginas externas no dia da execução.
