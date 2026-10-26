import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Controlled audio fixture</title><button id="play">Play test tone</button><script>play.onclick=()=>{const c=new AudioContext();const o=c.createOscillator();const g=c.createGain();g.gain.value=.1;o.connect(g).connect(c.destination);o.start();window.audio=c;}</script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const report=[];
for(const isolated of [true,false]){
 const dir=path.resolve('verification',isolated?'capture-before':'capture-after');await mkdir(dir,{recursive:true});
 const manifest=JSON.parse(await readFile('public/manifest.json','utf8'));manifest.name='Tab capture regression probe';manifest.background={service_worker:'probe-background.js'};manifest.action={};delete manifest.options_page;
 if(isolated){manifest.cross_origin_embedder_policy={value:'require-corp'};manifest.cross_origin_opener_policy={value:'same-origin'};}else{delete manifest.cross_origin_embedder_policy;delete manifest.cross_origin_opener_policy;}
 await writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest));
 await writeFile(path.join(dir,'probe-background.js'),`chrome.action.onClicked.addListener(async tab=>{try{if(!(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length)await chrome.offscreen.createDocument({url:'probe.html',reasons:['USER_MEDIA','WORKERS'],justification:'Regression test of real tab capture'});const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});const result=await chrome.runtime.sendMessage({type:'probe',streamId});await chrome.storage.session.set({probe:result});}catch(e){await chrome.storage.session.set({probe:{error:e.message,name:e.name}});}});`);
 await writeFile(path.join(dir,'probe.html'),'<!doctype html><script src="probe.js"></script>');
 await writeFile(path.join(dir,'probe.js'),`chrome.runtime.onMessage.addListener((m,sender,respond)=>{if(m.type!=='probe')return;(async()=>{let stream,ctx;try{stream=await navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:m.streamId}},video:false});ctx=new AudioContext();const source=ctx.createMediaStreamSource(stream);const analyser=ctx.createAnalyser();source.connect(analyser);source.connect(ctx.destination);await ctx.resume();await new Promise(r=>setTimeout(r,1000));const a=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(a);return {success:true,isolated:crossOriginIsolated,sharedArrayBuffer:typeof SharedArrayBuffer,track:stream.getAudioTracks()[0].readyState,rms:Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length)};}catch(e){return {error:e.message,name:e.name,isolated:crossOriginIsolated,sharedArrayBuffer:typeof SharedArrayBuffer};}finally{stream?.getTracks().forEach(t=>t.stop());await ctx?.close();}})().then(respond);return true;});`);
 const ctx=await chromium.launchPersistentContext(path.resolve(isolated?'.capture-before-profile':'.capture-after-profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions','--mute-audio'],args:['--enable-unsafe-extension-debugging']});
 try{
  const cdp=await ctx.browser().newBrowserCDPSession();const {id}=await cdp.send('Extensions.loadUnpacked',{path:dir});
  const sw=ctx.serviceWorkers().find(s=>s.url().includes(id))||await ctx.waitForEvent('serviceworker',{timeout:10000});
  for(const url of [`http://127.0.0.1:${server.address().port}/`,...(isolated?[]:['https://www.youtube.com/watch?v=9uAPGEMcW38'])]){
   const page=await ctx.newPage();await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000}).catch(e=>console.log('Navigation:',e.message));
   if(url.includes('127.0.0.1'))await page.click('#play');
   else{await page.waitForTimeout(2500);await page.evaluate(()=>document.querySelector('video')?.play().catch(()=>{}));}
   await sw.evaluate(()=>chrome.storage.session.remove('probe'));
   const {targetInfos}=await cdp.send('Target.getTargets',{filter:[{}]});const targetInfo=targetInfos.find(t=>t.type==='tab'&&t.url===page.url());if(!targetInfo)throw Error('No tab target: '+JSON.stringify(targetInfos.map(t=>({type:t.type,url:t.url}))));await cdp.send('Extensions.triggerAction',{id,targetId:targetInfo.targetId});
   let result;for(let i=0;i<80;i++){result=await sw.evaluate(()=>chrome.storage.session.get('probe'));if(result.probe)break;await page.waitForTimeout(100);}
   const entry={browser:await ctx.browser().version(),manifestIsolation:isolated,url,title:await page.title(),...result.probe};report.push(entry);console.log(JSON.stringify(entry));
   await sw.evaluate(async()=>{if((await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length)await chrome.offscreen.closeDocument();});await page.close();
  }
 }finally{await ctx.close();}
}
server.close();await writeFile('verification/capture-regression.json',JSON.stringify({date:new Date().toISOString(),report},null,2));
if(!report.find(r=>r.manifestIsolation===false&&r.url.includes('127.0.0.1'))?.success)throw Error('Fixed capture failed');
if(report.find(r=>r.manifestIsolation===true)?.error!=='Error starting tab capture')throw Error('Original regression did not reproduce');
