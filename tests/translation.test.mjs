import test from 'node:test';import assert from 'node:assert/strict';
import {translationPrompt,translationAnomaly} from '../src/glossary.js';
import {validateSettings} from '../src/config.js';
test('debug mode is explicit and accepts select string values',()=>{assert.equal(validateSettings({}).debugMode,false);assert.equal(validateSettings({debugMode:'true'}).debugMode,true);assert.equal(validateSettings({debugMode:'false'}).debugMode,false);assert.throws(()=>validateSettings({debugMode:'yes'}));});
test('untrusted previous translations never become model examples; glossary retained',()=>{
 const p=translationPrompt('次の試合です。',[{source:'黒波',target:'黑波',aliases:['クロナミ']}],[{source:'昨日の話です。',translation:'POISONED_TRANSLATION'}]);
 assert.ok(!p.includes('POISONED_TRANSLATION'));assert.ok(!p.includes('Current:'));assert.ok(!p.includes('昨日の話です。'));assert.ok(p.includes('次の試合です。'));assert.ok(p.includes('黑波'));assert.ok(p.includes('クロナミ'));
});
test('reject collapsed current label for sentences, allow genuine short now and full translations',()=>{
 assert.equal(translationAnomaly('次の試合はこのキャラクターで行きます。','現在。'),'standalone-current');
 assert.equal(translationAnomaly('今','現在'),null);assert.equal(translationAnomaly('今は休憩中です。','現在正在休息中。'),null);
 assert.equal(translationAnomaly('今天下午我打算和朋友一起出去玩。','今天下午我打算和朋友一起出去玩。'),null);
});
test('catch identical short replies across different long source sentences',()=>{
 const h=[{source:'最初の話はこれでおしまいですね。',translation:'好的。'},{source:'次は他のところを見てみましょう。',translation:'好的。'}];
 assert.equal(translationAnomaly('それではもう一度最初から説明します。','好的。',h),'repeated-short-output');
 assert.equal(translationAnomaly('はい','好的。',h),null);
});
