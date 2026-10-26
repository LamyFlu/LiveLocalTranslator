import {cleanModelReply} from './model-reply.js';
import {CreateMLCEngine} from '@mlc-ai/web-llm';
let engine,qwen=false;
// WebLLM 0.2.86 asks CacheStorage to materialize each model file. Our files
// already live in the installation directory. This worker-only read adapter
// defers disk HTTP reads until the SDK consumes a response; no duplicate GBs
// are persisted in Chrome's CacheStorage, IndexedDB or OPFS.
function installedFiles(connection){
 const realFetch=globalThis.fetch.bind(globalThis),base=connection.modelBase,library=connection.library;
 if(!base.startsWith('http://127.0.0.1:')||!library.startsWith(self.location.origin+'/'))throw Error('Invalid installed WebLLM paths');
 const read=async(request,init)=>{let url=typeof request==='string'?request:request.url||String(request);if(url.startsWith(base+'resolve/local/'))url=base+url.slice((base+'resolve/local/').length);if(!url.startsWith(base)&&url!==library)throw Error('Installed WebLLM blocks external model requests');const r=await realFetch(url,init);if(!r.ok)throw Error(`本機 WebLLM 檔案無法讀取 ${r.status}: ${new URL(url).pathname.split('/').at(-1)}`);return r;};
 globalThis.fetch=read;
 class LocalFileResponse extends Response{
  constructor(request){super(null);this.request=request;}
  async arrayBuffer(){return (await read(this.request)).arrayBuffer();}
  async json(){return (await read(this.request)).json();}
  async text(){return (await read(this.request)).text();}
 }
 Object.defineProperty(globalThis,'caches',{configurable:true,value:{open:async()=>({match:async request=>new LocalFileResponse(request),add:async()=>{},put:async()=>{},delete:async()=>false,keys:async()=>[]})}});
}
self.onmessage=async({data:m})=>{try{
 if(m.type==='load'){
  const c=m.webllm;if(!c)throw Error('WebLLM 需要先下載到安裝目錄');installedFiles(c);qwen=c.id.startsWith('Qwen3');
  engine=await CreateMLCEngine(c.id,{appConfig:{cacheBackend:'cache',model_list:[{model:c.modelBase+'resolve/local/',model_id:c.id,model_lib:c.library,required_features:['shader-f16'],overrides:{context_window_size:2048,prefill_chunk_size:512}}]},initProgressCallback:p=>self.postMessage({progress:`WebLLM 載入 ${Math.round(p.progress*100)}% · ${c.id}`})});
  await engine.chat.completions.create({messages:[{role:'user',content:'Translate to Traditional Chinese: Hello'}],max_tokens:1,temperature:0,extra_body:qwen?{enable_thinking:false}:undefined});await engine.resetChat();self.postMessage({rpc:m.rpc,result:true});
 }else if(m.type==='translate'){
  await engine.resetChat();const response=await engine.chat.completions.create({messages:[{role:'user',content:m.prompt}],max_tokens:Math.max(16,Math.min(128,m.maxTokens||128)),temperature:0,extra_body:qwen?{enable_thinking:false}:undefined});const text=cleanModelReply(response.choices[0]?.message.content);if(!text)throw Error('WebLLM 模型未輸出譯文');self.postMessage({rpc:m.rpc,result:text});
 }
}catch(e){self.postMessage({rpc:m.rpc,error:e.message||String(e)});}};
