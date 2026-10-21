// Bounded incremental NDJSON decoder. Handles UTF-8 split across packets,
// missing trailing newlines and abrupt disconnects without treating them as done.
export async function consumeAnswer(response,onEvent){
  if(!response.body)throw new Error('The answer response was empty. Retry the question.');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',bytes=0,complete=false;
  const line=text=>{
    if(!text.trim())return;
    if(complete)throw new Error('Unexpected data after the answer finished. Retry the question.');
    let event;try{event=JSON.parse(text);}catch{throw new Error('The answer stream was unreadable. Retry the question.');}
    if(!event||!['accepted','stage','question','answer','empty','error','done','timing','context'].includes(event.type))throw new Error('The answer stream contained an unexpected event.');
    if(['stage','question','answer'].includes(event.type)&&(typeof event.text!=='string'||event.text.length>12000))throw new Error('The answer exceeded its text limit or was unreadable.');
    if(event.type==='context'&&(!['general','scenario','follow-up','personal'].includes(event.mode)||!Number.isInteger(event.records)||event.records<0||event.records>500||!Number.isInteger(event.historyTurns)||event.historyTurns<0||event.historyTurns>2))throw new Error('The answer stream contained invalid context metadata.');
    if(event.type==='timing'&&(!event.phases||Object.values(event.phases).some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0)))throw new Error('The answer stream contained invalid timing data.');
    if(event.type==='error')throw new Error(typeof event.message==='string'?event.message:'The answer failed. Retry the question.');
    onEvent(event);if(['done','empty'].includes(event.type))complete=true;
  };
  try{
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2_000_000)throw new Error('The answer stream exceeded its limit. Retry the question.');buffer+=decoder.decode(value,{stream:true});let n;
      while((n=buffer.indexOf('\n'))>=0){line(buffer.slice(0,n));buffer=buffer.slice(n+1);}if(buffer.length>80000)throw new Error('The answer stream exceeded its limit. Retry the question.');
    }
    buffer+=decoder.decode();if(buffer.trim())line(buffer);
    if(!complete)throw new Error('The answer connection ended early. Retry the question.');
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
