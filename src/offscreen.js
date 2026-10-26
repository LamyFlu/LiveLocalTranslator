import {BrowserChatTranslator} from './chat-translator.js';
import {CHAT_QUEUE_LIMIT,CHAT_MAX_AGE_MS} from './chat-policy.js';
import {connectPlayback} from './audio-playback.js';
import {contextSources} from './context-prompt.js';
import {MemoryCache} from './memory-cache.js';
import {Segmenter,LatestQueue} from './segmenter.js';
import {termsFor,replaceRules,relevantTerms,translationPrompt,retryTranslationPrompt,retryPlan,restoreRetryOutput,translationAnomaly,translationRevision,maskTerms,validateGlossary} from './glossary.js';
import {validateSettings} from './config.js';
import {Converter} from 'opencc-js';
const toTW=Converter({from:'cn',to:'twp'});
let generation=0,settings,glossary,asr,translator,chromeTranslator,loadedModelId;
let media,context,node,source,mute,tabId,segmenter,ready=false,asrBusy=false,translationBusy=false;
let jobs=new LatestQueue(3),translations=[],history=[],results=new Map(),rpcSeq=0,dropped=0,vadSkipped=0;
const machineChat=new BrowserChatTranslator();let machineChatBusy=false,chatRevision=0;
function resetChat(){chatRevision++;chatQueue=[];machineChat.reset();}
const workers=new Set();let playbackDelay,playbackGain,youtubeCapture=false,timelineToken=0,youtubeMedia={},chatQueue=[];
function makeSegmenter(){return new Segmenter({...settings,maxSegmentMs:youtubeCapture&&settings.youtubeMode==='delayed'?Math.min(settings.maxSegmentMs,4000):settings.maxSegmentMs});}
let playbackConnection;
function playback(){if(!source||!context)return;playbackConnection?.disconnect();playbackConnection=connectPlayback(source,context,youtubeCapture&&settings.youtubeMode==='delayed'?settings.youtubeDelayMs:0,youtubeCapture&&youtubeMedia.paused);playbackDelay=playbackConnection.delayNode;playbackGain=playbackConnection.gainNode;}
function resetTimeline(m){timelineToken++;youtubeMedia=m;segmenter=makeSegmenter();jobs=new LatestQueue(3);translations=[];results.clear();history=[];chatQueue=[];playback();}

