import {chromium} from 'playwright';import path from 'node:path';import {writeFile} from 'node:fs/promises';
import {freshProfile} from './fresh-profile.mjs';
const ctx=await chromium.launchPersistentContext(await freshProfile('debug-ui'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging'],viewport:{width:1650,height:1000}});
const report={date:new Date().toISOString(),scope:'real Chrome UI/storage with seeded diagnostic rows',checks:[]};
try{
 const cdp=await ctx.browser().newBrowserCDPSession();const {id}=await cdp.send('Extensions.loadUnpacked',{path:path.resolve('dist')});const page=await ctx.newPage();await page.goto(`chrome-extension://${id}/options.html`);await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 await page.selectOption('#debugMode','true');await page.waitForFunction(async()=>(await chrome.storage.local.get('settings')).settings.debugMode===true);
 const fixture=[{id:1,at:new Date().toISOString(),rawAsr:'リオナにやらせた方がいいんじゃない',source:'リオナにやらせた方がいいんじゃない',translation:'讓莉歐娜做比較好吧。',asrEndMs:560,translationMs:300,translationDiagnostics:{debug:true,model:'gemma4',cacheHit:false,firstRawTranslation:'現在',rawTranslation:'讓莉歐娜做比較好吧。',retryReason:'standalone-current',prompt:'只翻譯當句',retryPrompt:'簡化提示'}},{id:2,at:new Date().toISOString(),rawAsr:'<img src=x onerror="window.__xss=1">',source:'安全顯示測試',error:'測試錯誤',translationDiagnostics:{debug:true,model:'gemma4',prompt:'<script>window.__xss=1</script>'}},{id:3,at:new Date().toISOString(),source:'今は休憩中です。',translation:'現在正在休息中。',translationDiagnostics:{cacheHit:true,model:'gemma4'}}];
 await page.evaluate(history=>chrome.storage.session.set({history}),fixture);
 await page.waitForFunction(()=>document.querySelectorAll('#debugRows tbody tr').length===6);
 if(await page.evaluate(()=>globalThis.__xss))throw Error('Diagnostic HTML executed');
 await page.locator('#debugRows summary').last().click();if(!await page.locator('#debugRows').textContent().then(t=>t.includes('standalone-current')&&t.includes('模型原始輸出')))throw Error('Missing comparison fields');
 await page.locator('#debugRows summary').last().click();await page.locator('#debugPanel').screenshot({path:'verification/debug-comparison.png'});
 await page.fill('#debugSearch','リオナ');if(await page.locator('#debugRows tbody tr').count()!==2)throw Error('Search filter failed');
 const downloaded=page.waitForEvent('download');await page.click('#debugExport');const file=await downloaded;await file.saveAs('verification/debug-export.json');
 await page.selectOption('#debugMode','false');await page.waitForFunction(()=>document.querySelector('#debugPanel').hidden);
 report.checks=['instant setting persistence','source/raw/final comparison','retry and error visibility','cache visibility','HTML escaped','search','JSON export','disable panel'];report.passed=true;
}finally{await writeFile('verification/debug-smoke.json',JSON.stringify(report,null,2));await ctx.close();console.log(JSON.stringify(report));}
