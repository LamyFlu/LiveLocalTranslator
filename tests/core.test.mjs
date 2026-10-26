import test from 'node:test';import assert from 'node:assert/strict';
import {Segmenter,LatestQueue} from '../src/segmenter.js';
import {validateGlossary,termsFor,replaceRules,relevantTerms,maskTerms} from '../src/glossary.js';
import {validateSettings,gpuPresets} from '../src/config.js';
import {readFileSync} from 'node:fs';
test('manifest keeps audio consumer outside cross-origin isolation without relaxing script CSP',()=>{const m=JSON.parse(readFileSync(new URL('../public/manifest.json',import.meta.url)));assert.equal(m.cross_origin_embedder_policy,undefined);assert.equal(m.cross_origin_opener_policy,undefined);assert.match(m.content_security_policy.extension_pages,/script-src 'self' 'wasm-unsafe-eval'/);assert.ok(m.permissions.includes('offscreen'));assert.ok(m.permissions.includes('tabCapture'));});
const frame=v=>new Float32Array(320).fill(v);
test('220ms endpoint, no silent hallucination jobs, speculative and final inputs match',()=>{
  const s=new Segmenter();for(let i=0;i<20;i++)assert.equal(s.push(frame(0)).length,0);
  for(let i=0;i<40;i++)s.push(frame(.05));let speculative,final;
  for(let i=0;i<11;i++)for(const e of s.push(frame(0))){if(e.final)final=e;else speculative=e;}
  assert.ok(final);assert.equal(final.clock-final.endSample,3520);assert.equal(final.key,speculative.key);assert.deepEqual(final.audio,speculative.audio);
});
test('continuous speech is bounded to four seconds and next utterance has a new ID',()=>{
  const s=new Segmenter();let finals=[];for(let i=0;i<410;i++)finals.push(...s.push(frame(.08)).filter(e=>e.final));assert.equal(finals.length,2);assert.ok(finals.every(e=>e.audio.length<=64000));assert.notEqual(finals[0].id,finals[1].id);
});
test('final work supersedes partials; queue never grows indefinitely',()=>{const q=new LatestQueue(2);q.put({id:1});q.put({id:2});assert.equal(q.next().id,2);for(let id=3;id<7;id++)q.put({id,final:true});q.put({id:9});assert.equal(q.dropped,2);assert.equal(q.next().id,5);assert.equal(q.next().id,6);assert.equal(q.next(),null);});
test('approved active profile terms only; longest aliases and explicit correction rules',()=>{
 const d=validateGlossary({schemaVersion:1,cards:[{kind:'Game',name:'測試',enabled:true,status:'Approved',profile:'game',terms:[{source:'黒波',target:'黑波',aliases:['クロナミ'],status:'Approved'},{source:'pending',target:'未核准',status:'Pending'}]}]});
 assert.equal(termsFor(d,'other').length,0);const terms=termsFor(d,'game');assert.equal(terms.length,1);assert.equal(relevantTerms('クロナミです',terms).length,1);
 assert.equal(replaceRules('黒並み',[{source:'黒並み',target:'黒波',status:'Approved'}]),'黒波');assert.equal(replaceRules('黒並み',[{source:'黒並み',target:'黒波',status:'Pending'}]),'黒並み');
 const masked=maskTerms('クロナミです',terms);assert.equal(masked.restore(masked.text),'黑波です');
});
test('reject malformed model/endpoint thresholds and glossary imports',()=>{assert.throws(()=>validateSettings({asr:'remote'}));assert.throws(()=>validateSettings({silenceMs:0}));assert.throws(()=>validateSettings({threshold:NaN}));assert.throws(()=>validateGlossary({schemaVersion:2,cards:[]}));assert.throws(()=>validateGlossary({schemaVersion:1,cards:[{kind:'Game',name:'x',terms:[{}]}]}));});
test('16GB preset chooses multilingual Large Turbo and the non-Chinese-source E4B option',()=>{const s=validateSettings({...gpuPresets['16'],memoryPreset:'16'});assert.equal(s.asr,'large-v3-turbo');assert.equal(s.translator,'gemma4');assert.equal(s.speechMode,'adaptive');assert.equal(s.maxSegmentMs,8000);});
test('adaptive mode waits through continuous fast speech beyond four seconds',()=>{const s=new Segmenter({speechMode:'adaptive',maxSegmentMs:8000});const finals=[];for(let i=0;i<260;i++)finals.push(...s.push(frame(.05)).filter(e=>e.final));assert.equal(finals.length,0);for(let i=0;i<8;i++)finals.push(...s.push(frame(0)).filter(e=>e.final));assert.equal(finals.length,1);assert.equal(finals[0].forced,false);});
test('recent punctuation hints shorten a real pause but never cut ongoing speech',()=>{const s=new Segmenter({speechMode:'adaptive',maxSegmentMs:8000});for(let i=0;i<60;i++)s.push(frame(.05));s.observeText('終わりました。',s.start+s.lastVoice,s.id);let finals=[];for(let i=0;i<7;i++)finals.push(...s.push(frame(0)).filter(e=>e.final));assert.equal(finals.length,1);assert.equal(finals[0].forced,false);});
test('adaptive hysteresis preserves a quiet word ending above 70% of RMS threshold',()=>{const s=new Segmenter({speechMode:'adaptive',threshold:.012,maxSegmentMs:8000});for(let i=0;i<40;i++)s.push(frame(.05));for(let i=0;i<20;i++)assert.ok(s.push(frame(.01)).every(e=>!e.final));});
