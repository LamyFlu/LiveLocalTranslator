import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {defaults,gpuPresets,validateSettings} from '../src/config.js';
import {whisperModels,starterModels} from '../src/whisper-catalog.js';
import {ensureModelFiles,missingModelDownloads} from '../src/model-setup.js';

test('fresh default and every GPU preset have pinned downloadable Whisper and LLM',()=>{
 const catalog=JSON.parse(readFileSync('public/model-catalog.json','utf8'));assert.deepEqual(whisperModels.map(m=>m.engine),['tiny','base','small','medium','large-v3-turbo']);
 for(const settings of [defaults,...Object.values(gpuPresets).map(p=>({...defaults,...p}))]){
  const plan=missingModelDownloads(settings,{whisper:[],llm:[]});assert.equal(plan[0].id,'whisper-'+settings.asr);assert.equal(plan.length,settings.translator==='chrome'?1:2);
  for(const model of plan){const spec=[...catalog.whisperModels,...catalog.starterModels,...catalog.models].find(m=>m.id===model.id);assert.ok(spec);for(const f of spec.files){assert.match(f.sha256,/^[a-f0-9]{64}$/);assert.ok(f.url.includes('/resolve/'+spec.revision+'/'));}}
 }
 assert.equal(starterModels.length,2);assert.equal(validateSettings({autoDownloadModels:'false'}).autoDownloadModels,false);
});
test('existing complete and custom models skip download; missing custom folder is never guessed',async()=>{
 const settings={...defaults,localWhisperId:'custom-whisper',localLlmId:'custom-llm'};const models={whisper:[{id:'custom-whisper',ready:true}],llm:[{id:'custom-llm',ready:true}]};const calls=[];
 await ensureModelFiles(settings,{call:async op=>{calls.push(op);assert.equal(op,'hello');return {models};}});assert.deepEqual(calls,['hello']);assert.throws(()=>missingModelDownloads(settings,{whisper:[],llm:[]}),/自訂/);
});
test('fresh install downloads selected missing models serially then verifies readiness',async()=>{
 const models={whisper:[],llm:[]},starts=[];let state={state:'idle'};let polls=0;
 const call=async(op,data)=>{if(op==='hello')return {models,downloadCatalogVersion:2};if(op==='downloadStart'){starts.push(data.modelId);state={state:'downloading',modelId:data.modelId,bytes:1,total:2};polls=0;return state;}if(op==='downloadStatus'){if(state.state==='downloading'&&++polls>1){state={...state,state:'complete'};models[state.modelId.startsWith('whisper')?'whisper':'llm'].push({id:state.modelId,ready:true});}return state;}throw Error('Unexpected '+op);};
 await ensureModelFiles(defaults,{call,sleep:async()=>{}});assert.deepEqual(starts,['whisper-tiny','gemma-4-E2B']);
});
test('old host and another active download fail before starting; errors do not retry',async()=>{
 const models={whisper:[],llm:[]};let starts=0;
 await assert.rejects(ensureModelFiles(defaults,{call:async op=>({models,version:'0.4.2'})}),/Setup 升級/);
 await assert.rejects(ensureModelFiles(defaults,{call:async op=>op==='hello'?{models,downloadCatalogVersion:2}:{state:'downloading',modelId:'another'}}),/已有模型下載/);
 let state={state:'idle'};await assert.rejects(ensureModelFiles(defaults,{call:async(op,data)=>{if(op==='hello')return {models,downloadCatalogVersion:2};if(op==='downloadStart'){starts++;state={state:'error',modelId:data.modelId,error:'network unavailable'};}return state;},sleep:async()=>{}}),/network unavailable/);assert.equal(starts,1);
});
test('release cancels its own partial download and never starts the next model',async()=>{
 const controller=new AbortController(),models={whisper:[],llm:[]};let state={state:'idle'},starts=0,cancels=0;
 const call=async(op,data)=>{if(op==='hello')return {models,downloadCatalogVersion:2};if(op==='downloadStart'){starts++;state={state:'downloading',modelId:data.modelId};return state;}if(op==='downloadCancel'){cancels++;state={...state,state:'cancelled'};}return state;};
 await assert.rejects(ensureModelFiles(defaults,{call,signal:controller.signal,sleep:async()=>controller.abort()}),/取消/);assert.equal(starts,1);assert.equal(cancels,1);
});
