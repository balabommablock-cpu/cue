// One decoder at a time. Final questions take precedence over expendable
// microphone previews; late recognition cannot revive a stopped session.
function delay(ms,signal){return new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new DOMException('Stopped.','AbortError'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
});}
export async function transcribeRequest(pcm,signal,{fetcher=fetch,wait=delay,lane='question'}={}){
  const bounded=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(70000)]);
  for(let attempt=0;attempt<4;attempt++){
    bounded.throwIfAborted();
    const r=await fetcher('/api/transcribe',{method:'POST',headers:{'Content-Type':'application/json','X-Cue-Client':'1'},body:JSON.stringify({pcm,lane}),signal:bounded});
    const result=await r.json();
    // Pause cancels the browser request before the old decoder process finishes
    // exiting. Briefly retry that busy window without replaying any answer.
    if(r.status===429&&attempt<3){await wait([100,300,900][attempt],bounded);continue;}
    if(!r.ok)throw new Error(result.error||'Speech recognition failed.');
    if(typeof result.text!=='string')throw new Error('Speech recognition returned an unreadable result.');
    return result.text;
  }
}
export class SpeechPipeline {
  constructor({transcribe,onTranscript,onPreview=()=>{},onError=()=>{},onState=()=>{},onIdle=()=>{},parallel=false}){Object.assign(this,{transcribe,onTranscript,onPreview,onError,onState,onIdle});this.queue=[];this.busy=false;this.epoch=0;this.closed=false;this.cache=new Map();if(parallel)this.lanes=[new SpeechPipeline({transcribe,onTranscript,onPreview,onError,onState,onIdle}),new SpeechPipeline({transcribe,onTranscript,onPreview,onError,onState,onIdle})];}
  hasPendingQuestionSpeech(){return this.lanes?this.lanes.some(lane=>lane.hasPendingQuestionSpeech()):[this.activeItem,...this.queue].some(item=>item&&(item.source==='system'||item.source==='shared'&&(item.final||item.endpoint)));}
  push(item){
    if(this.closed)return;
    if(this.lanes){this.lanes[item.source==='system'?0:1].push(item);return;}
    if(item.final&&item.utteranceKey){
      const cached=this.cache.get(item.utteranceKey);
      if(cached){this.cache.delete(item.utteranceKey);if(cached.text.trim())this.onTranscript({...item,...cached,eager:true});return;}
      const pending=[this.activeItem,...this.queue].find(q=>q?.utteranceKey===item.utteranceKey&&q.source===item.source);
      if(pending){Object.assign(pending,item,{eager:true});return;}
    }
    this.queue=this.queue.filter(q=>!(q.source===item.source&&!q.final));
    if(this.queue.length>=8){
      const preview=this.queue.findIndex(q=>!q.final);
      if(preview>=0)this.queue.splice(preview,1);
      else{this.onError(new Error('Audio is arriving faster than it can be transcribed. Pause briefly or use Type question.'));return;}
    }
    // Priority must be stable: a later interviewer chunk cannot overtake an
    // earlier one. Only expendable previews and candidate turns move behind it.
    if(item.source==='system'&&item.final){
      const index=this.queue.findIndex(q=>!(q.source==='system'&&q.final));
      this.queue.splice(index<0?this.queue.length:index,0,item);
    }else this.queue.push(item);
    void this.drain();
  }
  async drain(){
    if(this.busy||this.closed)return;
    const item=this.queue.shift();if(!item)return;
    this.busy=true;this.activeItem=item;const epoch=this.epoch,controller=new AbortController();this.controller=controller;
    this.onState({stage:'transcribe',source:item.source,preview:!item.final,queued:this.queue.length});
    try{
      const started=performance.now();const text=await this.transcribe(item.pcm,controller.signal,item);
      if(!this.closed&&epoch===this.epoch){
        const result={text,recognizedAt:performance.now(),transcriptionMs:performance.now()-started};
        if(item.endpoint&&!item.final){this.cache.set(item.utteranceKey,result);if(this.cache.size>4)this.cache.delete(this.cache.keys().next().value);if(text.trim())this.onPreview({...item,...result});}
        else if(item.previewOnly&&!item.final){if(text.trim())this.onPreview({...item,...result});}
        else if(text.trim())this.onTranscript({...item,...result});
      }
    }
    catch(e){if(!this.closed&&epoch===this.epoch&&e.name!=='AbortError')this.onError(e);}
    finally{this.busy=false;this.activeItem=null;this.controller=null;void this.drain();if(!this.closed&&epoch===this.epoch)this.onIdle();}
  }
  clear(){this.epoch++;this.queue=[];this.cache.clear();this.controller?.abort();this.lanes?.forEach(lane=>lane.clear());}
  stop(){this.closed=true;this.clear();this.lanes?.forEach(lane=>lane.stop());}
}
