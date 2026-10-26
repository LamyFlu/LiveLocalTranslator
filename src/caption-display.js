// Screen-clock dwell starts when a translated row is actually rendered, not at
// speech end or ASR arrival. New rows stack below protected rows.
export class CaptionDisplay{
 constructor({minMs=1500,maxRows=3,limit=80}={}){this.minMs=minMs;this.maxRows=maxRows;this.limit=limit;this.clear();}
 clear(){this.visible=[];this.pending=[];this.seen=new Map();}
 offer(caption,expiresAt=Infinity){
  const version=caption.translation||'',key=caption.id;if(this.seen.get(key)&&!version)return;
  let row=[...this.visible,...this.pending].find(r=>r.caption.id===key);
  if(row){if(row.caption.translation&&!version)return;if(row.caption.translation!==caption.translation&&version)row.fresh=true;row.caption=caption;row.expiresAt=expiresAt;return;}
  if(this.seen.has(key)&&this.seen.get(key)===version)return;
  row={caption,expiresAt,until:0,fresh:true};this.pending.push(row);
  if(this.pending.length>this.limit)this.pending.shift();
 }
 rows(now){
  for(const r of this.visible)if(r.fresh){if(r.caption.translation)r.until=now+this.minMs;r.fresh=false;this.seen.set(r.caption.id,r.caption.translation||'');}
  this.visible=this.visible.filter(r=>now<Math.max(r.until,r.expiresAt));
  const newest=this.visible.at(-1);this.visible=this.visible.filter(r=>r===newest||now<r.until);
  if(this.pending.length)this.visible=this.visible.filter(r=>r.caption.translation&&now<r.until);
  while(this.pending.length&&this.visible.length<this.maxRows){
   const row=this.pending.shift();row.until=row.caption.translation?now+this.minMs:0;row.fresh=false;
   this.visible.push(row);this.seen.set(row.caption.id,row.caption.translation||'');
  }
  while(this.seen.size>200)this.seen.delete(this.seen.keys().next().value);
  return this.visible.map(r=>r.caption);
 }
}
export function captionText(c){return [(c.translation||''),(c.source||'')].filter(Boolean).join('\n');}
