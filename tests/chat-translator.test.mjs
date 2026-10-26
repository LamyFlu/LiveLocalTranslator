import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserChatTranslator,chatTranslatorOptions} from '../src/chat-translator.js';
import {validateSettings} from '../src/config.js';
import {prepareChatLanguages} from '../src/chat-translator.js';
test('language packs prepare one pair per gesture and release preparation instance',async()=>{const calls=[],destroyed=[];const api={create:async options=>{calls.push(options.sourceLanguage);return {destroy(){destroyed.push(options.sourceLanguage);}};}};await assert.rejects(prepareChatLanguages('auto-en-ja',()=>{},api),/分別點擊/);await prepareChatLanguages('en',()=>{},api);await prepareChatLanguages('ja',()=>{},api);assert.deepEqual(calls,['en','ja']);assert.deepEqual(destroyed,['en','ja']);});

test('chat machine translation is independent of subtitle engine and source language',()=>{
 const s=validateSettings({language:'auto',translator:'gemma4',chatTranslation:true,chatEngine:'chrome',chatLanguage:'en'});
 assert.equal(s.chatLanguage,'en');assert.equal(s.language,'auto');
 assert.equal(validateSettings({translator:'chrome',chatTranslation:true,chatEngine:'chrome'}).chatEngine,'chrome');
 assert.throws(()=>validateSettings({chatEngine:'remote'}));
 assert.throws(()=>chatTranslatorOptions('auto'));
});
test('English and Japanese translators stay resident without alternating reloads',async()=>{
 const created=[],destroyed=[];
 const engine=new BrowserChatTranslator({availability:async()=> 'available',create:async options=>{created.push(options);return {translate:async t=>'譯文 '+t,destroy(){destroyed.push(options.sourceLanguage);}};}});
 assert.equal(await engine.translate('one','en'),'譯文 one');
 await engine.translate('two','en');assert.equal(created.length,1);
 await engine.translate('三','ja');assert.deepEqual(destroyed,[]);await engine.translate('three','en');assert.equal(created.length,2);
 engine.reset();assert.deepEqual(destroyed,['en','ja']);
});
test('missing or downloadable language models fail explicitly without network fallback',async()=>{
 await assert.rejects(new BrowserChatTranslator(null).translate('hello','en'),/未提供/);
 for(const state of ['unavailable','downloadable','downloading']){
  const engine=new BrowserChatTranslator({availability:async()=>state,create(){throw Error('must not download in background');}});
  await assert.rejects(engine.translate('hello','en'),state==='unavailable'?/不支援/:/準備 Chrome/);
 }
});
test('reset during model creation destroys the late instance and rejects stale reply',async()=>{
 let finish,destroyed=false;
 const engine=new BrowserChatTranslator({availability:async()=> 'available',create:()=>new Promise(r=>{finish=r;})});
 const pending=engine.translate('hello','en');await new Promise(r=>setImmediate(r));
 engine.reset();finish({destroy(){destroyed=true;},translate(){throw Error('stale translator must not run');}});
 await assert.rejects(pending,/已切換/);assert.equal(destroyed,true);
});

test('auto English/Japanese routes original text before glossary masking and rejects unknown Han',async()=>{
 const created=[];let detectorCalls=0;const engine=new BrowserChatTranslator({availability:async()=> 'available',create:async o=>{created.push(o.sourceLanguage);return {translate:async text=>o.sourceLanguage+':'+text,destroy(){}};}},{availability:async()=> 'available',create:async()=>({detect:async text=>{detectorCalls++;return [{detectedLanguage:text==='大丈夫'?'ja':'zh',confidence:.9}];},destroy(){}})});
 assert.equal(await engine.translate('ZXQ0QXZ','auto-en-ja','リオナです'),'ja:ZXQ0QXZ');
 assert.equal(await engine.translate('Hello!','auto-en-ja'),'en:Hello!');
 assert.equal(await engine.translate('大丈夫','auto-en-ja'),'ja:大丈夫');
 await assert.rejects(engine.translate('中文留言','auto-en-ja'),/非英日/);assert.equal(detectorCalls,2);assert.deepEqual(created,['ja','en']);engine.reset();
});
