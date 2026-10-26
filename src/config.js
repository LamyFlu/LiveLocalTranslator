import {CHAT_MAX_PER_MINUTE} from './chat-policy.js';
export const defaults={language:'ja',asr:'tiny',translator:'gemma2',silenceMs:220,threshold:0.012,profile:'default',speechMode:'adaptive',maxSegmentMs:8000,modelSource:'installed',autoDownloadModels:true,localWhisperId:'',localLlmId:'',memoryPreset:'custom',debugMode:false,speechFilter:'silero',vadThreshold:.5,minSpeechMs:160,youtubeMode:'live',youtubeDelayMs:6000,chatTranslation:false,chatEngine:'llm',chatLanguage:'ja',chatMaxPerMinute:2000,contextMode:'none',chinaModelAcknowledged:false};
export const gpuPresets={
  '4':{asr:'tiny',translator:'chrome',speechMode:'adaptive',maxSegmentMs:6000,silenceMs:260},
  '6':{asr:'tiny',translator:'gemma2',speechMode:'adaptive',maxSegmentMs:6000,silenceMs:220},
  '8':{asr:'base',translator:'gemma2',speechMode:'adaptive',maxSegmentMs:8000,silenceMs:220},
  '12':{asr:'small',translator:'gemma2',speechMode:'adaptive',maxSegmentMs:8000,silenceMs:240},
  '16':{asr:'large-v3-turbo',translator:'gemma4',speechMode:'adaptive',maxSegmentMs:8000,silenceMs:240},
  '24':{asr:'large-v3-turbo',translator:'gemma4',speechMode:'adaptive',maxSegmentMs:10000,silenceMs:240}
};
export const emptyGlossary={schemaVersion:1,cards:[],preCorrections:[],postCorrections:[]};
export function validateSettings(s={}){
  const out={...defaults,...s};
  if(out.translator==='mlc-gemma9'){out.translator='gemma12';if(out.localLlmId==='gemma-2-9b-it-q4f16_1-MLC')out.localLlmId='';}
  if(out.localLlmId==='gemma-2-9b-it-q4f16_1-MLC')out.localLlmId='';
  if(!['auto','auto-en-ja','ja','en','ko','fr','de','es'].includes(out.language)) throw Error('不支援的來源語言');
  if(!['tiny','base','small','medium','large-v3-turbo'].includes(out.asr)) throw Error('不支援的辨識模型');
  if(!['gemma2','gemma4','chrome','gemma12','mlc-llama8','mlc-mistral7','mlc-qwen4'].includes(out.translator)) throw Error('不支援的翻譯引擎');
  if(out.language.startsWith('auto')&&out.translator==='chrome')throw Error('自動來源語言需搭配 Gemma 或 WebLLM；Chrome Translator 目前需固定來源語言');
  if(!['silero','rms'].includes(out.speechFilter))throw Error('不支援的人聲過濾模式');
  out.vadThreshold=Number(out.vadThreshold);out.minSpeechMs=Number(out.minSpeechMs);
  if(!Number.isFinite(out.vadThreshold)||out.vadThreshold<.2||out.vadThreshold>.9)throw Error('人聲機率門檻需為 0.2–0.9');
  if(!Number.isFinite(out.minSpeechMs)||out.minSpeechMs<64||out.minSpeechMs>600)throw Error('最少人聲時間需為 64–600ms');
  out.silenceMs=Number(out.silenceMs);out.threshold=Number(out.threshold);
  if(!Number.isFinite(out.silenceMs)||out.silenceMs<120||out.silenceMs>800)throw Error('靜音時間需為 120–800ms');
  if(!Number.isFinite(out.threshold)||out.threshold<0.002||out.threshold>0.15)throw Error('RMS 門檻需為 0.002–0.15');
  if(!['adaptive','fixed'].includes(out.speechMode))throw Error('不支援的切段模式');
  out.maxSegmentMs=Number(out.maxSegmentMs);if(!Number.isFinite(out.maxSegmentMs)||out.maxSegmentMs<4000||out.maxSegmentMs>12000)throw Error('最長片段需為 4000–12000ms');
  if(!['installed','browser'].includes(out.modelSource))throw Error('不支援的模型來源');
  if((out.translator.startsWith('mlc-')||out.translator==='gemma12')&&out.modelSource!=='installed')throw Error('較大 LLM 需使用安裝目錄模型來源');
  if(![true,false,'true','false'].includes(out.debugMode))throw Error('不支援的除錯模式設定');out.debugMode=out.debugMode===true||out.debugMode==='true';
  for(const key of ['localWhisperId','localLlmId']){out[key]=String(out[key]||'');if(out[key]&&!/^[a-zA-Z0-9._-]{1,100}$/.test(out[key]))throw Error('模型資料夾名稱僅支援英數、點、底線及連字號');}
  for(const key of ['chatTranslation','chinaModelAcknowledged','autoDownloadModels']){if(![true,false,'true','false'].includes(out[key]))throw Error('不支援的開關設定');out[key]=out[key]===true||out[key]==='true';}
  if(!['live','delayed'].includes(out.youtubeMode))throw Error('不支援的 YouTube 同步模式');
  out.youtubeDelayMs=Number(out.youtubeDelayMs);if(!Number.isFinite(out.youtubeDelayMs)||out.youtubeDelayMs<2000||out.youtubeDelayMs>10000)throw Error('YouTube 延遲需為 2000–10000ms');
  out.chatMaxPerMinute=Number(out.chatMaxPerMinute);if(!Number.isInteger(out.chatMaxPerMinute)||out.chatMaxPerMinute<1||out.chatMaxPerMinute>CHAT_MAX_PER_MINUTE)throw Error('聊天室每分鐘上限需為 1–2000');
  if(!['none','source'].includes(out.contextMode))throw Error('不支援的跨句模式');
  if(out.translator==='mlc-qwen4'&&!out.chinaModelAcknowledged)throw Error('使用 Qwen 前請先閱讀並確認中國來源模型警語');
  if(!['llm','chrome'].includes(out.chatEngine))throw Error('不支援的聊天室翻譯引擎');
  if(!['auto-en-ja','ja','en','ko','fr','de','es'].includes(out.chatLanguage))throw Error('不支援的聊天室來源語言');
  if(out.chatTranslation&&out.chatEngine==='llm'&&out.translator==='chrome')throw Error('聊天室翻譯請使用本機 LLM 引擎');
  out.profile=String(out.profile||'default').slice(0,100);return out;
}
