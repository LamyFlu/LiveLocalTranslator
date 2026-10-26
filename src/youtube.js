import {CaptionDisplay,captionText} from './caption-display.js';
import {CHAT_BATCH_SIZE,CHAT_QUEUE_LIMIT} from './chat-policy.js';
import {CaptionTimeline,framePlan,youtubeChatPage,chatEmojiText} from './youtube-utils.js';
// Isolated-world content script: reads video/chat DOM; never submits messages.
if(!globalThis.__liveLocalYouTube){globalThis.__liveLocalYouTube=true;
const chatFrame=youtubeChatPage(location.href),topFrame=window===window.top;
let shownCaption=null;let subscribeId=0;let active=false,settings={},video,host,canvas,box,badge,frameCallback,timer,abort,observer,sequence=0,lastHref=location.href,lastFrame=-Infinity,frames=[],pool=[],frameIndex=0,plan,paused=false,displayEpoch=0;
const chatPrefix=crypto.randomUUID().slice(0,8);const display=new CaptionDisplay(),timeline=new CaptionTimeline(),chatNodes=new Map();let seen=new WeakMap();let chatObserver,chatTimer,chatPending=[],chatCounter=0;
const epoch=()=>performance.timeOrigin+performance.now();
const call=(type,data={})=>chrome.runtime.sendMessage({to:'background',type,...data}).catch(()=>null);
function clearFrames(){frames=[];for(const c of pool){c.width=0;c.height=0;}pool=[];frameIndex=0;lastFrame=-Infinity;displayEpoch=0;shownCaption=null;if(host){delete host.dataset.displayEpoch;delete host.dataset.subtitleOnsetErrorMs;}}
function mediaState(reset=false){if(!video)return;call(reset?'youtubeReset':'youtubeMedia',{sequence,mediaTime:video.currentTime,epoch:epoch(),rate:video.playbackRate,paused:video.paused});}
function reset(){sequence++;timeline.clear();display.clear();clearFrames();if(box)box.textContent='';mediaState(true);}
function stop(){active=false;abort?.abort();if(video&&frameCallback)video.cancelVideoFrameCallback?.(frameCallback);clearInterval(timer);timer=null;clearFrames();host?.remove();host=canvas=box=badge=null;video=null;timeline.clear();display.clear();stopChat();}
function overlay(v){const target=document.querySelector('#movie_player')||v.parentElement;if(!target)return;host=document.createElement('div');host.dataset.liveLocal='youtube';host.style.cssText='position:absolute;inset:0;z-index:30;pointer-events:none;';const root=host.attachShadow({mode:'open'});canvas=document.createElement('canvas');canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';box=document.createElement('div');box.style.cssText='position:absolute;bottom:12%;left:5%;width:90%;box-sizing:border-box;text-align:center;white-space:pre-wrap;color:#fff;text-shadow:0 1px 4px #000;font:600 clamp(18px,2.4vw,32px)/1.5 system-ui;';badge=document.createElement('div');badge.style.cssText='position:absolute;left:12px;top:12px;color:#fff;background:#13202cdd;padding:5px 8px;border-radius:5px;font:13px system-ui;';root.append(canvas,box,badge);target.append(host);}
function cueText(c){return c?[(c.translation||''),(c.source||'')].filter(Boolean).join('\n'):'';}
function paint(){if(document.hidden||!active||!video||!host)return;const now=epoch();
 if(settings.youtubeMode==='delayed'){
  const target=now-settings.youtubeDelayMs;let selected=null;for(const f of frames)if(f.epoch<=target&&(!selected||f.epoch>selected.epoch))selected=f;
  if(selected&&!paused){try{if(canvas.width!==plan.width||canvas.height!==plan.height){canvas.width=plan.width;canvas.height=plan.height;}canvas.getContext('2d',{alpha:false}).drawImage(selected.canvas,0,0);displayEpoch=selected.epoch;badge.textContent=`同步延後 ${(settings.youtubeDelayMs/1000).toFixed(1)} 秒 · ${plan.width}×${plan.height}／${plan.fps}fps`;host.dataset.displayEpoch=String(displayEpoch);}catch(e){delayFailed(e);return;}}
  else badge.textContent=paused?'已暫停 · 同步緩衝將重建':`同步緩衝中 · ${settings.youtubeDelayMs/1000} 秒`;
  for(const cue of timeline.due(displayEpoch||target))display.offer(cue,now+cue.speechEndEpoch+1800-(displayEpoch||target));const rows=display.rows(now);box.textContent=rows.map(captionText).join('\n\n');const cue=rows.filter(c=>c.translation).at(-1);if(cue?.translation&&shownCaption!==cue.id){shownCaption=cue.id;host.dataset.subtitleOnsetErrorMs=String(displayEpoch-cue.speechStartEpoch);}if(Number(host.dataset.subtitleOnsetErrorMs)>500)badge.textContent+=' · 譯文晚到 '+(Number(host.dataset.subtitleOnsetErrorMs)/1000).toFixed(1)+' 秒';
 }else{badge.textContent='本機字幕 · 即時播放（譯文可能稍晚）';box.textContent=display.rows(now).map(captionText).join('\n\n');}
}
function delayFailed(e){clearFrames();canvas.hidden=true;settings={...settings,youtubeMode:'live'};badge.textContent='畫面緩衝不可用，已恢復即時播放';call('youtubeDelayError',{error:String(e.message||e)});}
function frame(now,metadata){if(!active||!video)return;
 if(settings.youtubeMode==='delayed'&&!document.hidden&&!video.paused&&video.videoWidth&&now-lastFrame>=1000/(plan?.fps||15)){
  try{const next=framePlan(video.videoWidth,video.videoHeight,settings.youtubeDelayMs);if(!plan||next.width!==plan.width||next.height!==plan.height){clearFrames();plan=next;}const slot=frameIndex++%plan.count;let c=pool[slot];if(!c){c=document.createElement('canvas');c.width=plan.width;c.height=plan.height;pool[slot]=c;}frames=frames.filter(f=>f.canvas!==c);c.getContext('2d',{alpha:false}).drawImage(video,0,0,plan.width,plan.height);frames.push({canvas:c,epoch:performance.timeOrigin+(metadata.expectedDisplayTime||now),mediaTime:metadata.mediaTime});lastFrame=now;}catch(e){delayFailed(e);}
 }
 paint();frameCallback=video.requestVideoFrameCallback(frame);
}
function attach(){if(!active||!topFrame)return;const v=document.querySelector('video.html5-main-video')||document.querySelector('video');if(!v||v===video)return;
 abort?.abort();if(video&&frameCallback)video.cancelVideoFrameCallback?.(frameCallback);host?.remove();video=v;abort=new AbortController();overlay(v);paused=v.paused;plan=null;reset();canvas.hidden=settings.youtubeMode!=='delayed';
 for(const type of ['seeking','emptied','ratechange','waiting'])v.addEventListener(type,()=>reset(),{signal:abort.signal});
 v.addEventListener('pause',()=>{paused=true;reset();},{signal:abort.signal});v.addEventListener('play',()=>{paused=false;reset();},{signal:abort.signal});v.addEventListener('playing',()=>{paused=false;mediaState();},{signal:abort.signal});
 if(v.requestVideoFrameCallback)frameCallback=v.requestVideoFrameCallback(frame);else if(settings.youtubeMode==='delayed')delayFailed(Error('瀏覽器缺少畫面回呼'));
}
function chatText(node){const message=node.querySelector('#message');if(!message)return '';let s='';const walk=n=>{if(n.nodeType===Node.TEXT_NODE)s+=n.textContent;else if(n.nodeType===Node.ELEMENT_NODE){if(n.tagName==='IMG')s+=chatEmojiText(n.getAttribute('alt')||'',n.getAttribute('src')||'');else for(const child of n.childNodes)walk(child);}};walk(message);return s.replace(/[\u200b-\u200f]/g,'').trim().slice(0,180);}
const chatSelector='yt-live-chat-text-message-renderer,yt-live-chat-paid-message-renderer';
function collect(node){if(!active||!settings.chatTranslation||!(node instanceof Element))return;const candidates=[...(node.matches(chatSelector)?[node]:[]),...node.querySelectorAll(chatSelector)].slice(-100);for(const item of candidates){const text=chatText(item);if(!text||seen.get(item)===text)continue;seen.set(item,text);item.querySelector('.live-local-chat-translation')?.remove();const id=chatPrefix+':'+String(++chatCounter);chatNodes.set(id,{node:item,text});chatPending.push({id,text});while(chatPending.length>CHAT_QUEUE_LIMIT){const old=chatPending.shift();chatNodes.delete(old.id);}while(chatNodes.size>500)chatNodes.delete(chatNodes.keys().next().value);}}
function stopChat(){chatObserver?.disconnect();clearInterval(chatTimer);chatObserver=null;seen=new WeakMap();chatPending=[];chatNodes.clear();document.querySelectorAll('.live-local-chat-translation').forEach(n=>n.remove());}
function startChat(){if(chatObserver||!document.body)return;chatObserver=new MutationObserver(changes=>{for(const change of changes){const parent=change.target instanceof Element?change.target:change.target.parentElement;const item=parent?.closest(chatSelector);if(item)collect(item);for(const n of change.addedNodes)if(n instanceof Element)collect(n);}});chatObserver.observe(document.body,{childList:true,subtree:true,characterData:true});collect(document.body);chatTimer=setInterval(()=>{for(const [id,entry]of chatNodes)if(!entry.node.isConnected)chatNodes.delete(id);if(!chatPending.length)return;const items=chatPending.splice(0,CHAT_BATCH_SIZE);call('youtubeChat',{items}).then(r=>{if(r?.error)for(const i of items)showChat({id:i.id,error:r.error});});},1000);}
function showChat(m){const entry=chatNodes.get(String(m.id));if(!entry||!entry.node.isConnected||chatText(entry.node)!==entry.text)return;let text=entry.node.querySelector('.live-local-chat-translation');if(!text){text=document.createElement('div');text.className='live-local-chat-translation';text.style.cssText='display:block;color:#9ed9ff;font-size:12px;line-height:1.5;padding:2px 0 3px;white-space:pre-wrap;';entry.node.append(text);}text.textContent=m.error?`〔本機翻譯略過：${m.error}〕`:m.translation;}
function apply(config){if(!config?.enabled){stop();return;}const changed=!active||settings.youtubeMode!==config.settings.youtubeMode||settings.youtubeDelayMs!==config.settings.youtubeDelayMs;active=true;settings=config.settings;
 if(chatFrame){if(settings.chatTranslation)startChat();else stopChat();return;}if(!topFrame)return;attach();if(changed&&video){reset();canvas.hidden=settings.youtubeMode!=='delayed';}
 if(!timer)timer=setInterval(()=>{if(location.href!==lastHref){lastHref=location.href;reset();}attach();mediaState();paint();},500);
}
chrome.runtime.onMessage.addListener(m=>{if(m.type==='youtubeConfigure'){subscribeId++;apply(m);}else if(m.type==='youtubeCaption'&&topFrame&&active){if(m.caption.videoSequence!==sequence)return;if(settings.youtubeMode==='delayed')timeline.put(m.caption);else if(box){display.offer(m.caption,epoch()+10000);paint();}}else if(m.type==='youtubeChatResult'&&chatFrame&&active)showChat(m);else if(m.type==='youtubeClear'){timeline.clear();display.clear();if(box)box.textContent='';}});
async function subscribe(){const id=++subscribeId;const r=await call('youtubeConfig');if(id===subscribeId)apply(r);}
document.addEventListener('visibilitychange',()=>{if(active&&topFrame){if(document.hidden)clearFrames();else reset();}});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes.state||area==='local'&&changes.settings)subscribe();});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',subscribe,{once:true});else subscribe();
}
