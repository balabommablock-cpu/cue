import {formatSuggestion} from './core.js';
export function unwrap(result){if(!result?.ok){const error=new Error(result?.error?.message||'Reopen the Cue Mac app to continue.');error.code=result?.error?.code;throw error;}return result.value;}
export function accountResponse(native,data,signal){
  const id=crypto.randomUUID(),encoder=new TextEncoder();let off,closed=false,abort;
  const body=new ReadableStream({start(controller){
    const emit=e=>{if(!closed&&!signal?.aborted)controller.enqueue(encoder.encode(JSON.stringify(e)+'\n'));};
    const finish=()=>{if(closed)return;closed=true;off?.();signal?.removeEventListener('abort',abort);controller.close();};
    abort=()=>{void native.accountInterrupt(id);finish();};
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){finish();return;}
    emit({type:'accepted',requestId:id});emit({type:'question',text:data.question});emit({type:'stage',step:'draft',text:'Thinking with ChatGPT…'});
    off=native.onAccountAnswer(e=>{if(e.id===id&&e.type==='delta')emit({type:'answer',text:formatSuggestion(e.text,data.autoDetect),streaming:true});});
    native.accountAnswer({id,model:data.model,messages:data.messages}).then(result=>{const value=unwrap(result);emit({type:'answer',text:formatSuggestion(value.text,data.autoDetect),streaming:false});emit({type:'done'});}).catch(e=>emit({type:'error',message:e.message})).finally(finish);
  },cancel(){closed=true;off?.();signal?.removeEventListener('abort',abort);void native.accountInterrupt(id);}});
  return new Response(body,{headers:{'Content-Type':'application/x-ndjson'}});
}
