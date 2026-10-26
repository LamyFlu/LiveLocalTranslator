// Bootstrap the pinned 12B file; subsequent user downloads use the native host.
import {readFile,mkdir,stat,rename,writeFile} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';import {Transform} from 'node:stream';import {createHash} from 'node:crypto';import os from 'node:os';import path from 'node:path';
const model=JSON.parse(await readFile('public/model-catalog.json','utf8')).models.find(m=>m.engine==='gemma12');
const dir=path.join(os.homedir(),'LiveLocalTranslator/models/llm',model.id);await mkdir(dir,{recursive:true});
for(const f of model.files){const target=path.join(dir,f.path),part=target+'.download';let exists=await stat(target).catch(()=>null);
 if(!exists){let offset=(await stat(part).catch(()=>null))?.size||0;if(offset>f.bytes)throw Error('Invalid partial size');
  if(offset<f.bytes){const r=await fetch(f.url,{headers:offset?{Range:`bytes=${offset}-`}:{}});if(!r.ok)throw Error('HTTP '+r.status);if(offset&&r.status!==206)offset=0;let done=offset,last=0;await pipeline(r.body,new Transform({transform(b,enc,cb){done+=b.length;if(Date.now()-last>10000){console.log(Math.round(done/1e6)+' / '+Math.round(f.bytes/1e6)+' MB');last=Date.now();}cb(null,b);}}),createWriteStream(part,{flags:offset?'a':'w'}));}
 }
 const source=exists?target:part;if((await stat(source)).size!==f.bytes)throw Error('Wrong size');const h=createHash('sha256');for await(const b of createReadStream(source))h.update(b);if(h.digest('hex')!==f.sha256)throw Error('SHA mismatch');if(!exists)await rename(part,target);
}
await writeFile(path.join(dir,'.model-ready.json'),JSON.stringify({id:model.id,revision:model.revision,at:new Date().toISOString(),files:model.files.map(f=>({file:f.path,bytes:f.bytes,sha256:f.sha256}))},null,2));console.log('12B SHA256 verified');
