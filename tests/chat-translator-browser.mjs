import {chromium} from 'playwright';import path from 'node:path';import {writeFile} from 'node:fs/promises';
import {freshProfile} from './fresh-profile.mjs';
const report={at:new Date().toISOString(),scope:'Real Chrome Translator, isolated test profile; no LLM'};
const ctx=await chromium.launchPersistentContext(await freshProfile('chat-translator'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions','--disable-component-update','--disable-background-networking'],args:['--enable-unsafe-extension-debugging']});
try{
 const cdp=await ctx.browser().newBrowserCDPSession(),{id}=await cdp.send('Extensions.loadUnpacked',{path:path.resolve('dist')});
 const page=await ctx.newPage();await page.goto(`chrome-extension://${id}/options.html`);await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 report.api=await page.evaluate(async()=>({present:!!globalThis.Translator,ja:globalThis.Translator?await Translator.availability({sourceLanguage:'ja',targetLanguage:'zh-Hant'}):null,en:globalThis.Translator?await Translator.availability({sourceLanguage:'en',targetLanguage:'zh-Hant'}):null}));
 await page.selectOption('#chatLanguage','auto-en-ja');await page.click('#prepareChatTranslator');
 try{await page.waitForFunction(()=>!document.querySelector('#prepareChatTranslator').disabled,{timeout:55000});}catch{report.downloadStillPending=true;}
 if((await page.locator('#chatTranslatorStatus').textContent()).includes('再按一次')){await page.click('#prepareChatTranslator');await page.waitForFunction(()=>!document.querySelector('#prepareChatTranslator').disabled,{timeout:55000});}
 report.prepareStatus=await page.locator('#chatTranslatorStatus').textContent();
 if(report.prepareStatus.includes('已就緒')){
  report.samples=await page.evaluate(async()=>{const t=await Translator.create({sourceLanguage:'ja',targetLanguage:'zh-Hant'}),samples=[];try{for(const source of ['次の曲を楽しみにしています。','今日はとても楽しかったです。','ZXQ0QXZにやらせた方がいいんじゃない']){const start=performance.now(),translation=await t.translate(source);samples.push({source,translation,ms:performance.now()-start});}}finally{t.destroy();}return samples;});
 }
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'verification/settings-chat.png',fullPage:true});
}catch(e){report.error=e.stack;throw e;}finally{await writeFile('verification/chat-translator-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await ctx.close();}
