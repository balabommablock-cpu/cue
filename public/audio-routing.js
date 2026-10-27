import {sameUtterance,spokenTokens} from './reading.js';
export function probableMicrophoneEcho(left,right,{strictLength=false}={}){
 const a=spokenTokens(left),b=spokenTokens(right);if(Math.min(a.length,b.length)<6||strictLength&&Math.max(a.length,b.length)/Math.min(a.length,b.length)>1.1)return false;
 if(/^(?:I(?:['’]d| would| think| chose)|we would|my (?:answer|choice)|what I did)\b/i.test(left.trim()))return false;
 const protectedWords=t=>t.filter(w=>/^\d+$/.test(w)||['no','not','never','without','cant','dont','before','after','increase','decrease'].includes(w)).sort().join(' ');
 if(protectedWords(a)!==protectedWords(b))return false;
 const dp=Array(b.length+1).fill(0);
 for(const x of a){let diagonal=0;for(let j=1;j<=b.length;j++){const old=dp[j];dp[j]=x===b[j-1]?diagonal+1:Math.max(dp[j],dp[j-1]);diagonal=old;}}
 return dp[b.length]/Math.min(a.length,b.length)>=.9;
}

export const dualAudio=mode=>mode==='both'||mode==='hybrid';
export const sharedMicrophone=mode=>mode==='mic'||mode==='hybrid';
export const speechSourceFor=(mode,kind)=>kind==='mic'&&sharedMicrophone(mode)?'shared':kind;
export const transcriptionLane=(mode,source)=>dualAudio(mode)&&source!=='system'?'readback':'question';

// The same Mac voice can arrive through loopback and the room microphone.
// Discard matching cross-input transcripts close in capture time. Approximate
// matches also require physical overlap and almost identical wording/length;
// timing alone must never discard an independent phone question.
export class CrossSourceEcho {
  constructor(){this.clear();}
  clear(){this.recent=[];}
  accept(text,source,at=performance.now(),{overlappedSystem=false}={}){
    const duplicate=source!=='system'&&this.recent.some(item=>item.source==='system'&&Math.abs(at-item.at)<8000&&(sameUtterance(item.text,text)||overlappedSystem&&probableMicrophoneEcho(text,item.text,{strictLength:source==='shared'})));
    this.recent.push({text,source,at});this.recent=this.recent.slice(-12);
    return !duplicate;
  }
}
