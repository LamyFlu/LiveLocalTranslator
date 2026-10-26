import {chromium} from 'playwright';
import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
const ctx=await chromium.launchPersistentContext(path.resolve('.installed-profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
const result={date:new Date().toISOString(),remoteRequests:[],errors:[]};
try{
 const cdp=await ctx.browser().newBrowserCDPSession();const {id}=await cdp.send('Extensions.loadUnpacked',{path:path.resolve('dist')});
 ctx.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))result.remoteRequests.push(r.url());});
 const page=await ctx.newPage();page.on('pageerror',e=>result.errors.push(e.message));page.on('console',m=>{if(!m.text().startsWith('Whisper '))console.log(m.type(),m.text().slice(0,650));});
 await page.goto(`chrome-extension://${id}/options.html`);await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 await page.selectOption('#memoryPreset','16');await page.click('#applyPreset');await page.click('#settings button[type=submit]');
 await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('已儲存'));
 result.settings=(await page.evaluate(()=>chrome.storage.local.get('settings'))).settings;
 if(result.settings.asr!=='large-v3-turbo'||result.settings.translator!=='gemma4')throw Error('16GB preset mismatch');
 await page.click('#refreshModels');await page.waitForTimeout(1500);console.log('Model status:',await page.locator('#modelStatus').textContent());
 await page.waitForFunction(()=>document.querySelector('#modelStatus').textContent.includes('Whisper 4'));
 await page.screenshot({path:'verification/installed-settings.png',fullPage:true});
 const wav=(await readFile('verification/jfk.wav')).toString('base64');
 result.runtime=await page.evaluate(async(wav)=>{
  const port=chrome.runtime.connectNative('com.livelocaltranslator.files');
  const connection=await new Promise((resolve,reject)=>{port.onMessage.addListener(m=>m.error?reject(Error(m.error)):resolve(m.result));port.onDisconnect.addListener(()=>reject(Error(chrome.runtime.lastError?.message||'native disconnected')));port.postMessage({id:1,op:'hello'});});
  console.log('Catalog ready',JSON.stringify(connection.models));
  function worker(file){const w=new Worker(chrome.runtime.getURL(file),file==='translation-worker.js'?{}:{type:'module'});let id=0;const pending=new Map();w.onmessage=({data:m})=>{if(m.progress){console.log(m.progress);return;}const p=pending.get(m.rpc);if(p){clearTimeout(p.timer);pending.delete(m.rpc);m.error?p.reject(Error(m.error)):p.resolve(m.result);}};return {w,call:(type,data={},transfer=[])=>new Promise((resolve,reject)=>{const rpc=++id;const timer=setTimeout(()=>reject(Error('Worker timeout '+file)),600000);pending.set(rpc,{resolve,reject,timer});w.postMessage({rpc,type,...data},transfer);})};}
  const asr=worker('asr-worker.js'),llm=worker('translation-worker.js');const start=performance.now();
  try{
   await asr.call('load',{size:'large-v3-turbo',language:'en',localId:'whisper-large-v3-turbo',localBase:connection.baseUrl+'/models/whisper/',encoderDtype:'fp16'});
   const asrLoadMs=performance.now()-start;console.log('Large ASR loaded',asrLoadMs);
   const lm=connection.models.llm.find(x=>x.id==='gemma-4-E4B');const lstart=performance.now();await llm.call('load',{model:'gemma4',localUrl:connection.baseUrl+'/models/llm/'+lm.id+'/'+lm.file});const llmLoadMs=performance.now()-lstart;console.log('E4B loaded',llmLoadMs);
   const bytes=Uint8Array.from(atob(wav),x=>x.charCodeAt(0));const ac=new AudioContext({sampleRate:16000});const audio=await ac.decodeAudioData(bytes.buffer);const input=audio.getChannelData(0).slice(0,64000);await ac.close();
   const runs=[];for(let i=0;i<3;i++){const pcm=input.slice();runs.push(await asr.call('recognize',{audio:pcm,language:'en'},[pcm.buffer]));}
   const trStart=performance.now();const translated=await llm.call('translate',{prompt:'Translate into Traditional Chinese. Output only the translation, without explanations: '+runs.at(-1).text});
   return {models:connection.models,asrLoadMs,llmLoadMs,audioSeconds:input.length/16000,runs,translated,translationMs:performance.now()-trStart};
  }finally{asr.w.terminate();llm.w.terminate();port.disconnect();}
 },wav);
 if(result.remoteRequests.length)throw Error('Installed model mode used remote network');
 if(!result.runtime.runs.every(r=>r.text.length>0)||!result.runtime.translated)throw Error('Empty recognition/translation');
 const prep=await page.evaluate(()=>chrome.runtime.sendMessage({to:'background',type:'prepare'}));if(prep.error)throw Error(prep.error);
 const deadline=Date.now()+120000;let ready=false;while(Date.now()<deadline){const {state={}}=await page.evaluate(()=>chrome.storage.session.get('state'));if(state.error)throw Error(state.error);if(state.ready===true){ready=true;break;}await new Promise(r=>setTimeout(r,250));}if(!ready)throw Error('Offscreen warmup timeout');
 result.offscreenReady=true;
 const released=await page.evaluate(()=>chrome.runtime.sendMessage({to:'background',type:'release'}));if(released.error)throw Error(released.error);
 result.offscreenReleased=true;
 result.passed=true;
}catch(e){result.passed=false;result.errors.push(e.stack);throw e;}finally{await writeFile('verification/installed-runtime.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await ctx.close();}
