import * as ort from 'onnxruntime-web/wasm';
export function audioEnergy(audio){let sum=0,peak=0;for(const v of audio){sum+=v*v;peak=Math.max(peak,Math.abs(v));}return {rms:Math.sqrt(sum/Math.max(1,audio.length)),peak,durationMs:audio.length/16};}
export class SpeechFilter{
  async load(url){ort.env.wasm.wasmPaths=new URL('./',self.location.href).href;ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;this.session=await ort.InferenceSession.create(url,{executionProviders:['wasm']});}
  async evaluate(audio,threshold=.5,minSpeechMs=160){
    const start=performance.now();const energy=audioEnergy(audio);
    if(energy.peak<1e-5)return {...energy,speechMs:0,maxProbability:0,accepted:false,reason:'digital-silence',vadMs:performance.now()-start};
    let state=new ort.Tensor('float32',new Float32Array(256),[2,1,128]);const sr=new ort.Tensor('int64',BigInt64Array.from([16000n]),[]);let context=new Float32Array(64),speechSamples=0,maxProbability=0;
    try{for(let at=0;at<audio.length;at+=512){const count=Math.min(512,audio.length-at);const frame=new Float32Array(576);frame.set(context);frame.set(audio.subarray(at,at+count),64);context=frame.slice(-64);const input=new ort.Tensor('float32',frame,[1,576]);let out;try{out=await this.session.run({input,state,sr});}finally{input.dispose();}state.dispose();state=out.stateN;const probability=Number(out.output.data[0]);out.output.dispose();maxProbability=Math.max(maxProbability,probability);if(probability>=threshold)speechSamples+=count;}
      const speechMs=speechSamples/16;return {...energy,speechMs,maxProbability,threshold,minSpeechMs,accepted:speechMs>=minSpeechMs,reason:speechMs>=minSpeechMs?null:'vad-no-speech',vadMs:performance.now()-start};
    }finally{state.dispose();sr.dispose();}
  }
}
