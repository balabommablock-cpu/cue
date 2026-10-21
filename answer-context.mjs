import {knowledgeText} from './knowledge.mjs';

const normalise=q=>String(q||'').trim().toLowerCase().replace(/^please\s+/,'').replace(/^(can|could|would|will) you (please )?(?=define|explain|compare|tell me|solve|calculate|translate|write|rewrite|draft|debug|summari[sz]e|derive|list|outline|design)/,'');
const refersBack=q=>/^(and |but |why\??$|why not\b|what about\b|what happened next\b|then\b)|\b(that|those|it|them|instead|again|the previous|the earlier|your proposed|your suggestion|your answer)\b/.test(q);
const submitted=q=>/\b(application|submitted|submission|form)\b/.test(q);

// Career evidence is opt-in by the meaning of the request. Second-person
// wording ("How do you price a product?") is not itself a biography question.
export function questionMode(question='',history=[]){
 const q=normalise(question);
 const personal=/^(why (incubator|accelerator)|what makes you|why should we (select|choose|pick|back)|why are you (the right|a good))\b/.test(q)||/\b(yourself|myself|candidate)\b/.test(q)
  || /\bwhy\s+(?:do|would)\s+(?:you|i)\s+need\s+(?:(?:an?|the|this)\s+)?(?:incubator|accelerator|program(?:me)?)\b/.test(q)
  || /\b(your|my|our)\s+(?:(?:last|previous|past|earlier|actual|submitted|biggest|greatest|first|most recent)\s+)*(application|cv|resume|career|biography|bio|background|experience|launch|achievement|role|job|strengths?|weakness(?:es)?|co-?founder|team|company)\b/.test(q)
  || /\b(?:you|i|we)\b.*\b(?:worked|launched|achieved|quit|left|learned|led|owned)\b/.test(q)
  || /\b(?:did|have|had)\s+(?:you|i|we)\b/.test(q)
  || /\b(?:tell|describe|give|share)\b.*\b(?:time|example|experience)\b.*\b(?:you|i|we)\b/.test(q)
  || /\b(?:why|what)\b.*\b(?:you|i)\s+(?:want|bring|chasing|commit)\b/.test(q)
  || /\b(?:my|our)\b.*\b(?:application|submitted|cv|resume|launch|career)\b/.test(q);
 if(personal)return 'personal';
 if(/^if\b/.test(q)&&q.split(/\s+/).length>8)return 'scenario';
 if(refersBack(q)&&history.length){
  const previous=history.at(-1)?.question;
  if(previous&&questionMode(previous,[])==='personal'&&/^(why\??$|what happened next|how did|what did|and then|tell me more)|\b(that (experience|launch|project)|your (decision|contribution))\b/.test(q))return 'personal';
  return 'follow-up';
 }
 if(/\b(suppose|imagine|hypothetically|hypothetical|case study|proposed product)\b/.test(q)||/\b(would|could|should)\s+(you|we|i)\b/.test(q)||/^if\b/.test(q))return 'scenario';
 return 'general';
}

export function answerContext({question,history=[],profile='',knowledge={records:[]},now=new Date(),autoDetect=false}){
 const mode=questionMode(question,history),personal=mode==='personal',q=normalise(question);
 const today=now.toISOString().slice(0,10);
 // A fresh question gets no previous generated script. Follow-ups keep a small
 // explicit snapshot. Speech detection also needs recent turns to detect echoes.
 const explicitQuestion=/^(what|why|how|who|when|where|which|is|are|do|does|did|can|could|would|should|tell|explain|sell|calculate|solve|write|return|translate|define|compare|give|show|summari[sz]e)\b/.test(q);
 const recent=mode==='follow-up'||mode==='personal'&&refersBack(q)||autoDetect&&!explicitQuestion&&mode==='personal'?history.slice(-2).map(h=>({question:h.question.slice(0,2000),answer:h.answer.slice(0,2000)})):[];
 const asksSubmission=submitted(q),external=/\b(incubator|accelerator|programme|program|eligib|deadline|policy|rules)\b/.test(q);
 const records=(knowledge.records||[]).filter(r=>{
  if(r.kind==='research')return (!r.validUntil||r.validUntil>=today)&&(personal||external);
  if(r.kind==='preference')return personal;
  if(!personal)return false;
  if(r.kind==='application'||r.kind==='reference')return asksSubmission;
  return r.kind==='fact'||r.kind==='record';
 });
 return {mode,today,history:recent,profile:personal?profile:'',knowledge:{...knowledge,records}};
}
export function answerPrompt({question,history=[],profile='',knowledge,mode='general',today=new Date().toISOString().slice(0,10),autoDetect=false,inputSource}){
 const reference=profile?'\n\nCAREER FACTS (only for personal claims):\n'+profile:'';
 const source=inputSource==='shared'?'shared room microphone; either person may be speaking':inputSource==='mic'?'candidate microphone':inputSource==='system'?'computer or interviewer audio':'mixed audio';
 return `CURRENT TASK: ${autoDetect?'Decide whether the transcript contains a new question or task, then answer it.':'Answer the question or complete the requested text task directly.'}\nDate: ${today}. No live web access.\n${autoDetect?'LATEST TRANSCRIPT ('+source+')':'CURRENT QUESTION OR TASK'}:\n${question}${history.length?'\n\nRECENT CONVERSATION (generated answers are not biographical evidence):\n'+JSON.stringify(history):''}\n\nCONTEXT SELECTION: ${mode}. Use general knowledge and independent reasoning. Answer this question on its own merits.${reference}${knowledgeText(knowledge)}\n\nGive the requested answer, language and format. No unrelated personal story.`;
}
