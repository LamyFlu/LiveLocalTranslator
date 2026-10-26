// Translation reuse is bounded RAM only: no write per spoken sentence.
export class MemoryCache {
 constructor(limit=1000,maxBytes=8*1024*1024){this.limit=limit;this.maxBytes=maxBytes;this.bytes=0;this.entries=new Map();}
 get(key){const entry=this.entries.get(key);if(!entry)return null;this.entries.delete(key);this.entries.set(key,entry);return entry.value;}
 put(key,value){const old=this.entries.get(key);if(old){this.bytes-=old.bytes;this.entries.delete(key);}const bytes=(key.length+value.length)*2;if(bytes>this.maxBytes)return;this.entries.set(key,{value,bytes});this.bytes+=bytes;while(this.entries.size>this.limit||this.bytes>this.maxBytes){const k=this.entries.keys().next().value;this.bytes-=this.entries.get(k).bytes;this.entries.delete(k);}}
}
