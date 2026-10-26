// Audio clock counts samples, not arrival times; audio is always 16kHz mono.
export class Segmenter{
  constructor({sampleRate=16000,silenceMs=220,threshold=.012,maxMs=4000,maxSegmentMs,speechMode='fixed',partialMs=650}={}){Object.assign(this,{sampleRate,silenceMs,threshold,maxMs:maxSegmentMs??maxMs,speechMode,partialMs});this.clock=0;this.seq=0;this.reset();}
  reset(){this.frames=[];this.length=0;this.lastVoice=0;this.lastPartial=0;this.pre=[];this.preLength=0;this.textBoundary=null;}
  observeText(text,endSample,id){if(id===this.id&&/[。！？.!?][」』”'\s]*$/.test(text.trim()))this.textBoundary=endSample;}
  push(frame){
    this.clock+=frame.length;const events=[];
    const rms=Math.sqrt(frame.reduce((s,v)=>s+v*v,0)/frame.length);
    const voice=rms>=this.threshold*(this.speechMode==='adaptive'&&this.length?0.7:1);
    if(!this.length&&!voice){this.pre.push(frame);this.preLength+=frame.length;while(this.preLength>this.sampleRate*.12&&this.pre.length>1)this.preLength-=this.pre.shift().length;return events;}
    if(!this.length){this.id=++this.seq;this.start=this.clock-frame.length-this.preLength;this.frames=[...this.pre];this.length=this.preLength;this.pre=[];this.preLength=0;}
    this.frames.push(frame);this.length+=frame.length;if(voice)this.lastVoice=this.length;
    const quiet=(this.length-this.lastVoice)/this.sampleRate*1000;
    const duration=this.length/this.sampleRate*1000;
    const hinted=this.speechMode==='adaptive'&&this.textBoundary!==null&&Math.abs(this.start+this.lastVoice-this.textBoundary)<this.sampleRate*.12;
    const endpoint=hinted?Math.min(this.silenceMs,140):this.speechMode==='adaptive'&&duration>=4000?Math.min(this.silenceMs,160):this.silenceMs;
    const final=quiet>=endpoint||duration>=this.maxMs;
    // At 100ms silence, begin the same padded input that finalization will use.
    if(final||duration-this.lastPartial>=this.partialMs||(quiet>=100&&this.specVoice!==this.lastVoice)){
      const end=Math.min(this.length,this.lastVoice+Math.round(this.sampleRate*.08));
      if(this.lastVoice>=this.sampleRate*.18){
        const audio=new Float32Array(end);let pos=0;for(const f of this.frames){const n=Math.min(f.length,end-pos);if(n<=0)break;audio.set(f.subarray(0,n),pos);pos+=n;}
        events.push({id:this.id,key:`${this.id}:${end}`,audio,final,forced:duration>=this.maxMs,startSample:this.start,endSample:this.start+this.lastVoice,clock:this.clock});
      }
      this.lastPartial=duration;this.specVoice=this.lastVoice;
    }
    if(final){this.reset();this.specVoice=undefined;}return events;
  }
}
export class LatestQueue{
  constructor(limit=3){this.limit=limit;this.finals=[];this.partial=null;this.dropped=0;}
  put(job){if(job.final){this.partial=null;const old=this.finals.findIndex(j=>j.id===job.id);if(old>=0)this.finals[old]=job;else this.finals.push(job);if(this.finals.length>this.limit){this.finals.shift();this.dropped++;}}else if(!this.finals.length)this.partial=job;}
  next(){return this.finals.shift()||(()=>{const p=this.partial;this.partial=null;return p;})();}
}
