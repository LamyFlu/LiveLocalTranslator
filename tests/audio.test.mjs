import test from 'node:test';
import assert from 'node:assert/strict';
import {PCMResampler} from '../src/pcm-resampler.js';
function convert(rate,hz,chunk=128){const samples=Float32Array.from({length:rate},(_,i)=>Math.sin(2*Math.PI*hz*i/rate));const result=[];const r=new PCMResampler(rate);for(let i=0;i<samples.length;i+=chunk)r.push([samples.subarray(i,i+chunk)],v=>result.push(v));return result;}
const rms=a=>Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length);
for(const rate of [44100,48000,96000])test(`${rate}Hz to 16kHz keeps the sample clock and voice band`,()=>{const result=convert(rate,1000);assert.equal(result.length,16000);assert.ok(Math.abs(rms(result.slice(200))-Math.SQRT1_2)<.02);});
test('resampling preserves phase across arbitrary worklet chunk boundaries',()=>{const a=convert(44100,2000,128),b=convert(44100,2000,317);assert.deepEqual(a,b);});
test('ASR downsampling suppresses 12kHz before decimation',()=>{const low=rms(convert(48000,1000).slice(200));const high=rms(convert(48000,12000).slice(200));assert.ok(high/low<.01,`alias ratio ${high/low}`);});
test('16kHz input is unchanged; stereo downmix does not mutate original playback samples',()=>{const left=new Float32Array([.2,.4,-.4,.8]),right=new Float32Array([.4,.2,.4,-.8]);const original=left.slice();const result=[];new PCMResampler(16000).push([left,right],v=>result.push(v));assert.deepEqual(left,original);assert.deepEqual(result,[...left].map((v,i)=>(v+right[i])/2));});
