import {build} from 'esbuild';
import {mkdir, cp, readdir, writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
await mkdir('dist', {recursive:true});
await cp('public','dist',{recursive:true});
const manifest=JSON.parse(await readFile('dist/manifest.json','utf8'));manifest.key=(await readFile('installer/extension-key.txt','utf8')).trim();await writeFile('dist/manifest.json',JSON.stringify(manifest,null,2));
await build({entryPoints:['background','popup','options','offscreen','asr-worker','webllm-worker'].map(n=>`src/${n}.js`),outdir:'dist',bundle:true,format:'esm',platform:'browser',target:'chrome120',define:{'process.env.NODE_ENV':'"production"'},logLevel:'info'});
await build({entryPoints:['src/youtube.js','src/subtitle.js'],outdir:'dist',bundle:true,format:'iife',platform:'browser',target:'chrome120',logLevel:'info'});
// LiteRT's loader uses importScripts: it requires a classic worker.
await build({entryPoints:['src/translation-worker.js'],outdir:'dist',bundle:true,format:'iife',platform:'browser',target:'chrome120',logLevel:'info'});
// Every executable runtime is shipped locally, including WebAssembly.
const roots = await readdir('node_modules/.pnpm');
for (const dir of ['node_modules/onnxruntime-web/dist']) {
  for (const file of await readdir(dir)) if (/\.(wasm|mjs)$/.test(file)) await cp(path.join(dir,file),path.join('dist',file));
}
await mkdir('dist/vad',{recursive:true});await cp('node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx','dist/vad/silero-v5.onnx');
await cp('node_modules/@litert-lm/core','dist/litert',{recursive:true,dereference:true});
await build({entryPoints:['src/audio-worklet.js'],outdir:'dist',bundle:true,format:'esm',platform:'browser',target:'chrome120',logLevel:'info'});
await cp('LICENSE','dist/LICENSE');
await cp('NOTICE.md','dist/NOTICE.md');
await cp('README.zh-TW.md','dist/README.zh-TW.md');
await cp('YOUTUBE.zh-TW.md','dist/YOUTUBE.zh-TW.md');
await cp('POWER.zh-TW.md','dist/POWER.zh-TW.md');
await cp('VERIFICATION.zh-TW.md','dist/VERIFICATION.zh-TW.md');
await cp('example-glossary.json','dist/example-glossary.json');
await cp('TranslationGateway-LICENSE.txt','dist/TranslationGateway-LICENSE.txt');
// Preserve dependency notices alongside distributable JS/WASM.
const notices=[];
for(const root of roots){
  const base=path.join('node_modules/.pnpm',root,'node_modules');
  let names;try{names=await readdir(base);}catch{continue;}
  for(const name of names){
    const candidates=name.startsWith('@')?(await readdir(path.join(base,name))).map(n=>path.join(base,name,n)):[path.join(base,name)];
    for(const dir of candidates){
      try{for(const file of await readdir(dir))if(/^(licen[cs]e|copying|notice)(\.|$)/i.test(file)){
        const {readFile}=await import('node:fs/promises');const content=await readFile(path.join(dir,file),'utf8');const entry=`\n===== ${path.basename(dir)} / ${file} =====\n${content}`;if(!notices.includes(entry))notices.push(entry);
      }}catch{}
    }
  }
}
await writeFile('dist/THIRD-PARTY-NOTICES.txt',notices.join('\n'));
await writeFile('dist/BUILD.txt',`Built ${new Date().toISOString()}\nInstall this dist folder using chrome://extensions → Load unpacked.\n`);