function emit(patch,caption){return chrome.runtime.sendMessage({to:'background',type:'event',patch,caption,tabId}).catch(()=>{});}
class RPC{
  constructor(file){this.worker=new Worker(new URL(file,location.href),{type:file==='translation-worker.js'?'classic':'module'});workers.add(this);this.pending=new Map();this.active=new Set();this.worker.onmessage=({data:m})=>{if(m.progress){emit({message:m.progress});return;}const p=this.pending.get(m.rpc);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.rpc);m.error?p.reject(Error(m.error)):p.resolve(m.result);};this.worker.onerror=e=>this.close(Error(e.message||'模型 worker 啟動失敗'));}
  call(type,data={},transfer=[],timeout=30000){if(this.closedError)return Promise.reject(this.closedError);const promise=new Promise((resolve,reject)=>{const rpc=++rpcSeq;const timer=setTimeout(()=>this.close(Error(`${type} 超時；請手動釋放後重新載入模型`)),timeout);this.pending.set(rpc,{resolve,reject,timer});this.worker.postMessage({type,rpc,...data},transfer);});this.active.add(promise);promise.then(()=>this.active.delete(promise),()=>this.active.delete(promise));return promise;}
  drain(){return Promise.allSettled([...this.active]);}
  close(error=Error('已停止')){this.closedError=error;this.worker.terminate();workers.delete(this);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
}
async function stop(){generation++;resetChat();ready=false;for(const w of [...workers])w.close();asr=translator=null;chromeTranslator?.destroy();chromeTranslator=null;if(media)media.getTracks().forEach(t=>t.stop());media=null;if(node){node.port.onmessage=null;node.disconnect();}source?.disconnect();mute?.disconnect();if(context)await context.close();context=null;node=null;source=null;mute=null;jobs=new LatestQueue(3);translations=[];results.clear();history=[];asrBusy=translationBusy=false;playbackDelay=playbackGain=null;chatQueue=[];}
// A capture session is disposable; loaded model workers belong to the offscreen
// document and survive stopping, navigation and closing the captured tab.
async function pauseCapture(){
  generation++;resetChat();
  if(node)node.port.onmessage=null;
  if(media){for(const track of media.getTracks()){track.onended=null;track.stop();}}
  media=null;node?.disconnect();source?.disconnect();mute?.disconnect();
  if(context&&context.state!=='closed')await context.close();
  context=node=source=mute=null;
  jobs=new LatestQueue(3);translations=[];results.clear();history=[];chatQueue=[];playbackDelay=playbackGain=null;
  // Finish already submitted GPU jobs before accepting a new capture; do not
  // run a second generate() concurrently on the same resident model.
  await Promise.allSettled([...workers].map(w=>w.drain()));
  asrBusy=translationBusy=false;
}
async function fatal(e,session){if(session!==generation)return;await stop();await emit({error:e.message||String(e),message:'處理失敗，請停止後重新暖機',running:false,ready:false,loading:false});}
async function prepare(m){
  await stop();const session=generation;
  try{
    settings=validateSettings(m.settings);glossary=validateGlossary(m.glossary);loadedModelId=m.modelConnection?.llmId||settings.localLlmId||settings.translator;
    asr=new RPC('asr-worker.js');await asr.call('load',{size:settings.asr,language:settings.language,speechFilter:settings.speechFilter,localBase:m.modelConnection?.whisperBase,localId:m.modelConnection?.whisperId,encoderDtype:m.modelConnection?.encoderDtype},[],1800000);if(session!==generation)return;
    if(settings.translator==='chrome'){
      if(!globalThis.Translator)throw Error('此 Chrome 未提供本機 Translator，請改用 Gemma');
      const opts={sourceLanguage:settings.language,targetLanguage:'zh-Hant'};
      if(await Translator.availability(opts)==='unavailable')throw Error('本機 Translator 不支援此語言配對');
      chromeTranslator=await Translator.create({...opts,monitor(m){m.addEventListener('downloadprogress',e=>emit({message:`Chrome 翻譯模型下載 ${Math.round(e.loaded*100)}%`}));}});
    }else{translator=new RPC(settings.translator.startsWith('mlc-')?'webllm-worker.js':'translation-worker.js');await translator.call('load',{model:settings.translator,localUrl:m.modelConnection?.llmUrl,webllm:m.modelConnection?.webllm},[],1800000);}
    if(session!==generation)return;ready=true;await emit({ready:true,loading:false,running:false,error:null,activeModels:{whisperId:m.modelConnection?.whisperId||settings.localWhisperId||`whisper-${settings.asr}`,asr:settings.asr,translator:settings.translator,modelId:loadedModelId,language:settings.language,speechFilter:settings.speechFilter},message:'模型已暖機，回到直播分頁按「翻譯目前直播」'});
  }catch(e){await fatal(e,session);}
}
async function start(m){
  if(!ready||context)throw Error('模型尚未就緒或直播已啟動');tabId=m.tabId;youtubeCapture=!!m.youtube;youtubeMedia={};timelineToken++;const session=generation;let stage='接收分頁音訊';
  try{
    if(crossOriginIsolated)throw Error('背景音訊頁仍使用舊版隔離設定，請在擴充功能頁重新載入 0.1.1 以上版本');
    media=await navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:m.streamId}},video:false});
    stage='建立音訊處理管線';
    // Use the output device's normal rate for playback (usually 44.1/48kHz).
    // Only the separate AudioWorklet branch downmixes/resamples a copy for ASR.
    context=new AudioContext({latencyHint:'interactive'});await context.resume();
    await context.audioWorklet.addModule(chrome.runtime.getURL('audio-worklet.js'));
    source=context.createMediaStreamSource(media);playback(); // Direct multichannel playback, no ASR filter or lossy codec.
    node=new AudioWorkletNode(context,'mono-capture');mute=context.createGain();mute.gain.value=0;source.connect(node);node.connect(mute).connect(context.destination);
    await emit({audioPipeline:{playbackSampleRate:context.sampleRate,recognitionSampleRate:16000,captureChannels:media.getAudioTracks()[0].getSettings().channelCount??null,lossyEncoding:false}});
    segmenter=makeSegmenter();jobs=new LatestQueue(3);translations=[];results.clear();history=[];dropped=0;vadSkipped=0;
    node.port.onmessage=({data:frame})=>{if(session!==generation)return;for(const event of segmenter.push(frame)){event.endedAt=performance.now()-(event.clock-event.endSample)/16;event.createdAt=performance.now();event.timelineToken=timelineToken;event.speechEndEpoch=performance.timeOrigin+event.endedAt;event.speechStartEpoch=event.speechEndEpoch-(event.endSample-event.startSample)/16;jobs.put(event);}pumpASR(session);};
    media.getAudioTracks()[0].onended=()=>{if(session===generation)pauseCapture().then(()=>emit({running:false,ready,message:'分頁音訊已結束，模型保留，可直接再次啟動'}));};
  }catch(e){if(session===generation){await pauseCapture();await emit({running:false,ready,error:`${stage}失敗（${e.name||'Error'}）：${e.message}`,captureDiagnostics:{stage,errorName:e.name,errorMessage:e.message,crossOriginIsolated},message:'擷取未啟動，模型仍保留'});}throw Error(`${stage}失敗（${e.name||'Error'}）：${e.message}`);}
}
async function pumpASR(session){
  if(asrBusy||session!==generation)return;let job=jobs.next();if(!job)return;asrBusy=true;
  try{
    let result=results.get(`${job.timelineToken}:${job.key}`);
    if(!result){result=await asr.call('recognize',{audio:job.audio,language:settings.language,vadThreshold:settings.vadThreshold,minSpeechMs:settings.minSpeechMs},[job.audio.buffer],15000);if(session!==generation)return;results.set(`${job.timelineToken}:${job.key}`,result);if(results.size>12)results.delete(results.keys().next().value);}
    if(job.timelineToken!==timelineToken)return;
    if(result.skipped){if(job.final){vadSkipped++;await emit({message:'已略過非人聲片段，持續聆聽',speechFilter:{skipped:vadSkipped,latest:result.vad}},settings.debugMode?{id:job.id,source:'',translation:'',suppressed:true,final:true,skipReason:result.skipReason,asrDiagnostics:{vad:result.vad},asrEndMs:performance.now()-job.endedAt,forced:job.forced}:undefined);}return;}
    if(!result.text||session!==generation)return;
    segmenter.observeText(result.text,job.endSample,job.id);
    const sourceText=replaceRules(result.text,glossary.preCorrections);
    if(job.final){
      const asrEndMs=performance.now()-job.endedAt;
      const item={id:job.id,timelineToken,speechStartEpoch:job.speechStartEpoch,speechEndEpoch:job.speechEndEpoch,videoSequence:youtubeMedia.sequence,videoStartTime:Number.isFinite(youtubeMedia.mediaTime)?youtubeMedia.mediaTime+(job.speechStartEpoch-youtubeMedia.epoch)/1000*(youtubeMedia.rate||1):null,source:sourceText,sourceLanguage:result.detectedLanguage,asrEndMs,inferenceMs:result.inferenceMs,endedAt:job.endedAt,forced:job.forced,final:true,...(settings.debugMode?{rawAsr:result.text,asrDiagnostics:{vad:result.vad,languageDetectionMs:result.languageDetectionMs,requestedLanguage:settings.language,detectedLanguage:result.detectedLanguage}}:{} )};
      await emit({message:'本地辨識／翻譯中',metrics:{asrEndMs,dropped:jobs.dropped+dropped}}, {...item,final:false});
      translations.push(item);if(translations.length>2){translations.shift();dropped++;}pumpTranslation(session);
    }
    // Partial recognition is speculative only; never display unfinished guesses as final subtitles.
  }catch(e){if(job.timelineToken===timelineToken)await fatal(e,session);}finally{if(session===generation){asrBusy=false;pumpASR(session);pumpTranslation(session);}}
}
async function pumpTranslation(session){
  if(translationBusy||session!==generation)return;const item=translations.shift();if(!item){if(!asrBusy&&!jobs.finals.length)pumpChat(session);return;}translationBusy=true;const started=performance.now();
  let diagnostics;
  try{
    const references=settings.contextMode==='source'?contextSources(history).join('\n'):'';
    const terms=relevantTerms(item.source,termsFor(glossary,settings.profile),references);
    const prompt=translationPrompt(item.source,terms,history,settings);
    if(settings.debugMode)diagnostics={debug:true,prompt,terms,language:settings.language,asr:settings.asr,engine:settings.translator,model:loadedModelId,revision:translationRevision};
    const key=JSON.stringify([translationRevision,settings.translator,settings.localLlmId,settings.language,prompt,glossary.postCorrections]);
    let text=await cacheGet(key);const cacheHit=!!text;let rawTranslation=cacheHit?null:text,retryReason=null;
    if(!text){
      if(chromeTranslator){const masked=maskTerms(item.source,terms);const output=await chromeTranslator.translate(masked.text);for(const [marker]of masked.map)if(!output.includes(marker))throw Error('Chrome Translator 改寫了詞彙標記，請改用 Gemma');text=masked.restore(output);}
      else text=await translator.call('translate',{prompt},[],20000);
      rawTranslation=text;text=replaceRules(toTW(text),glossary.postCorrections).trim();
    }
    if(session!==generation||item.timelineToken!==timelineToken)return;
    retryReason=translationAnomaly(item.source,text,history,{...settings,approvedTargets:terms.map(t=>t.target)});
    if(diagnostics)Object.assign(diagnostics,{cacheHit,firstRawTranslation:rawTranslation,firstProcessedTranslation:text,retryReason});
    if(retryReason&&translator){
      const plan=retryPlan(item.source,terms,settings),retryPrompt=plan.prompt;if(diagnostics)diagnostics.retryPrompt=retryPrompt;
      history=[];rawTranslation=await translator.call('translate',{prompt:retryPrompt},[],20000);
      text=replaceRules(toTW(restoreRetryOutput(rawTranslation,plan)),glossary.postCorrections).trim();
      if(diagnostics)Object.assign(diagnostics,{rawTranslation,retryProcessedTranslation:text});
      if(translationAnomaly(item.source,text,[],{approvedTargets:terms.map(t=>t.target)}))throw Error('模型重試仍輸出不完整譯文，暫時顯示原文；請匯出量測紀錄協助確認');
    }
    if(!text)throw Error('譯文為空');
    if(session!==generation||item.timelineToken!==timelineToken)return;
    if(!cacheHit||retryReason)await cachePut(key,text);
    history.push({source:item.source,translation:text,at:Date.now()});history=history.slice(-3);
    const translationMs=performance.now()-started;
    await emit({message:'字幕已更新，持續聆聽',metrics:{asrEndMs:item.asrEndMs,translationMs,dropped:jobs.dropped+dropped}},{...item,translation:text,translationMs,totalEndMs:performance.now()-item.endedAt,translationDiagnostics:{revision:translationRevision,engine:settings.translator,model:loadedModelId,cacheHit,retryReason,rawTranslation,...diagnostics}});
  }catch(e){if(session!==generation||item.timelineToken!==timelineToken)return;await emit({message:'翻譯失敗：'+e.message},{...item,error:e.message,translationDiagnostics:diagnostics,translationMs:performance.now()-started});}
  finally{if(session===generation){translationBusy=false;pumpTranslation(session);}}
}
async function pumpChat(session){if(settings.chatEngine==='chrome'){pumpMachineChat(session);return;}if(translationBusy||!chatQueue.length||session!==generation||!context)return;const item=chatQueue.shift();if(Date.now()-item.at>CHAT_MAX_AGE_MS){sendChat(item,{error:'訊息已過期'});pumpTranslation(session);return;}translationBusy=true;const revision=chatRevision;try{const text=replaceRules(item.text,glossary.preCorrections),terms=relevantTerms(text,termsFor(glossary,settings.profile));const prompt=translationPrompt(text,terms,[],{translator:settings.translator}),key=JSON.stringify(['chat',loadedModelId,prompt,glossary.postCorrections]);let output=translationCache.get(key);const t=performance.now();if(!output){output=await translator.call('translate',{prompt,maxTokens:64},[],20000);output=replaceRules(toTW(output),glossary.postCorrections).trim();if(!output||translationAnomaly(text,output,[]))throw Error('無有效譯文');translationCache.put(key,output);}if(session===generation&&revision===chatRevision)sendChat(item,{translation:output,ms:performance.now()-t});}catch(e){if(session===generation&&revision===chatRevision)sendChat(item,{error:e.message});}finally{if(session===generation){translationBusy=false;pumpTranslation(session);}}}
function sendChat(item,result){return chrome.runtime.sendMessage({to:'background',type:'chatResult',tabId,frameId:item.frameId,id:item.id,...result}).catch(()=>{});}
const translationCache=new MemoryCache();
async function pumpMachineChat(session){
 if(machineChatBusy||!chatQueue.length||session!==generation||!context||settings.chatEngine!=='chrome')return;
 const item=chatQueue.shift(),revision=chatRevision;machineChatBusy=true;
 try{
  if(Date.now()-item.at>CHAT_MAX_AGE_MS)throw Error('訊息已過期');
  const text=replaceRules(item.text,glossary.preCorrections),language=settings.chatLanguage;
  const terms=relevantTerms(text,termsFor(glossary,settings.profile)),masked=maskTerms(text,terms);
  const key=JSON.stringify(['chrome-chat',language,text,terms,glossary.postCorrections]);
  const started=performance.now();let output=translationCache.get(key);
  if(!output){
   const raw=await machineChat.translate(masked.text,language,text);
   for(const [marker]of masked.map)if(!raw.includes(marker))throw Error('Chrome 改寫詞彙標記');
   output=replaceRules(toTW(masked.restore(raw)),glossary.postCorrections).trim();
   if(!output||translationAnomaly(text,output,[],{approvedTargets:terms.map(t=>t.target)}))throw Error('無有效譯文');
   if(session===generation&&revision===chatRevision)translationCache.put(key,output);
  }
  if(session===generation&&revision===chatRevision)sendChat(item,{translation:output,ms:performance.now()-started});
 }catch(e){if(session===generation&&revision===chatRevision)sendChat(item,{error:e.message});}
 finally{machineChatBusy=false;if(context&&settings.chatEngine==='chrome')pumpMachineChat(generation);else if(context)pumpTranslation(generation);}
}

