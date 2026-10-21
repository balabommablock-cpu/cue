import {unwrap} from './account-ui.js';
export function apiResponse(native,data,signal){
  const interrupt=id=>{void Promise.resolve(native.apiInterrupt(id)).catch(()=>{});};
  const id=crypto.randomUUID(),encoder=new TextEncoder();let off,closed=false,abort;
  const body=new ReadableStream({start(controller){
    const emit=e=>{if(!closed&&!signal?.aborted)controller.enqueue(encoder.encode(JSON.stringify(e)+'\n'));};
    const finish=()=>{if(closed)return;closed=true;off?.();signal?.removeEventListener('abort',abort);controller.close();};
    abort=()=>{interrupt(id);finish();};
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){finish();return;}
    emit({type:'accepted',requestId:id});emit({type:'question',text:data.question});
    emit({type:'stage',step:'draft',text:'Thinking with '+(data.provider==='anthropic'?'Claude':'OpenAI')+'…'});
    off=native.onApiAnswer(e=>{if(e.id===id&&e.type==='delta')emit({type:'answer',text:'ANSWER:\n'+e.text,streaming:true});});
    native.apiAnswer({...data,id}).then(result=>{const value=unwrap(result);emit({type:'answer',text:'ANSWER:\n'+value.text,streaming:false});emit({type:'done'});}).catch(e=>emit({type:'error',message:e.message})).finally(finish);
  },cancel(){closed=true;off?.();signal?.removeEventListener('abort',abort);interrupt(id);}});
  return new Response(body,{headers:{'Content-Type':'application/x-ndjson'}});
}
