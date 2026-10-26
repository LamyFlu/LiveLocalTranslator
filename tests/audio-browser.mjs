import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
const worklet=await readFile('dist/audio-worklet.js');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/audio-worklet.js'?'text/javascript':'text/html');res.end(req.url==='/audio-worklet.js'?worklet:'<!doctype html><title>Audio fidelity regression</title>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const result=await page.evaluate(async()=>{
  const results=[];
  for(const rate of [44100,48000,96000]){
   const ctx=new OfflineAudioContext(2,rate,rate);await ctx.audioWorklet.addModule('/audio-worklet.js');
   const buffer=ctx.createBuffer(2,rate,rate);
   // High-frequency stereo material must survive playback; only ASR is reduced.
   for(let i=0;i<rate;i++){
    buffer.getChannelData(0)[i]=.2*Math.sin(2*Math.PI*1000*i/rate)+.2*Math.sin(2*Math.PI*12000*i/rate);
    buffer.getChannelData(1)[i]=.2*Math.sin(2*Math.PI*2000*i/rate)+.2*Math.sin(2*Math.PI*10000*i/rate);
   }
   const source=ctx.createBufferSource();source.buffer=buffer;source.connect(ctx.destination);
   const node=new AudioWorkletNode(ctx,'mono-capture');const mute=ctx.createGain();mute.gain.value=0;source.connect(node);node.connect(mute).connect(ctx.destination);
   let count=0,valid=true;node.port.onmessage=({data})=>{count+=data.length;valid&&=data.length===320&&data.every(Number.isFinite);};
   source.start();const rendered=await ctx.startRendering();await new Promise(r=>setTimeout(r,50));
   let maxDelta=0;for(let ch=0;ch<2;ch++)for(let i=0;i<rate;i++)maxDelta=Math.max(maxDelta,Math.abs(rendered.getChannelData(ch)[i]-buffer.getChannelData(ch)[i]));
   results.push({playbackRate:rate,channels:rendered.numberOfChannels,playbackMaxSampleDelta:maxDelta,asrSamplesPerSecond:count,asrPacketsValid:valid});
  }return results;
 });
 console.log(JSON.stringify(result));await writeFile('verification/audio-fidelity.json',JSON.stringify({date:new Date().toISOString(),browser:await browser.version(),result,scope:'Chrome OfflineAudioContext, production packaged AudioWorklet and split graph; not hardware bit-perfect output'},null,2));
 if(result.some(r=>r.playbackMaxSampleDelta>1e-6||r.channels!==2||r.asrSamplesPerSecond!==16000||!r.asrPacketsValid))throw Error('Audio fidelity regression');
}finally{await browser.close();server.close();}
