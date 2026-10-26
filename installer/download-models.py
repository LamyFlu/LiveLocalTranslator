"""Download only browser-compatible model assets; verify HF LFS SHA256."""
import hashlib,json,os,pathlib,time,urllib.request
root=pathlib.Path.home()/'LiveLocalTranslator'/'models'
root.mkdir(parents=True,exist_ok=True)
root=root.resolve()
specs=[('onnx-community/whisper-large-v3-turbo','whisper/whisper-large-v3-turbo',lambda n: n.endswith(('.json','.txt','.model')) or n in ['onnx/encoder_model_fp16.onnx','onnx/decoder_model_merged_q4.onnx']),('litert-community/gemma-4-E4B-it-litert-lm','llm/gemma-4-E4B',lambda n:n=='gemma-4-E4B-it-web.litertlm')]
receipts=[]
for repo,folder,wanted in specs:
    data=json.load(urllib.request.urlopen('https://huggingface.co/api/models/'+repo+'?blobs=true',timeout=30));revision=data['sha']
    for entry in filter(lambda s:wanted(s['rfilename']),data['siblings']):
        name=entry['rfilename'];target=(root/folder/name).resolve()
        if not target.is_relative_to(root):raise RuntimeError('Unsafe model path')
        target.parent.mkdir(parents=True,exist_ok=True)
        expected=entry.get('lfs',{}).get('sha256');size=entry.get('size');url='https://huggingface.co/'+repo+'/resolve/'+revision+'/'+name
        def digest(file):
            h=hashlib.sha256()
            with file.open('rb') as f:
                for chunk in iter(lambda:f.read(4*1024*1024),b''):h.update(chunk)
            return h.hexdigest()
        if target.exists() and target.stat().st_size==size and (not expected or digest(target)==expected):print('Existing verified:',folder+'/'+name,flush=True)
        else:
            part=target.with_name(target.name+'.download')
            for attempt in range(5):
                try:
                    offset=part.stat().st_size if part.exists() else 0
                    request=urllib.request.Request(url,headers={'Range':'bytes='+str(offset)+'-'} if offset else {})
                    with urllib.request.urlopen(request,timeout=60) as response:
                        append=offset>0 and response.status==206
                        if not append:offset=0
                        stamp=time.monotonic()
                        with part.open('ab' if append else 'wb') as f:
                            for chunk in iter(lambda:response.read(1024*1024),b''):
                                f.write(chunk);offset+=len(chunk)
                                if time.monotonic()-stamp>8:print(f'{folder}/{name}: {offset/1e6:.0f}/{size/1e6:.0f} MB',flush=True);stamp=time.monotonic()
                    if part.stat().st_size!=size:raise RuntimeError('Incomplete download')
                    actual=digest(part)
                    if expected and actual!=expected:raise RuntimeError('SHA256 mismatch')
                    os.replace(part,target);print('Downloaded verified:',folder+'/'+name,flush=True);break
                except Exception as e:
                    if attempt==4:raise
                    print('Retry:',str(e),flush=True);time.sleep(2)
        receipts.append({'repository':repo,'revision':revision,'file':str(target.relative_to(root)),'bytes':target.stat().st_size,'sha256':digest(target)})
(root/'download-receipts.json').write_text(json.dumps(receipts,ensure_ascii=False,indent=2),encoding='utf8')
print('LARGE MODEL DOWNLOADS COMPLETE',flush=True)
