import {readFile} from 'node:fs/promises';
// Wrangler importa HTML como texto; o Node precisa do mesmo comportamento nos testes.
export async function load(url,context,nextLoad){
 if(url.endsWith('.html'))return {format:'module',shortCircuit:true,source:'export default '+JSON.stringify(await readFile(new URL(url),'utf8'))};
 return nextLoad(url,context);
}
