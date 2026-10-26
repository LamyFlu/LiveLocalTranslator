// Pin the browser-compatible LiteRT model separately from MLC model libraries.
import {readFile,writeFile} from 'node:fs/promises';
export async function prepareGemma12(){
 const file='gemma-4-12B-it-gpu.litertlm',repo='litert-community/gemma-4-12B-it-litert-lm',revision='7a0b1ce0ea821bcd01c5f72af84155e02191152f';
 const model={id:'gemma-4-12B',engine:'gemma12',backend:'litert',title:'Gemma 4 12B · Q4 · 品質優先',provider:'Google',repo,revision,file,vramMB:7700,bytes:5986074624,qualityNote:'官方 Chrome 約 7.7GB GPU 記憶體（Mac 測試），本機需另留 Whisper 與影片空間。較大不保證低延遲。',files:[{path:file,bytes:5986074624,sha256:'fba0ea417fda0eecdcc1e62e0ea7777acf44f171cefb3bc05a642746f39faf39',url:`https://huggingface.co/${repo}/resolve/${revision}/${file}`}]};
 const catalog=JSON.parse(await readFile('public/model-catalog.json','utf8'));catalog.models=[model,...catalog.models.filter(m=>!['mlc-gemma9','gemma12'].includes(m.engine))];
 await writeFile('public/model-catalog.json',JSON.stringify(catalog,null,2));
 await writeFile('src/model-catalog.js','// Generated from the pinned official model catalog.\nexport const largeModels='+JSON.stringify(catalog.models.map(({files,librarySha256,librarySource,repo,revision,requiredFeatures,...m})=>m),null,2)+';\nexport function largeModel(engine){return largeModels.find(m=>m.engine===engine);}\n');
}
if(process.argv[1]?.endsWith('prepare-gemma12.mjs'))await prepareGemma12();
