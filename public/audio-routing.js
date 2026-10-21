import {sameUtterance} from './reading.js';

export const dualAudio=mode=>mode==='both'||mode==='hybrid';
export const sharedMicrophone=mode=>mode==='mic'||mode==='hybrid';
export const speechSourceFor=(mode,kind)=>kind==='mic'&&sharedMicrophone(mode)?'shared':kind;
export const transcriptionLane=(mode,source)=>dualAudio(mode)&&source!=='system'?'readback':'question';

// The same Mac voice can arrive through loopback and the room microphone.
// Only discard identical cross-input transcripts close in capture time. Timing
// alone must never discard an independent phone question during Mac speech.
export class CrossSourceEcho {
  constructor(){this.clear();}
  clear(){this.recent=[];}
  accept(text,source,at=performance.now()){
    const duplicate=this.recent.some(item=>item.source!==source&&Math.abs(at-item.at)<8000&&sameUtterance(item.text,text));
    this.recent.push({text,source,at});this.recent=this.recent.slice(-12);
    return !duplicate;
  }
}
