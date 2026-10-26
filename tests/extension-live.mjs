// Loads the production extension in an isolated Chrome test profile using CDP.
// All media and model code is the shipped code; no mocks or test-only hooks.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const fixturePath=path.resolve('verification/jfk.wav');await mkdir('verification',{recursive:true});
try{await readFile(fixturePath);}catch{const r=await fetch('https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav');if(!r.ok)throw Error('Fixture download '+r.status);await writeFile(fixturePath,Buffer.from(await r.arrayBuffer()));}
const server=createServer(async(req,res)=>{if(req.url==='/jfk.wav'){res.setHeader('Content-Type','audio/wav');res.end(await readFile(fixturePath));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>English audio capture fixture</title><audio id="audio" src="/jfk.wav" controls loop></audio><button id="play">Play</button><script>play.onclick=()=>audio.play()</script>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const ctx=await chromium.launchPersistentContext(path.resolve('.extension-live-profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions','--mute-audio'],args:['--enable-unsafe-extension-debugging']});
const report={date:new Date().toISOString(),browser:await ctx.browser().version(),events:[]};
try{
 const cdp=await ctx.browser().newBrowserCDPSession();const {id}=await cdp.send('Extensions.loadUnpacked',{path:path.resolve('dist')});
 const sw=ctx.serviceWorkers().find(s=>s.url().includes(id))||await ctx.waitForEvent('serviceworker',{timeout:10000});
 const control=await ctx.newPage();await control.goto(`chrome-extension://${id}/options.html`);
 const send=(type)=>control.evaluate(type=>chrome.runtime.sendMessage({to:'background',type}),type);
 const state=()=>control.evaluate(()=>chrome.storage.session.get(['state','history']));
 const resident=async()=>{const {targetInfos}=await cdp.send('Target.getTargets',{filter:[{}]});return {workers:targetInfos.filter(t=>t.type==='worker'&&t.url.startsWith(`chrome-extension://${id}/`)&&/asr-worker|translation-worker/.test(t.url)).map(t=>({id:t.targetId,url:t.url})).sort((a,b)=>a.url.localeCompare(b.url)),documents:await control.evaluate(()=>chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}))};};
 await sw.evaluate(()=>chrome.storage.local.set({settings:{language:'ja',asr:'tiny',translator:'gemma2',silenceMs:220,threshold:.012,profile:'default'},glossary:{schemaVersion:1,cards:[],preCorrections:[],postCorrections:[]}}));
 let lastMessage='';async function ready(){for(let i=0;i<1200;i++){const s=(await state()).state||{};if(s.ready)return s;if(s.error)throw Error(s.error);if(s.message!==lastMessage&&(!s.message?.includes('下載')||i%10===0)){console.log(s.message);lastMessage=s.message;}await new Promise(r=>setTimeout(r,500));}throw Error('Model warmup timeout');}
 console.log('PREPARE',JSON.stringify(await send('prepare')));await ready();report.residentBefore=await resident();
 // User's YouTube page. No login, account change, or interaction beyond playback.
 const video=await ctx.newPage();await video.goto('https://www.youtube.com/watch?v=9uAPGEMcW38',{waitUntil:'domcontentloaded',timeout:45000});await video.waitForTimeout(2500);await video.evaluate(()=>document.querySelector('video')?.play().catch(()=>{}));
 async function invoke(page){await page.bringToFront();const {targetInfos}=await cdp.send('Target.getTargets',{filter:[{}]});const tab=targetInfos.find(t=>t.type==='tab'&&t.url===page.url());if(!tab)throw Error('No tab target');await cdp.send('Extensions.triggerAction',{id,targetId:tab.targetId});return send('start');}
 const result=await invoke(video);if(result?.error)throw Error(result.error);console.log('YOUTUBE START',JSON.stringify(result));
 for(let i=0;i<90;i++){const s=await state();if(s.history?.length>=2)break;if(s.state?.error)throw Error(s.state.error);await video.waitForTimeout(500);}
 const first=await state();report.events.push({test:'youtube-start',title:await video.title(),video:await video.evaluate(()=>{const v=document.querySelector('video');return v?{paused:v.paused,currentTime:v.currentTime,readyState:v.readyState}:null;}),...first});
 report.events.push({test:'stop-keeps-models',result:await send('stop'),...await state(),resident:await resident()});
 if(process.argv.includes('--idle')){console.log('Idle for 40s: verifying the resident offscreen document…');await new Promise(r=>setTimeout(r,40000));await send('status');report.events.push({test:'idle-keeps-models',...await state(),resident:await resident()});}
 const resume=await invoke(video);if(resume?.error)throw Error(resume.error);await video.waitForTimeout(2500);report.events.push({test:'resume-without-prepare',result:resume,...await state()});
 await send('stop');
 // A closed tab must stop capture without destroying resident models.
 const fixture=await ctx.newPage();await fixture.goto(`http://127.0.0.1:${server.address().port}/`);await fixture.click('#play');const second=await invoke(fixture);if(second?.error)throw Error(second.error);await fixture.waitForTimeout(1000);await fixture.close();await new Promise(r=>setTimeout(r,1000));report.events.push({test:'tab-close-keeps-models',...await state()});
 await video.bringToFront();const again=await invoke(video);if(again?.error)throw Error(again.error);await video.waitForTimeout(1000);
 report.events.push({test:'manual-release',result:await send('release'),...await state(),resident:await resident(),offscreenCount:await control.evaluate(async()=> (await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length)});
 console.log(JSON.stringify(report));await writeFile('verification/extension-live.json',JSON.stringify(report,null,2));
 for(const e of report.events.filter(e=>['stop-keeps-models','resume-without-prepare','tab-close-keeps-models','idle-keeps-models'].includes(e.test))){if(!e.state?.ready)throw Error('Resident models lost: '+e.test);if(e.resident&&JSON.stringify(e.resident.documents.map(d=>d.documentId))!==JSON.stringify(report.residentBefore.documents.map(d=>d.documentId)))throw Error('Resident document recreated: '+e.test);}
 if(report.events.at(-1).offscreenCount!==0||report.events.at(-1).state?.ready)throw Error('Manual release did not free models');
}catch(e){report.error=e.message;await writeFile('verification/extension-live.json',JSON.stringify(report,null,2));throw e;}finally{await ctx.close();server.close();}
