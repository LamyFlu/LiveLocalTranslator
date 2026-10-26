// Real installed Chrome + real workers on localhost. No extension APIs mocked for model tests.
// This validates packaged runtimes and GPU inference, not tabCapture permissions.
import {chromium} from 'playwright';import {createServer} from 'node:http';import {readFile,writeFile,mkdir} from 'node:fs/promises';import path from 'node:path';
const root=path.resolve('dist');const errors=[];await mkdir('verification',{recursive:true});
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css'};
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/offscreen.html':pathname));if(!file.startsWith(root+path.sep))throw Error('path');res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Content-Security-Policy',"script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; object-src 'self'");res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(43817,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const ctx=await chromium.launchPersistentContext(path.resolve('.gpu-profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-webgpu']});
try{
 const page=await ctx.newPage();page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,400));else if(m.text().startsWith('Gemma'))console.log(m.text());});page.on('pageerror',e=>errors.push(e.message));
 // Empty test document under the production CSP, without starting offscreen orchestration.
 await page.route('**/probe.html',route=>route.fulfill({body:'<!doctype html><meta charset="utf-8"><title>WebGPU model verification</title>',contentType:'text/html',headers:{'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Opener-Policy':'same-origin','Content-Security-Policy':"script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'"}}));
 await page.goto(origin+'/probe.html');
 const gpu=await page.evaluate(async()=>{const a=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});return a?{vendor:a.info.vendor,architecture:a.info.architecture,description:a.info.description,maxBufferSize:a.limits.maxBufferSize}:null;});console.log('GPU',JSON.stringify(gpu));
 const result=await page.evaluate(async()=>{
  const worker=new Worker('/asr-worker.js',{type:'module'});const pending=new Map();let serial=0;
  worker.onmessage=({data:m})=>{if(m.progress){console.log(m.progress);return;}const p=pending.get(m.rpc);if(p){clearTimeout(p.timer);pending.delete(m.rpc);m.error?p.reject(Error(m.error)):p.resolve(m.result);}};
  worker.onerror=e=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(e.message));}};
  const call=(type,data={},transfer=[])=>new Promise((resolve,reject)=>{const rpc=++serial;const timer=setTimeout(()=>reject(Error('ASR model test timed out')),600000);pending.set(rpc,{resolve,reject,timer});worker.postMessage({type,rpc,...data},transfer);});
  try{
   const start=performance.now();await call('load',{size:'tiny',language:'en'});const loadMs=performance.now()-start;
   const res=await fetch('https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav');if(!res.ok)throw Error('sample fetch '+res.status);
   const ac=new AudioContext({sampleRate:16000});const audio=await ac.decodeAudioData(await res.arrayBuffer());const input=audio.getChannelData(0).slice(0,64000);await ac.close();
   const runs=[];for(let i=0;i<3;i++){const pcm=input.slice();runs.push(await call('recognize',{audio:pcm,language:'en'},[pcm.buffer]));}return {loadMs,seconds:input.length/16000,runs};
  }finally{worker.terminate();}
 });
 console.log('ASR',JSON.stringify(result));await writeFile('verification/webgpu-result.json',JSON.stringify({date:new Date().toISOString(),browser:await ctx.browser()?.version(),gpu,result,errors,scope:'localhost real Chrome inference; not live tabCapture or full translation'},null,2));
 if(result.runs.some(r=>!r.text))throw Error('No ASR text');
 const gemma=await page.evaluate(async full=>{
  const w=new Worker('/translation-worker.js');let rpc=0;const pending=new Map();
  w.onmessage=({data:m})=>{if(m.progress){console.log(m.progress);return;}const p=pending.get(m.rpc);if(p){clearTimeout(p.timer);pending.delete(m.rpc);m.error?p.reject(Error(m.error)):p.resolve(m.result);}};
  w.onerror=e=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(e.message));}};
  const call=(type,data={})=>new Promise((resolve,reject)=>{const n=++rpc;const timer=setTimeout(()=>reject(Error('Gemma runtime timeout')),1200000);pending.set(n,{resolve,reject,timer});w.postMessage({type,rpc:n,...data});});
  try{await call('runtime');if(!full)return {runtime:'passed'};const start=performance.now();await call('load',{model:'gemma2'});const loadMs=performance.now()-start;const t=performance.now();const translation=await call('translate',{prompt:'Translate into Traditional Chinese used in Taiwan. Only output the translation. Glossary: Blackwave = 黑波. Current: Blackwave is playing a game with my fellow Americans.'});return {runtime:'passed',loadMs,translation,translationMs:performance.now()-t};}finally{w.terminate();}
 },process.argv.includes('--gemma'));
 console.log('Gemma',JSON.stringify(gemma));await writeFile('verification/gemma-result.json',JSON.stringify({date:new Date().toISOString(),gemma,errors},null,2));
}catch(e){await writeFile('verification/webgpu-error.json',JSON.stringify({date:new Date().toISOString(),error:e.message,errors},null,2));throw e;}
finally{await ctx.close();server.close();}
