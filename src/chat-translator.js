export const chatLanguageOptions={ja:'日文',en:'英文',ko:'韓文',fr:'法文',de:'德文',es:'西班牙文'};
export function chatTranslatorOptions(language){if(!Object.hasOwn(chatLanguageOptions,language))throw Error('不支援的聊天室來源語言');return {sourceLanguage:language,targetLanguage:'zh-Hant'};}
export function chatScriptLanguage(text){if(/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text))return 'ja';if(/[a-z]/i.test(text)&&!/[\p{Script=Han}]/u.test(text))return 'en';return null;}
// Chrome consumes user activation per download: prepare one pair per click.
export async function prepareChatLanguages(language,onProgress=()=>{},api=globalThis.Translator){
 if(!api)throw Error('此 Chrome 未提供本機 Translator');
 if(language==='auto-en-ja')throw Error('英／日模型需分別點擊準備');
 const instance=await api.create({...chatTranslatorOptions(language),monitor(m){m.addEventListener('downloadprogress',e=>onProgress(chatLanguageOptions[language],Math.round(e.loaded*100)));}});
 instance.destroy();
}
export class BrowserChatTranslator{
 constructor(api=globalThis.Translator,detectorApi=globalThis.LanguageDetector){this.api=api;this.detectorApi=detectorApi;this.revision=0;this.instances=new Map();}
 reset(){this.revision++;for(const t of this.instances.values())t.destroy();this.instances.clear();this.detector?.destroy();this.detector=null;}
 async resolveLanguage(text,language,revision){
  if(language!=='auto-en-ja')return language;
  const script=chatScriptLanguage(text);if(script)return script;
  if(!this.detectorApi)throw Error('純漢字語言不確定，請改固定日文或準備 Chrome 語言偵測器');
  if(!this.detector){
   if(await this.detectorApi.availability()!=='available')throw Error('純漢字語言不確定，請改固定日文；Chrome 語言偵測器未就緒');
   const detector=await this.detectorApi.create();if(revision!==this.revision){detector.destroy();throw Error('聊天室引擎已切換');}this.detector=detector;
  }
  const [best]=await this.detector.detect(text);const detected=best?.detectedLanguage?.split('-')[0];
  if(!['en','ja'].includes(detected)||best.confidence<.35)throw Error('非英日文字或語言不確定');
  return detected;
 }
 async translate(text,language,sourceText=text){
  if(!this.api)throw Error('此 Chrome 未提供本機 Translator');
  const revision=this.revision;let timer;
  try{return await Promise.race([(async()=>{
   const lang=await this.resolveLanguage(sourceText,language,revision);if(revision!==this.revision)throw Error('聊天室引擎已切換');
   let instance=this.instances.get(lang);
   if(!instance){
    const options=chatTranslatorOptions(lang),availability=await this.api.availability(options);
    if(availability==='unavailable')throw Error('Chrome 不支援此聊天室語言配對');
    if(availability!=='available')throw Error('請至設定頁按「準備 Chrome 語言模型」');
    instance=await this.api.create(options);if(revision!==this.revision){instance.destroy();throw Error('聊天室引擎已切換');}this.instances.set(lang,instance);
   }
   const output=await instance.translate(text);if(revision!==this.revision)throw Error('聊天室引擎已切換');return output;
  })(),new Promise((_,reject)=>{timer=setTimeout(()=>{if(revision===this.revision)this.reset();reject(Error('Chrome 聊天翻譯超過 20 秒'));},20000);})]);}finally{clearTimeout(timer);}
 }
}
