import {CaptionDisplay,captionText} from './caption-display.js';
if(!globalThis.__localLiveOverlay){globalThis.__localLiveOverlay=true;
 const display=new CaptionDisplay(),host=document.createElement('div');host.id='local-live-subtitle';host.style.cssText='position:fixed;bottom:8%;left:5%;width:90%;z-index:2147483647;pointer-events:none;text-align:center;';
 const root=host.attachShadow({mode:'open'}),box=document.createElement('div');box.style.cssText='display:inline-block;max-width:95%;background:rgba(8,15,22,.85);color:white;border-radius:9px;padding:10px 18px;font:600 clamp(18px,2.2vw,30px)/1.5 system-ui;white-space:pre-wrap;text-shadow:0 1px 3px black;';root.append(box);host.hidden=true;document.documentElement.append(host);
 let timer;
 function paint(){if(document.hidden)return;const rows=display.rows(performance.now());box.textContent=rows.map(captionText).join('\n\n');host.hidden=!rows.length;if(!rows.length){clearInterval(timer);timer=null;}}
 document.addEventListener('fullscreenchange',()=>{(document.fullscreenElement||document.documentElement).append(host);});
 chrome.runtime.onMessage.addListener(m=>{if(m.type!=='local-subtitle')return;if(m.clear){display.clear();host.hidden=true;clearInterval(timer);timer=null;return;}display.offer(m,performance.now()+10000);paint();if(!timer)timer=setInterval(paint,50);});
}
