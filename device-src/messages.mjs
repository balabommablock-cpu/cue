import {makeMessages,EMPTY_PROFILE} from './context.mjs';
export function answerMessages(data){
  const documents=(data.knowledge?.records||[]).filter(r=>r.kind==='fact').slice(0,23).map((r,i)=>({id:String(i),title:r.title||'Context',text:String(r.text||'').slice(0,80000)}));
  const profile={...EMPTY_PROFILE,facts:String(data.profile||'').slice(0,20000),documents,style:data.style==='script'?'paragraph':'cues'};
  if(String(data.profile||'').length>20000)profile.documents.push({id:'additional-profile',title:'More personal context',text:String(data.profile).slice(20000,40000)});
  const history=(data.history||[]).filter(h=>!/^WAIT:/.test(h.answer)).map(h=>({...h,answer:h.answer.replace(/^ANSWER:\s*/, '')}));
  return makeMessages(String(data.question||'').slice(0,2500),profile,history,data.autoDetect);
}
