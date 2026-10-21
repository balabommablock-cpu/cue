export class QuestionSegmenter {
  constructor(onQuestion,onSpeech=()=>{},{silenceMs=1200,onPartial=null,partialMs=3000,onEnd=()=>{},onQuiet=null,quietMs=250,voiceThreshold=.012,now=()=>performance.now()}={}){this.silenceSamples=Math.round(silenceMs*16);this.partialSamples=Math.round(partialMs*16);this.voiceThreshold=voiceThreshold;this.now=now;this.onQuiet=onQuiet;this.quietSamples=Math.round(quietMs*16);this.utterance=0;this.revision=0;this.onPartial=onPartial;this.onQuestion=onQuestion;this.onSpeech=onSpeech;this.onEnd=onEnd;this.reset();}
  reset(){this.parts=[];this.pre=[];this.preLength=0;this.active=false;this.silence=0;this.voice=0;this.length=0;this.lastPartial=0;this.quietSent=false;}
  push(samples){
    if(!samples?.length)return;
    if(samples.some(x=>!Number.isFinite(x))){this.reset();this.onEnd();return;}
    let energy=0;for(const x of samples)energy+=x*x;
    const voiced=Math.sqrt(energy/samples.length)>this.voiceThreshold;
    if(!this.active){this.pre.push(samples);this.preLength+=samples.length;while(this.preLength>6400&&this.pre.length>1)this.preLength-=this.pre.shift().length;if(!voiced)return;this.active=true;this.utterance++;this.parts=this.pre;this.length=this.preLength;this.pre=[];this.preLength=0;this.onSpeech();}
    else{this.parts.push(samples);this.length+=samples.length;}
    if(voiced){this.voice+=samples.length;this.silence=0;this.revision++;this.quietSent=false;}else this.silence+=samples.length;
    if(this.onQuiet&&!this.quietSent&&this.voice>=4800&&this.silence>=this.quietSamples){this.quietSent=true;this.onQuiet(this.snapshot(),this.metadata());}
    if(this.silence>=this.silenceSamples||this.length>=720000)this.flush();
    else if(this.onPartial&&this.voice>=4800&&this.length-this.lastPartial>=this.partialSamples){
      this.lastPartial=this.length;this.onPartial(this.snapshot(88000),this.metadata());
    }
  }
  metadata(){return {utteranceId:this.utterance,revision:this.revision,utteranceKey:this.utterance+':'+this.revision,speechEndedAt:this.now()-this.silence/16};}
  snapshot(max=this.length){const all=new Float32Array(this.length);let offset=0;for(const p of this.parts){all.set(p,offset);offset+=p.length;}return all.slice(-max);}
  flush(){
    const meta=this.metadata(),active=this.active,result=active&&this.voice>=4800?this.snapshot():null;
    this.reset();if(active)this.onEnd();if(result)this.onQuestion(result,meta);
  }
}
export function pcmBase64(samples){
  const bytes=new Uint8Array(samples.length*2),view=new DataView(bytes.buffer);
  for(let i=0;i<samples.length;i++)view.setInt16(i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);
  let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);
}
