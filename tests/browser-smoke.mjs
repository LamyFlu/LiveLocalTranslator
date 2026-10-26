import {chromium} from 'playwright';import path from 'node:path';import {writeFile,mkdir} from 'node:fs/promises';
import {freshProfile} from './fresh-profile.mjs';
const ext=path.resolve('dist');await mkdir('verification',{recursive:true});
const ctx=await chromium.launchPersistentContext(await freshProfile('browser'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
const errors=[];ctx.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,300));});
try{
 const cdp=await ctx.browser().newBrowserCDPSession();const {id}=await cdp.send('Extensions.loadUnpacked',{path:ext});const sw=ctx.serviceWorkers().find(s=>s.url().includes(id))||await ctx.waitForEvent('serviceworker',{timeout:10000});const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`chrome-extension://${id}/options.html`);await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 const optionsTitle=await page.title();for(const id of ['whisper-tiny','whisper-base','whisper-small','whisper-medium','whisper-large-v3-turbo','gemma-4-E2B','gemma-4-E4B'])if(!await page.locator('#downloadModel option[value="'+id+'"]').count())throw Error('Missing fresh install download option '+id);if(await page.locator('#autoDownloadModels').inputValue()!=='true')throw Error('Automatic model download not enabled by default');await page.selectOption('#language','en');await page.fill('#chatMaxPerMinute','2000');await page.selectOption('#chatEngine','chrome');await page.selectOption('#chatLanguage','auto-en-ja');if(!(await page.locator('#chatRateAdvice').textContent()).includes('100'))throw Error('High chat rate advice absent');await page.selectOption('#asr','medium');await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));const saveBox=await page.locator('#settings button[type=submit]').boundingBox();if(!saveBox||saveBox.y<0||saveBox.y>100)throw Error('Save button not pinned at window top');await page.click('button[type=submit]');await page.waitForTimeout(500);console.log('Save notice:',await page.locator('#notice').textContent());await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('已儲存'));
 const stored=await page.evaluate(()=>chrome.storage.local.get('settings'));
 if(stored.settings.asr!=='medium')throw Error('Medium selection did not persist');if(stored.settings.chatEngine!=='chrome'||stored.settings.chatLanguage!=='auto-en-ja')throw Error('Independent chat engine did not persist');if(stored.settings.chatMaxPerMinute!==2000)throw Error('2000 chat setting did not persist');if(stored.settings.language!=='en')throw Error('settings did not persist');
 await page.goto(`chrome-extension://${id}/popup.html`);await page.waitForFunction(()=>document.querySelector('#status').textContent!=='讀取狀態…');
 await page.waitForFunction(()=>document.documentElement.dataset.quickReady==='true');await page.locator('summary').click();await page.selectOption('#quickMode','delayed');await page.fill('#quickDelay','8');await page.click('#youtubeQuick button');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('YouTube 控制已套用'));const quick=(await page.evaluate(()=>chrome.storage.local.get('settings'))).settings;if(quick.youtubeMode!=='delayed'||quick.youtubeDelayMs!==8000)throw Error('Quick YouTube controls did not persist');
 if(!await page.locator('#start').isDisabled())throw Error('start must be disabled before warmup');
 await page.screenshot({path:'verification/popup.png'});
 const gpu=await page.evaluate(async()=>{const a=await navigator.gpu?.requestAdapter();return a?{info:JSON.stringify(a.info),maxBufferSize:a.limits.maxBufferSize}:null;});
 console.log(JSON.stringify({optionsTitle,gpu,ui:'passed',errors}));
 if(process.argv.includes('--asr')){
  console.log('Loading Whisper Tiny on real WebGPU…');
  const result=await page.evaluate(async()=>{
   const worker=new Worker(chrome.runtime.getURL('asr-worker.js'),{type:'module'});let serial=0;const pending=new Map();
   worker.onmessage=({data:m})=>{if(m.progress){console.log(m.progress);return;}const p=pending.get(m.rpc);if(p){clearTimeout(p.timer);pending.delete(m.rpc);m.error?p.reject(Error(m.error)):p.resolve(m.result);}};
   worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message));};
   const call=(type,data={},transfer=[])=>new Promise((resolve,reject)=>{const rpc=++serial;const timer=setTimeout(()=>reject(Error('ASR test timeout')),600000);pending.set(rpc,{resolve,reject,timer});worker.postMessage({type,rpc,...data},transfer);});
   try{
    const loadStart=performance.now();await call('load',{size:'tiny',language:'en'});const loadMs=performance.now()-loadStart;
    const response=await fetch('https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav');if(!response.ok)throw Error('fixture fetch '+response.status);
    const ac=new AudioContext({sampleRate:16000});const audio=await ac.decodeAudioData(await response.arrayBuffer());const input=audio.getChannelData(0).slice(0,16000*4);await ac.close();
    const runs=[];for(let i=0;i<3;i++){const pcm=input.slice();runs.push(await call('recognize',{audio:pcm,language:'en'},[pcm.buffer]));}return {loadMs,seconds:input.length/16000,runs};
   }finally{worker.terminate();}
  });
  console.log(JSON.stringify(result));await writeFile('verification/asr-result.json',JSON.stringify({date:new Date().toISOString(),gpu,result,errors},null,2));
 }
 await writeFile('verification/browser-smoke.json',JSON.stringify({date:new Date().toISOString(),optionsTitle,gpu,ui:'passed',errors},null,2));
}finally{await ctx.close();}
