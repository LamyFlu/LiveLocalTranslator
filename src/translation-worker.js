import {Engine,loadLiteRtLm} from '@litert-lm/core';
let engine;let runtime;
const ensureRuntime=()=>{
  if(!runtime){
    const base=new URL('./litert/wasm/',self.location.href);
    // importScripts' Emscripten loader otherwise resolves .wasm beside this worker.
    self.Module={locateFile:file=>new URL(file,base).href};
    runtime=loadLiteRtLm(base.href);
  }return runtime;
};
async function modelStream(url){
  const cache=await caches.open('live-local-gemma-v1');let response=await cache.match(url);
  if(!response){response=await fetch(url);if(!response.ok)throw Error(`模型下載失敗 HTTP ${response.status}；模型可能需要先同意授權`);let loaded=0,last=0;const total=Number(response.headers.get('content-length'))||0;
    const stream=response.body.pipeThrough(new TransformStream({transform(chunk,controller){loaded+=chunk.length;if(performance.now()-last>750){self.postMessage({progress:`Gemma 下載 ${(loaded/1e6).toFixed(0)}MB${total?' / '+(total/1e6).toFixed(0)+'MB':''}`});last=performance.now();}controller.enqueue(chunk);}}));
    await cache.put(url,new Response(stream,{headers:response.headers}));response=await cache.match(url);
  }return response.body;
}
self.onmessage=async({data:m})=>{try{
  if(m.type==='runtime'){await ensureRuntime();self.postMessage({rpc:m.rpc,result:true});}
  else if(m.type==='load'){
    await ensureRuntime();
    if(m.model==='gemma12'&&!m.localUrl)throw Error('12B 請先從設定下載至安裝目錄');
    const size=m.model==='gemma4'?'E4B':'E2B';const url=`https://huggingface.co/litert-community/gemma-4-${size}-it-litert-lm/resolve/main/gemma-4-${size}-it-web.litertlm`;
    let stream;if(m.localUrl){const r=await fetch(m.localUrl);if(!r.ok)throw Error('本機 LLM 檔案無法讀取');stream=r.body;}else stream=await modelStream(url);self.postMessage({progress:'LLM 載入 GPU 並暖機…'});
    engine=await Engine.create({model:stream,mainExecutorSettings:{maxNumTokens:m.model==='gemma12'?2048:4096}});
    const c=await engine.createConversation({sessionConfig:{maxOutputTokens:1}});try{await c.sendMessage('Hi');}finally{await c.delete();}self.postMessage({rpc:m.rpc,result:true});
  }else if(m.type==='translate'){
    const c=await engine.createConversation({sessionConfig:{maxOutputTokens:Math.max(16,Math.min(128,m.maxTokens||128)),samplerParams:{temperature:0}}});
    try{const response=await c.sendMessage(m.prompt);const text=response.content.filter(x=>x.type==='text').map(x=>x.text).join('').trim();if(!text)throw Error('模型未輸出譯文');self.postMessage({rpc:m.rpc,result:text});}finally{await c.delete();}
  }
}catch(e){self.postMessage({rpc:m.rpc,error:e.message||String(e)});}};
