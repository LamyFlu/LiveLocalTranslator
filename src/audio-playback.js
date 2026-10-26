// The playback branch keeps the original channel data and never encodes audio.
export function connectPlayback(source,context,delayMs=0,paused=false){
 if(!Number.isFinite(delayMs)||delayMs<0||delayMs>10000)throw Error('Invalid playback delay');
 const gainNode=context.createGain();gainNode.gain.setValueAtTime(paused?0:1,context.currentTime);let delayNode=null;
 if(delayMs){delayNode=context.createDelay(12);delayNode.channelCountMode='explicit';delayNode.channelCount=source.channelCount;delayNode.delayTime.setValueAtTime(delayMs/1000,context.currentTime);source.connect(delayNode).connect(gainNode).connect(context.destination);}else source.connect(gainNode).connect(context.destination);
 return {delayNode,gainNode,disconnect(){try{source.disconnect(delayNode||gainNode);}catch{}delayNode?.disconnect();gainNode.disconnect();}};
}
