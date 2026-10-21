import {LocalBrain,LocalSpeech,MODELS,checkDevice} from './models.js';
import {makeMessages,EMPTY_PROFILE,visibleAnswer,looksLikeQuestion} from './context.mjs';
export {readDocument} from './import.js';
export {MODELS};
export {answerMessages} from './messages.mjs';

export function createRuntime({progress=()=>{},brainFactory=p=>new LocalBrain(p),speechFactory=p=>new LocalSpeech(p),deviceCheck=checkDevice}={}){
  const brain=brainFactory(p=>progress({kind:'answer',...p}));
  const speech=speechFactory(p=>progress({kind:'speech',...p}));
  let preparing=null,preparingModel='',setupRevision=0,serial=Promise.resolve(),active='',choice='balanced',revision=0;
  let speechPreparing;
  async function prepareSpeech(signal){
    signal?.throwIfAborted();if(speech.ready)return;
    const abort=()=>speech.dispose();signal?.addEventListener('abort',abort,{once:true});
    try{speechPreparing??=speech.load().finally(()=>{speechPreparing=null;});await speechPreparing;signal?.throwIfAborted();progress({kind:'speech-ready',text:'Listening is ready on this Mac.'});}
    finally{signal?.removeEventListener('abort',abort);}
  }
  async function prepare({audio=true,model='balanced'}={},signal){
    signal?.throwIfAborted();
    if(preparing){
      const prior=preparing,different=preparingModel!==model;
      if(different)cancelSetup();
      try{await prior;}catch(error){if(!different)throw error;}
      signal?.throwIfAborted();
    }
    if(brain.ready&&choice===model&&(!audio||speech.ready))return;
    const token=++setupRevision;
    const ensureCurrent=()=>{signal?.throwIfAborted();if(token!==setupRevision)throw new DOMException('Setup cancelled.','AbortError');};
    const abort=()=>{if(token===setupRevision)cancelSetup();};signal?.addEventListener('abort',abort,{once:true});
    const job=(async()=>{
      const device=await deviceCheck();if(!device.ok)throw new Error(device.message);ensureCurrent();
      if(!brain.ready||choice!==model){await brain.load(model);choice=model;}
      ensureCurrent();
      if(audio&&!speech.ready)await speech.load();
      ensureCurrent();progress({kind:'ready',text:'Local AI is ready on this Mac.'});
    })();preparing=job;preparingModel=model;
    try{await job;}finally{signal?.removeEventListener('abort',abort);if(preparing===job){preparing=null;preparingModel='';}}
  }
  function cancelSetup(){setupRevision++;revision++;brain.dispose();speech.dispose();}
  async function transcribe(pcm,signal){
    signal?.throwIfAborted();if(!speech.ready)throw new Error('Prepare local listening in Settings first.');
    if(typeof pcm!=='string'||pcm.length>2560000)throw new Error('Invalid audio.');
    const bytes=Uint8Array.from(atob(pcm),c=>c.charCodeAt(0));if(bytes.length%2)throw new Error('Invalid audio.');
    const view=new DataView(bytes.buffer);const audio=new Float32Array(bytes.length/2);
    for(let i=0;i<audio.length;i++)audio[i]=view.getInt16(i*2,true)/32768;
    const text=await speech.transcribe(audio);signal?.throwIfAborted();return text;
  }
  function answerResponse(data,signal){
    let closed=false;const token=data.requestId||crypto.randomUUID(),encoder=new TextEncoder();
    const started=performance.now();const epoch=revision;
    let finish,abort;
    const stream=new ReadableStream({
      start(controller){
        const emit=e=>{if(!closed&&!signal?.aborted)controller.enqueue(encoder.encode(JSON.stringify({...e,elapsedMs:Math.round(performance.now()-started)})+'\n'));};
        finish=()=>{if(closed)return;closed=true;signal?.removeEventListener('abort',abort);controller.close();};
        abort=()=>{if(active===token)brain.interrupt();finish();};signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted){abort();return;}
        emit({type:'accepted',requestId:token});
        const job=serial.catch(()=>{}).then(async()=>{
          if(closed||epoch!==revision)return;signal?.throwIfAborted();active=token;
          let question=data.question||'';
          if(!question){emit({type:'stage',text:'Transcribing on your Mac…'});question=await transcribe(data.pcm,signal);}
          if(closed)return;
          if(!question.trim()){emit({type:'empty'});return;}
          emit({type:'question',text:question});
          if(data.autoDetect&&data.inputSource!=='system'&&!looksLikeQuestion(question)&&/^(?:what I did|I (?:did|was|have|think|worked|built|decided)|we (?:did|were|built)|thank you)\b/i.test(question)){emit({type:'answer',text:'WAIT: Continuing the conversation.',streaming:false});emit({type:'done'});return;}
          const documents=(data.knowledge?.records||[]).filter(r=>r.kind==='fact').slice(0,23).map((r,i)=>({id:String(i),title:r.title||'Context',text:String(r.text||'').slice(0,80000)}));
          // Context is bounded before the model sees it, including imported material.
          const profile={...EMPTY_PROFILE,facts:String(data.profile||'').slice(0,20000),documents,style:data.style==='script'?'paragraph':'cues'};
          if(String(data.profile||'').length>20000&&documents.length<24)profile.documents.push({id:'additional-profile',title:'More personal context',text:String(data.profile).slice(20000,40000)});
          const history=(data.history||[]).filter(h=>!/^WAIT:/.test(h.answer)).map(h=>({...h,answer:h.answer.replace(/^ANSWER:\s*/, '')}));
          const messages=makeMessages(question.slice(0,2500),profile,history);let result='';
          emit({type:'stage',step:'draft',text:'Thinking on this Mac…'});
          await brain.answer(messages,raw=>{if(closed)return;result=visibleAnswer(raw);if(result.trim())emit({type:'answer',text:'ANSWER:\n'+result,streaming:true});});
          if(!closed){if(!result.trim())throw new Error('No answer arrived. Retry the question.');emit({type:'answer',text:'ANSWER:\n'+result,streaming:false});emit({type:'done'});}
        }).catch(e=>{if(!closed&&e.name!=='AbortError')emit({type:'error',message:e.message});}).finally(()=>{if(active===token)active='';finish();});
        serial=job;
      },cancel(){closed=true;signal?.removeEventListener('abort',abort);if(active===token)brain.interrupt();},
    });
    return new Response(stream,{headers:{'Content-Type':'application/x-ndjson'}});
  }
  return {prepare,prepareSpeech,transcribe,answerResponse,status:()=>({answer:brain.ready,speech:speech.ready,model:choice,loading:!!preparing}),
    async interrupt(){brain.interrupt();await serial;return {interrupted:true};},
    cancelSetup,
    stop(){revision++;brain.interrupt();},
    dispose:cancelSetup,
  };
}
