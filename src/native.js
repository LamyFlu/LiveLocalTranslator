import {largeModel} from './model-catalog.js';
let port,sequence=0;const pending=new Map();
export function nativeCall(op,data={}){
  if(!port){
    port=chrome.runtime.connectNative('com.livelocaltranslator.files');
    port.onMessage.addListener(m=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);});
    port.onDisconnect.addListener(()=>{const message=chrome.runtime.lastError?.message||'本機模型檔案橋接已結束';port=null;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(message+'；請確認已執行安裝程式'));}pending.clear();});
  }
  return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('本機橋接回應逾時'));},30000);pending.set(id,{resolve,reject,timer});port.postMessage({id,op,...data});});
}
export async function installedModelConnection(settings){
  const connection=await nativeCall('hello');
  const w=connection.models.whisper.find(m=>m.id===(settings.localWhisperId||`whisper-${settings.asr}`)&&m.ready);
  const large=largeModel(settings.translator);const isWeb=large?.backend==='webllm';const l=connection.models.llm.find(m=>m.id===(settings.localLlmId||(large?large.id:settings.translator==='gemma4'?'gemma-4-E4B':'gemma-4-E2B'))&&m.ready);
  if(!w)throw Error('Whisper 模型尚未下載或不完整。請在設定啟用「暖機時下載缺少模型」，或按「下載目前 Whisper」');
  if(settings.translator!=='chrome'&&!l)throw Error(large?'找不到完整 LLM 模型，請先在設定一鍵下載對應模型':'LLM 模型尚未下載，請在設定啟用暖機自動下載，或按「下載目前 LLM」');
  if(isWeb&&l?.backend!=='webllm')throw Error('目前選到 LiteRT 模型資料夾，請改為 WebLLM 對應模型或「自動選取」');
  if(!isWeb&&settings.translator!=='chrome'&&l?.backend==='webllm')throw Error('目前選到 WebLLM 資料夾，請選對應的 WebLLM 引擎');
  return {whisperBase:connection.baseUrl+'/models/whisper/',whisperId:w.id,encoderDtype:w.encoderDtype,llmId:l?.id,llmUrl:l&&!isWeb?connection.baseUrl+'/models/llm/'+encodeURIComponent(l.id)+'/'+encodeURIComponent(l.file):null,webllm:isWeb?{id:large.id,modelBase:connection.baseUrl+'/models/llm/'+encodeURIComponent(l.id)+'/',library:chrome.runtime.getURL('webllm-libs/'+large.id+'.wasm')}:null,root:connection.models.root};
}
function destination(url){
  const u=new URL(url);if(u.hostname!=='huggingface.co')return null;
  const w=u.pathname.match(/^\/onnx-community\/whisper-(tiny|base|small|medium-ONNX|large-v3-turbo)\/resolve\/[^/]+\/(.+)$/);
  if(w&&/\.(json|txt|model|onnx|onnx_data)$/.test(w[2]))return `whisper/whisper-${w[1]==='medium-ONNX'?'medium':w[1]}/${w[2]}`;
  const l=u.pathname.match(/^\/litert-community\/gemma-4-(E2B|E4B)-it-litert-lm\/resolve\/[^/]+\/(gemma-4-.+-web\.litertlm)$/);
  return l?`llm/gemma-4-${l[1]}/${l[2]}`:null;
}
export async function migrateCaches(progress){
  const connection=await nativeCall('hello');const backup=await chrome.storage.local.get(['settings','glossary']);await nativeCall('saveBackup',{data:backup});
  const receipts=[];const seen=new Set();
  async function request(route,options){const r=await fetch(connection.baseUrl+'/'+route,options);const body=await r.json();if(!r.ok)throw Error(body.error||'模型搬移失敗');return body;}
  for(const name of await caches.keys()){
    const cache=await caches.open(name);
    for(const requestKey of await cache.keys()){
      const path=destination(requestKey.url);if(!path||seen.has(path))continue;seen.add(path);
      const response=await cache.match(requestKey);const bytes=Number(response.headers.get('content-length'))||-1;
      const upload=await request('import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,bytes})});
      if(upload.exists){receipts.push({path,bytes:upload.bytes,existing:true});continue;}
      const reader=response.body.getReader();let buffer=new Uint8Array(4*1024*1024),used=0,offset=0;
      async function flush(){if(!used)return;await request('import/'+upload.id,{method:'PUT',headers:{'X-Offset':String(offset)},body:buffer.subarray(0,used)});offset+=used;used=0;progress(`搬移 ${path}：${Math.round(offset/1e6)} MB`);}
      while(true){const {value,done}=await reader.read();if(done)break;let position=0;while(position<value.length){const take=Math.min(buffer.length-used,value.length-position);buffer.set(value.subarray(position,position+take),used);used+=take;position+=take;if(used===buffer.length)await flush();}}
      await flush();const receipt=await request('import/'+upload.id+'/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bytes:offset})});if(receipt.bytes!==offset)throw Error('模型搬移大小驗證失敗');receipts.push({path,...receipt});
    }
  }
  await chrome.storage.local.set({modelMigration:{at:new Date().toISOString(),root:connection.models.root,receipts}});
  return {root:connection.models.root,receipts,backupSaved:true,oldCacheRetained:true};
}