async function cacheGet(key){return translationCache.get(key);}
async function cachePut(key,value){translationCache.put(key,value);}

chrome.runtime.onMessage.addListener((m,sender,respond)=>{
  if(m.to!=='offscreen'||sender.id!==chrome.runtime.id)return;
  if(m.type==='diagnostics'){respond({playbackDelayMs:(playbackDelay?.delayTime.value||0)*1000,audioContextState:context?.state||'closed',captureTracks:media?.getTracks().filter(t=>t.readyState==='live').length||0,chatQueued:chatQueue.length,chatEngine:settings?.chatEngine,machineChatBusy,timelineToken,contextSources:contextSources(history),effectiveSegmentMs:segmenter?.maxMs,youtubeCapture});return;}
  if(m.type==='runtimeSettings'){try{const next=validateSettings(m.settings);if(next.chatEngine!==settings.chatEngine||next.chatLanguage!==settings.chatLanguage||next.chatTranslation!==settings.chatTranslation)resetChat();const changed=settings.youtubeMode!==next.youtubeMode||settings.youtubeDelayMs!==next.youtubeDelayMs;settings=next;history=[];if(changed&&context)resetTimeline(youtubeMedia);respond({ok:true});}catch(e){respond({error:e.message});}return;}
  if(m.type==='youtubeMedia'){if((m.sequence||0)<(youtubeMedia.sequence||0)){respond({ok:true});return;}youtubeMedia=m;if(playbackGain)playbackGain.gain.setValueAtTime(m.paused?0:1,context.currentTime);respond({ok:true});return;}
  if(m.type==='youtubeReset'){if(settings&&(m.sequence||0)>=(youtubeMedia.sequence||0))resetTimeline(m);respond({ok:true});return;}
  if(m.type==='youtubeDelayError'){if(settings){settings.youtubeMode='live';playback();}respond({ok:true});return;}
  if(m.type==='chat'){if(!ready||!context||(settings.chatEngine==='llm'&&!translator)){respond({error:'請先啟動直播翻譯並選擇可用的聊天室引擎'});return;}for(const item of m.items){chatQueue.push({...item,frameId:m.frameId,at:Date.now()});if(chatQueue.length>CHAT_QUEUE_LIMIT)sendChat(chatQueue.shift(),{error:'佇列已滿'});}if(settings.chatEngine==='chrome')pumpMachineChat(generation);else pumpTranslation(generation);respond({queued:true});return;}
  if(m.type==='glossary'){try{glossary=validateGlossary(m.glossary);history=[];respond({ok:true});}catch(e){respond({error:e.message});}return;}
  if(m.type==='debugMode'){if(settings)settings.debugMode=m.enabled===true;respond({ok:true});return;}
  if(m.type==='prepare'){prepare(m);respond({ok:true});return;}
  if(m.type==='start'){start(m).then(()=>respond({ok:true}),e=>respond({error:e.message}));return true;}
  if(m.type==='pause'){pauseCapture().then(()=>respond({ok:true}),e=>respond({error:e.message}));return true;}
  if(m.type==='stop'){stop().then(()=>respond({ok:true}),e=>respond({error:e.message}));return true;}
});
