import {chromium} from 'playwright';import path from 'node:path';import {readFile,writeFile} from 'node:fs/promises';import {freshProfile} from './fresh-profile.mjs';
const report={at:new Date().toISOString(),scope:'Real installed Whisper Medium on WebGPU, English speech fixture'};
const ctx=await chromium.launchPersistentContext(await freshProfile('medium'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
try{
 const cdp=await ctx.browser().newBrowserCDPSession(),{id}=await cdp.send('Extensions.loadUnpacked',{path:path.resolve('dist')});
 const page=await ctx.newPage();await page.goto(`chrome-extension://${id}/options.html`);await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 const audio=Array.from(await readFile('verification/jfk.wav'));
 report.result=await page.evaluate(async bytes=>{
  const port=chrome.runtime.connectNative('com.livelocaltranslator.files');const connection=await new Promise((resolve,reject)=>{port.onMessage.addListener(m=>m.error?reject(Error(m.error)):resolve(m.result));port.postMessage({id:1,op:'hello'});});
  const model=connection.models.whisper.find(m=>m.id==='whisper-medium'&&m.ready);if(!model)throw Error('Medium not installed');
  const w=new Worker(chrome.runtime.getURL('asr-worker.js'),{type:'module'});let seq=0;const pending=new Map();w.onmessage=({data:m})=>{if(m.progress)return;const p=pending.get(m.rpc);if(p){clearTimeout(p.timer);pending.delete(m.rpc);m.error?p.reject(Error(m.error)):p.resolve(m.result);}};
  const call=(type,data={})=>new Promise((resolve,reject)=>{const rpc=++seq,timer=setTimeout(()=>reject(Error('Medium '+type+' timed out')),180000);pending.set(rpc,{resolve,reject,timer});w.postMessage({rpc,type,...data});});
  let ac;try{
   let start=performance.now();await call('load',{size:'medium',language:'en',speechFilter:'silero',localId:model.id,localBase:connection.baseUrl+'/models/whisper/',encoderDtype:model.encoderDtype});const loadMs=performance.now()-start;
   ac=new AudioContext({sampleRate:16000});const decoded=await ac.decodeAudioData(new Uint8Array(bytes).buffer),audio=decoded.getChannelData(0);
   start=performance.now();const recognized=await call('recognize',{audio,language:'en',vadThreshold:.5,minSpeechMs:160});return {model,loadMs,wallMs:performance.now()-start,...recognized};
  }finally{w.terminate();port.disconnect();await ac?.close();}
 },audio);
 if(!/country|Americans/i.test(report.result.text))throw Error('Medium did not recognize known speech');report.passed=true;
}catch(e){report.error=e.stack;throw e;}finally{await writeFile('verification/medium-runtime.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await ctx.close();}
