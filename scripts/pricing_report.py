import csv,json,pathlib
p=pathlib.Path(__file__).resolve().parent
c=json.loads((p/'costs.json').read_text())
with (p/'retail_unit_economics.csv').open('w',encoding='utf-8',newline='') as f:
 w=csv.writer(f);w.writerow(['tipo','compra_USD','frete_estimado_1_peca_USD','custo_produto_mais_frete_BRL','preco_sugerido_BRL','diferenca_antes_tributos_taxas_BRL','margem_bruta_parcial_percentual'])
 for k,usd in c['supplier_usd'].items():
  total=round((usd+c['shipping_usd']['one_piece'])*c['usd_to_brl_reference'],2)
  retail=c['retail_brl'][k];w.writerow([k,usd,4,f'{total:.2f}',f'{retail:.2f}',f'{retail-total:.2f}',f'{100*(retail-total)/retail:.1f}'])
print('Relatório criado',p/'retail_unit_economics.csv')
