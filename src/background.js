import {ensureModelFiles,missingModelDownloads} from './model-setup.js';
import {CHAT_BATCH_SIZE} from './chat-policy.js';
import {youtubePage,youtubeChatPage,RateWindow} from './youtube-utils.js';
import {defaults,emptyGlossary,validateSettings} from './config.js';
import {nativeCall,installedModelConnection,migrateCaches} from './native.js';
const chatRates=new Map();let preparing=false,deleting=false;let preparationJob=null;let creating;let closing=false;let starting=false;let statusQueue=Promise.resolve();let reloadQueue=Promise.resolve();
async function exists(){return (await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length>0;}
async function ensure(){if(await exists())return;creating??=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['USER_MEDIA','WORKERS'],justification:'本地辨識直播分頁音訊與 WebGPU 模型推論'}).finally(()=>creating=null);await creating;}
async function config(){const s=await chrome.storage.local.get(['settings','glossary']);return {settings:validateSettings(s.settings||defaults),glossary:s.glossary||emptyGlossary};}
function status(patch){statusQueue=statusQueue.catch(()=>{}).then(async()=>{const {state={}}=await chrome.storage.session.get('state');const next={...state,...patch,updated:Date.now()};await chrome.storage.session.set({state:next});return next;});return statusQueue;}
async function handleMessage(m,sender={}){
    if(m.type==='youtubeConfig'){const {state={}}=await chrome.storage.session.get('state');const {settings}=await config();return {enabled:!!state.running&&state.tabId===sender.tab?.id,settings};}
    if(['youtubeMedia','youtubeReset','youtubeDelayError'].includes(m.type)){
      const {state={}}=await chrome.storage.session.get('state');if(!state.running||state.tabId!==sender.tab?.id||sender.frameId!==0||!youtubePage(sender.url))throw Error('YouTube 時間來源無效');
      if(m.type==='youtubeReset')await chrome.tabs.sendMessage(state.tabId,{type:'youtubeClear'}).catch(()=>{});
      if(m.type==='youtubeDelayError')await status({youtubeWarning:'畫面緩衝失敗，已恢復即時播放：'+String(m.error||'').slice(0,200)});
      return chrome.runtime.sendMessage({to:'offscreen',type:m.type,epoch:Number(m.epoch)||Date.now(),mediaTime:Number(m.mediaTime)||0,rate:Math.max(.25,Math.min(4,Number(m.rate)||1)),paused:!!m.paused,sequence:Math.max(0,Number(m.sequence)||0)});
    }
    if(m.type==='youtubeChat'){
      const {state={}}=await chrome.storage.session.get('state');const {settings}=await config();if(!state.running||state.tabId!==sender.tab?.id||!youtubeChatPage(sender.url)||!settings.chatTranslation)throw Error('聊天室翻譯未啟用');
      if(!Array.isArray(m.items)||m.items.length>CHAT_BATCH_SIZE)throw Error('聊天室批次超出限制');let rate=chatRates.get(state.tabId);if(!rate){rate=new RateWindow();chatRates.set(state.tabId,rate);}const items=[];
      for(const item of m.items){if(typeof item.id!=='string'||item.id.length>50||typeof item.text!=='string')continue;if(rate.allow(settings.chatMaxPerMinute))items.push({id:item.id,text:item.text.slice(0,180)});else chrome.tabs.sendMessage(state.tabId,{type:'youtubeChatResult',id:item.id,error:'每分鐘上限'},{frameId:sender.frameId}).catch(()=>{});}
      if(!items.length)return {queued:false};return chrome.runtime.sendMessage({to:'offscreen',type:'chat',items,frameId:sender.frameId});
    }
    if(m.type==='chatResult'){const {state={}}=await chrome.storage.session.get('state');if(state.running&&state.tabId===m.tabId)await chrome.tabs.sendMessage(m.tabId,{type:'youtubeChatResult',id:m.id,translation:m.translation,error:m.error},{frameId:m.frameId}).catch(()=>{});return {ok:true};}
    if(m.type==='saveSettings'){
      const operation=reloadQueue.catch(()=>{}).then(async()=>{if(starting||closing||preparing||deleting)throw Error('模型忙碌，請稍後儲存');const candidate=validateSettings(m.settings),previous=(await config()).settings;const {state={}}=await chrome.storage.session.get('state');const active=state.ready||state.loading||state.running;
      const liveKeys=['youtubeMode','youtubeDelayMs','chatTranslation','chatMaxPerMinute','autoDownloadModels','chatEngine','chatLanguage','contextMode','chinaModelAcknowledged','debugMode'];const modelChanged=Object.keys(defaults).filter(k=>!liveKeys.includes(k)).some(k=>candidate[k]!==previous[k]);
      if(active&&modelChanged&&candidate.modelSource==='installed'){if(candidate.autoDownloadModels)missingModelDownloads(candidate,(await nativeCall('hello')).models);else await installedModelConnection(candidate);}await chrome.storage.local.set({settings:candidate});if(!active)return {reloading:false};
      if(!modelChanged){const r=await chrome.runtime.sendMessage({to:'offscreen',type:'runtimeSettings',settings:candidate});if(r?.error)throw Error(r.error);return {reloading:false,liveApplied:true};}
      await handleMessage({type:'release'});await handleMessage({type:'prepare'});return {reloading:true};});reloadQueue=operation;return operation;
    }
    if(m.type==='glossaryApplied'){if(await exists()){const {glossary}=await config();const r=await chrome.runtime.sendMessage({to:'offscreen',type:'glossary',glossary});if(r?.error)throw Error(r.error);}return {ok:true};}
    if(m.type==='models'){const c=await nativeCall('hello');return {models:c.models};}
    if(m.type==='deleteModel'){
      if(preparing||deleting||starting||closing)throw Error('模型忙碌，請稍後再刪除');deleting=true;
      try{const {state={}}=await chrome.storage.session.get('state');if(state.loading)throw Error('模型載入中，請先釋放模型');
        if((state.ready||state.running)&&await exists()){const a=state.activeModels||{};if(m.kind==='whisper'&&m.modelId===(a.whisperId||'whisper-'+a.asr)||m.kind==='llm'&&m.modelId===a.modelId)throw Error('此模型正在使用，請先按「釋放模型」');}
        const result=await nativeCall('deleteModel',{kind:m.kind,modelId:m.modelId});const {settings}=await config();const key=m.kind==='whisper'?'localWhisperId':'localLlmId';if(settings[key]===m.modelId){settings[key]='';await chrome.storage.local.set({settings});}return result;
      }finally{deleting=false;}
    }
    if(m.type==='downloadModel'){if(preparing||deleting||closing)throw Error('正在準備模型，請先釋放模型或等待完成');return nativeCall('downloadStart',{modelId:m.modelId});}
    if(m.type==='downloadStatus')return nativeCall('downloadStatus');
    if(m.type==='downloadCancel')return nativeCall('downloadCancel');
    if(m.type==='openModels')return nativeCall('openModels');
    if(m.type==='restoreBackup')return nativeCall('readBackup');
    if(m.type==='migrate'){
      try{const result=await migrateCaches(message=>status({message,migrating:true}));await status({message:'模型已匯入安裝目錄，舊快取保留供回復'});return result;}finally{await status({migrating:false});}
    }
    if(m.type==='status'){return (await chrome.storage.session.get(['state','history']));}
    if(m.type==='prepare'){
      if(preparing||deleting||closing||starting)throw Error('模型管理中，請稍後');preparing=true;
      try{
        const state=(await chrome.storage.session.get('state')).state;
        if(state?.running||state?.loading)throw Error('請先停止目前工作');
        if(state?.ready&&await exists()){preparing=false;return {ok:true,alreadyReady:true};}
        const c=await config(),job={controller:new AbortController()};preparationJob=job;
        await status({ready:false,loading:true,error:null,setupDownloading:false,message:'檢查所選本機模型…'});
        job.task=(async()=>{
          let pinned=false;
          try{
            if(c.settings.modelSource==='installed'&&c.settings.autoDownloadModels)await ensureModelFiles(c.settings,{call:nativeCall,signal:job.controller.signal,onProgress:async d=>status({loading:true,setupDownloading:true,message:`下載 ${d.title}：${Math.round(d.bytes/1e6)} / ${Math.round(d.total/1e6)} MB · ${d.file||''}`})});
            if(job.controller.signal.aborted)return;
            const modelConnection=c.settings.modelSource==='installed'?await installedModelConnection(c.settings):null;
            if(modelConnection){await nativeCall('pinModels',{whisperId:modelConnection.whisperId,llmId:c.settings.translator==='chrome'?'':modelConnection.llmId});pinned=true;}
            if(job.controller.signal.aborted)return;
            await ensure();if(job.controller.signal.aborted)return;
            await status({setupDownloading:false,message:'模型檔案已就緒，開始暖機…'});
            const reply=await chrome.runtime.sendMessage({to:'offscreen',type:'prepare',...c,modelConnection});if(reply?.error)throw Error(reply.error);
          }catch(e){if(pinned)await nativeCall('unpinModels').catch(()=>{});if(!job.controller.signal.aborted)await status({ready:false,loading:false,setupDownloading:false,error:e.message,message:'模型準備失敗：'+e.message});}
          finally{if(preparationJob===job){preparationJob=null;preparing=false;}}
        })();return {ok:true,preparing:true};
      }catch(e){preparing=false;preparationJob=null;throw e;}
    }
    if(m.type==='start'){
      if(starting||closing)throw Error('正在啟動或停止，請稍後');
      starting=true;
      try{
      const {state}=await chrome.storage.session.get('state');
      if(!state?.ready||state.running||!await exists())throw Error('請先完成暖機，或停止目前直播');
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(!tab?.id||!/^https?:/.test(tab.url||''))throw Error('請切到直播網頁後再啟用');
      const youtube=youtubePage(tab.url);if(youtube)await chrome.scripting.executeScript({target:{tabId:tab.id},files:['youtube.js']});else await chrome.scripting.executeScript({target:{tabId:tab.id},files:['subtitle.js']});
      await chrome.tabs.sendMessage(tab.id,{type:'local-subtitle',clear:true});
      const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});
      const result=await chrome.runtime.sendMessage({to:'offscreen',type:'start',streamId,tabId:tab.id,youtube});
      if(result?.error)throw Error(result.error);
      await status({youtube,running:true,tabId:tab.id,youtubeWarning:null,message:'辨識直播中，模型常駐',error:null,captureDiagnostics:null});if(youtube){const {settings}=await config();await chrome.tabs.sendMessage(tab.id,{type:'youtubeConfigure',enabled:true,settings}).catch(()=>{});}return {ok:true};
      }catch(e){await status({running:false,error:e.message,message:'擷取啟動失敗；已載入的模型保留'});throw e;}finally{starting=false;}
    }
    if(m.type==='stop'||m.type==='release'){
      if(starting||closing)throw Error('正在啟動或停止，請稍後');
      if(preparing&&m.type!=='release')throw Error('模型準備中；請按「釋放模型」取消下載與暖機');
      closing=true;
      try{
        await status({stopping:true});
        if(preparing){const job=preparationJob;if(!job?.task)throw Error('模型準備剛開始，請稍後再按釋放');job.controller.abort();await job.task;}
        const {state={}}=await chrome.storage.session.get('state');
        if(m.type==='stop'&&state.loading)throw Error('模型載入中；若要取消，請按「釋放模型」');
        let resident=false;
        if(await exists()){
          const reply=await chrome.runtime.sendMessage({to:'offscreen',type:m.type==='release'?'stop':'pause'});if(reply?.error)throw Error(reply.error);
          if(m.type==='release'){await chrome.offscreen.closeDocument();}else resident=!!state.ready;
        }
        if(m.type==='release')await nativeCall('unpinModels').catch(()=>{});
        if(state.tabId){await chrome.tabs.sendMessage(state.tabId,{type:'local-subtitle',clear:true}).catch(()=>{});await chrome.tabs.sendMessage(state.tabId,{type:'youtubeConfigure',enabled:false}).catch(()=>{});chatRates.delete(state.tabId);}
        await status({ready:resident,loading:false,setupDownloading:false,running:false,tabId:null,error:null,message:resident?'已停止翻譯，模型常駐，可直接再次啟動':'模型已釋放，下載進度保留，下次可續傳並暖機'});
      }finally{closing=false;await status({stopping:false});}return {ok:true};
    }
    if(m.type==='event'){
      if(m.patch)await status(m.patch);
      if(m.caption){const {state}=await chrome.storage.session.get('state');if(!state?.running||state.tabId!==m.tabId)return {ok:true};if(!m.caption.suppressed)await chrome.tabs.sendMessage(m.tabId,state.youtube?{type:'youtubeCaption',caption:m.caption}:{type:'local-subtitle',...m.caption}).catch(()=>{});if(m.caption.final){const {history=[]}=await chrome.storage.session.get('history');history.push({...m.caption,at:new Date().toISOString()});await chrome.storage.session.set({history:history.slice(-200)});}}
      return {ok:true};
    }
    throw Error('未知指令');
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
  if(m.to!=='background'||sender.id!==chrome.runtime.id)return;
  handleMessage(m,sender).then(respond,e=>respond({error:String(e.message||e)}));return true;
});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.settings)exists().then(active=>{if(active)return chrome.runtime.sendMessage({to:'offscreen',type:'debugMode',enabled:changes.settings.newValue?.debugMode===true});}).catch(()=>{});});
chrome.tabs.onRemoved.addListener(async id=>{const {state}=await chrome.storage.session.get('state');if(state?.running&&state.tabId===id)handleMessage({type:'stop'}).catch(e=>status({error:e.message}));});
chrome.tabs.onUpdated.addListener(async(id,change)=>{if(change.status!=='loading')return;const {state}=await chrome.storage.session.get('state');if(state?.running&&state.tabId===id)handleMessage({type:'stop'}).catch(e=>status({error:e.message}));});
async function reconcile(){const {state}=await chrome.storage.session.get('state');if((state?.ready||state?.loading||state?.running)&&!await exists())await status({ready:false,loading:false,running:false,message:'背景已關閉，請重新暖機'});}
reconcile();
