import {chromium} from 'playwright';import path from 'node:path';import {readFile,writeFile,mkdir,mkdtemp,readdir,stat} from 'node:fs/promises';import {randomBytes,createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {freshProfile} from './fresh-profile.mjs';
await mkdir('verification',{recursive:true});await mkdir('.installer-test',{recursive:true});
const fixture=await mkdtemp(path.resolve('.installer-test/fresh-download-')),root=path.join(fixture,'app'),nativeName='com.livelocaltranslator.test.'+randomBytes(8).toString('hex');
const fixtureScript=path.resolve('tests/fresh-install-fixture.ps1');
function setup(mode){return execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',fixtureScript,'-Mode',mode,'-Root',root,'-NativeName',nativeName],{windowsHide:true,encoding:'utf8'});}
const report={at:new Date().toISOString(),scope:'Blank model folders + real packaged installer/native download API + Chrome WebGPU',nativeName,fixture:root};let ctx;
async function waitFor(read,predicate,timeout=180000){for(const end=Date.now()+timeout;Date.now()<end;){const value=await read();if(predicate(value))return value;await new Promise(r=>setTimeout(r,200));}throw Error('Fresh install test timed out');}
try{
 setup('install');ctx=await chromium.launchPersistentContext(await freshProfile('fresh-download'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions','--disable-component-update','--disable-background-networking'],args:['--enable-unsafe-extension-debugging']});
 const cdp=await ctx.browser().newBrowserCDPSession(),{id}=await cdp.send('Extensions.loadUnpacked',{path:path.join(root,'extension')});const page=await ctx.newPage();await page.goto(`chrome-extension://${id}/options.html`);await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 const send=(type,data={})=>page.evaluate(m=>chrome.runtime.sendMessage({to:'background',...m}),{type,...data});
 const state=async()=> (await page.evaluate(()=>chrome.storage.session.get('state'))).state||{};
 const before=await send('models');if(before.models.whisper.some(m=>m.ready)||before.models.llm.some(m=>m.ready))throw Error('Fixture is not blank');report.emptyModels=true;
 await page.selectOption('#translator','chrome');await page.selectOption('#language','en');await page.selectOption('#chatLanguage','en');await page.click('#prepareChatTranslator');await page.waitForFunction(()=>!document.querySelector('#prepareChatTranslator').disabled,{timeout:90000});if(!(await page.locator('#chatTranslatorStatus').textContent()).includes('已就緒'))throw Error('Chrome language pair unavailable');
 await page.click('#settings button[type=submit]');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('已儲存'));
 const p=await send('prepare');if(p.error)throw Error(p.error);
 await waitFor(()=>send('downloadStatus'),s=>s.state==='downloading'&&s.bytes>1000000&&s.bytes<s.total-10000000&&s.file.endsWith('.onnx'));
 const released=await send('release');if(released.error)throw Error(released.error);const cancelled=await send('downloadStatus');if(cancelled.state!=='cancelled')throw Error('Release did not cancel native download');
 const onnx=path.join(root,'models/whisper/whisper-tiny/onnx'),partial=(await readdir(onnx)).find(f=>f.endsWith('.download'));if(!partial)throw Error('Partial progress not retained');report.cancel={state:cancelled.state,partialBytes:(await stat(path.join(onnx,partial))).size};if((await state()).loading)throw Error('Cancelled prepare left loading state');
 await send('prepare');const ready=await waitFor(state,s=>{if(s.error)throw Error(s.error);return s.ready;},300000);report.ready=ready.activeModels;
 const folder=path.join(root,'models/whisper/whisper-tiny'),receiptText=await readFile(path.join(folder,'.model-ready.json'),'utf8'),receipt=JSON.parse(receiptText);
 for(const f of receipt.files){const data=await readFile(path.join(folder,f.file));if(data.length!==f.bytes||createHash('sha256').update(data).digest('hex')!==f.sha256)throw Error('Downloaded file hash mismatch');}report.whisperSha256Verified=true;
 await send('release');await send('prepare');await waitFor(state,s=>{if(s.error)throw Error(s.error);return s.ready;});if(await readFile(path.join(folder,'.model-ready.json'),'utf8')!==receiptText)throw Error('Complete model was downloaded again');report.repeatWarmupSkipsDownload=true;
 await send('release');const starter=await send('downloadModel',{modelId:'gemma-4-E2B'});if(starter.error)throw Error(starter.error);await waitFor(()=>send('downloadStatus'),s=>{if(s.state==='error')throw Error(s.error);return s.bytes>1000000;});await send('downloadCancel');await waitFor(()=>send('downloadStatus'),s=>s.state==='cancelled');report.starterDownloadWithoutAccount=true;
 report.passed=true;
}catch(e){report.error=e.stack;throw e;}finally{await ctx?.close();try{setup('cleanup');report.testRegistrationRemoved=true;}catch(e){report.cleanupError=e.message;}await writeFile('verification/fresh-install-download.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
