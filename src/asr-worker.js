import {AutoTokenizer,AutoProcessor,WhisperForConditionalGeneration,env} from '@huggingface/transformers';
import {SpeechFilter,audioEnergy} from './speech-filter.js';
import {isAutomaticLanguage,detectLanguage} from './language-detection.js';
env.allowLocalModels=false;env.useWasmCache=false;
env.backends.onnx.wasm.wasmPaths=new URL('./',self.location.href).href;
env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
let tokenizer,processor,model,speechFilter;
self.onmessage=async({data:m})=>{try{
  if(m.type==='load'){
    if(!navigator.gpu)throw Error('此 Chrome 沒有 WebGPU，請開啟硬體加速並檢查 chrome://gpu');
    env.allowLocalModels=false;env.allowRemoteModels=true;env.useBrowserCache=!m.localBase;
    if(m.localBase){
      // Transformers.js metadata probes use its HTTP transport even for a
      // loopback file bridge. Restrict that transport to this exact model root.
      const base=new URL(m.localBase);if(base.hostname!=='127.0.0.1'||base.protocol!=='http:')throw Error('Invalid local model bridge');
      env.remoteHost=base.href;env.remotePathTemplate='{model}/';
      env.fetch=(url,options)=>{if(!String(url).startsWith(base.href))throw Error('Installed mode blocks external model requests');return fetch(url,options);};
    }
    const id=m.localId||(m.size==='medium'?'onnx-community/whisper-medium-ONNX':`onnx-community/whisper-${m.size}`);
    const progress_callback=p=>{if(p.status==='progress')self.postMessage({progress:`Whisper ${p.file}: ${Math.round(p.progress||0)}%`});};
    [tokenizer,processor,model]=await Promise.all([AutoTokenizer.from_pretrained(id),AutoProcessor.from_pretrained(id),WhisperForConditionalGeneration.from_pretrained(id,{device:'webgpu',dtype:{encoder_model:m.encoderDtype||(['medium','large-v3-turbo'].includes(m.size)?'fp16':'fp32'),decoder_model_merged:'q4'},progress_callback})]);
    if(m.speechFilter!=='rms'){speechFilter=new SpeechFilter();await speechFilter.load(new URL('./vad/silero-v5.onnx',self.location.href).href);}
    const input=await processor(new Float32Array(16000));await model.generate({...input,language:isAutomaticLanguage(m.language)?'ja':m.language,task:'transcribe',max_new_tokens:1});
    self.postMessage({rpc:m.rpc,result:true});
  }else if(m.type==='recognize'){
    const start=performance.now();const energy=audioEnergy(m.audio);const vad=speechFilter?await speechFilter.evaluate(m.audio,m.vadThreshold??.5,m.minSpeechMs??160):{...energy,accepted:energy.peak>=1e-5,reason:energy.peak>=1e-5?null:'digital-silence'};
    if(!vad.accepted){self.postMessage({rpc:m.rpc,result:{text:'',skipped:true,skipReason:vad.reason,vad,inferenceMs:performance.now()-start}});return;}
    const input=await processor(m.audio);const langStart=performance.now();const detectedLanguage=isAutomaticLanguage(m.language)?await detectLanguage(model,input,m.language):m.language;const languageDetectionMs=performance.now()-langStart;
    const output=await model.generate({...input,language:detectedLanguage,task:'transcribe',max_new_tokens:96,num_beams:1,do_sample:false,no_repeat_ngram_size:6});
    const text=tokenizer.batch_decode(output,{skip_special_tokens:true})[0]?.trim()||'';
    self.postMessage({rpc:m.rpc,result:{text,detectedLanguage,languageDetectionMs,vad,inferenceMs:performance.now()-start}});
  }
}catch(e){self.postMessage({rpc:m.rpc,error:e.message||String(e)});}};
