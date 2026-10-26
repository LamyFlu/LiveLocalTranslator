import {whisperModels,starterModels} from './whisper-catalog.js';
import {largeModel} from './model-catalog.js';

export function missingModelDownloads(settings,models){
 const selected=[{kind:'whisper',id:settings.localWhisperId||'whisper-'+settings.asr,managed:whisperModels}];
 if(settings.translator!=='chrome'){const large=largeModel(settings.translator);selected.push({kind:'llm',id:settings.localLlmId||large?.id||(settings.translator==='gemma4'?'gemma-4-E4B':'gemma-4-E2B'),managed:large?[large]:starterModels});}
 return selected.flatMap(({kind,id,managed})=>{
  if(models[kind].some(m=>m.id===id&&m.ready))return [];
  const spec=managed.find(m=>m.id===id);if(!spec)throw Error(`自訂模型資料夾 ${id} 不完整，無法自動下載；請完成匯入或改選「自動選取」`);
  return [{...spec,kind}];
 });
}
function aborted(signal){if(signal?.aborted){const e=Error('模型下載已取消，已完成檔案與續傳進度保留');e.name='AbortError';throw e;}}

// Only downloads selected missing models, serially. No retries, no overwrites,
// and never cancels a download that was started by another operation.
export async function ensureModelFiles(settings,{call,onProgress=async()=>{},signal,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 aborted(signal);const connection=await call('hello'),missing=missingModelDownloads(settings,connection.models);if(!missing.length)return;
 if(connection.downloadCatalogVersion!==2)throw Error('本機橋接版本較舊，請先執行 0.4.3 以上 Setup 升級，再重新載入擴充功能');
 const state=await call('downloadStatus');if(['downloading','cancelling'].includes(state.state))throw Error('已有模型下載中，請等待完成或在設定頁取消後再暖機');
 for(const spec of missing){
  aborted(signal);await onProgress({modelId:spec.id,title:spec.title,bytes:0,total:spec.bytes,file:'',state:'downloading'});
  await call('downloadStart',{modelId:spec.id});let completed=false,cancelPromise;
  const cancel=()=>{cancelPromise??=call('downloadCancel').catch(()=>{});};
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  try{
   for(;;){
    if(signal?.aborted){await cancelPromise;for(let i=0;i<100;i++){const s=await call('downloadStatus');if(!['downloading','cancelling'].includes(s.state))break;await sleep(100);}aborted(signal);}
    const s=await call('downloadStatus');if(s.modelId!==spec.id)throw Error('下載任務已變更，請重新暖機');await onProgress({...s,title:spec.title});
    if(s.state==='complete'){completed=true;break;}
    if(s.state==='cancelled')throw Error('模型下載已取消，進度保留；按暖機可再次續傳');
    if(s.state==='error')throw Error(`下載 ${spec.title} 失敗：${s.error||'未知錯誤'}；進度保留，不會自動重試`);
    if(!['downloading','cancelling'].includes(s.state))throw Error('模型下載未啟動，請至設定頁查看下載狀態');
    await sleep(1000);
   }
  }finally{signal?.removeEventListener('abort',cancel);if(!completed){cancel();await cancelPromise;}}
 }
 aborted(signal);const remaining=missingModelDownloads(settings,(await call('hello')).models);if(remaining.length)throw Error('下載已結束但模型仍不完整，請在設定頁檢查下載紀錄');
}
