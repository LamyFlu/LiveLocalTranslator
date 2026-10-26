import {LogitsProcessor,LogitsProcessorList} from '@huggingface/transformers';
export function isAutomaticLanguage(language){return language==='auto'||language==='auto-en-ja';}
export function languageCandidates(mapping,mode){const entries=Object.entries(mapping||{}).map(([token,id])=>({code:token.replace(/^<\||\|>$/g,''),id}));return mode==='auto-en-ja'?entries.filter(e=>e.code==='en'||e.code==='ja'):entries;}
class LanguageOnly extends LogitsProcessor{
  constructor(ids){super();this.ids=new Set(ids);}
  _call(_tokens,scores){const width=scores.dims.at(-1);for(let i=0;i<scores.data.length;i++)if(!this.ids.has(i%width))scores.data[i]=-Infinity;return scores;}
}
export async function detectLanguage(model,input,mode){
  const candidates=languageCandidates(model.generation_config.lang_to_id,mode);if(!candidates.length)throw Error('此模型未提供多語言 token，無法自動偵測');
  const processors=new LogitsProcessorList();processors.push(new LanguageOnly(candidates.map(e=>e.id)));
  const tokens=await model.generate({...input,decoder_input_ids:[[model.generation_config.decoder_start_token_id]],max_new_tokens:1,do_sample:false,num_beams:1,suppress_tokens:[],begin_suppress_tokens:[],logits_processor:processors});
  const id=Number(tokens.data.at(-1));const found=candidates.find(c=>c.id===id);if(!found)throw Error('Whisper 語言偵測沒有回傳有效語言');return found.code;
}
