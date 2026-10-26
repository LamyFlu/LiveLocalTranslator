export function youtubePage(url){try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='www.youtube.com';}catch{return false;}}
export function youtubeChatPage(url){if(!youtubePage(url))return false;return /^\/live_chat(?:_replay)?$/.test(new URL(url).pathname);}
// YouTube custom emoji are images with named alt text (often :channel_emote:).
// Only plain Unicode emoji alt text is included; labels never become dialogue.
export function chatEmojiText(alt='',src=''){
 if(/^https:\/\/yt3\.(ggpht\.com|googleusercontent\.com)\//i.test(src))return '';
 const text=String(alt).trim();
 return text&&!/[\p{L}\p{N}:_]/u.test(text)&&/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text)?text:'';
}
export class CaptionTimeline{
 constructor(limit=80){this.limit=limit;this.items=new Map();}
 put(item){if(!Number.isFinite(item.speechStartEpoch)||!Number.isFinite(item.speechEndEpoch))return;this.items.set(item.id,item);while(this.items.size>this.limit)this.items.delete(this.items.keys().next().value);}
 at(epoch){let best=null;for(const [id,c]of this.items){if(c.speechEndEpoch+1800<epoch){this.items.delete(id);continue;}if(c.speechStartEpoch<=epoch&&(!best||c.speechStartEpoch>=best.speechStartEpoch))best=c;}return best;}
 due(epoch){const result=[];for(const [id,c]of this.items)if(c.speechStartEpoch<=epoch){result.push(c);if(c.speechEndEpoch+1800<epoch)this.items.delete(id);}return result.sort((a,b)=>a.speechStartEpoch-b.speechStartEpoch);}
 clear(){this.items.clear();}
}
export function framePlan(width,height,delayMs,maxBytes=192*1024*1024){const scale=Math.min(1,960/width,540/height),w=Math.max(2,Math.round(width*scale)),h=Math.max(2,Math.round(height*scale));let fps=Math.max(1,Math.min(15,Math.floor(maxBytes/(w*h*4*((delayMs+300)/1000)))));let count=Math.ceil((delayMs+300)/1000*fps)+2;while(count*w*h*4>maxBytes&&fps>1){fps--;count=Math.ceil((delayMs+300)/1000*fps)+2;}return {width:w,height:h,fps,count,bytes:count*w*h*4};}
export class RateWindow{
 constructor(){this.times=[];}
 allow(limit,now=Date.now()){this.times=this.times.filter(t=>now-t<60000);if(this.times.length>=limit)return false;this.times.push(now);return true;}
}
