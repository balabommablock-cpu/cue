import {splitContextDocument,opportunityFor} from './public/context-evidence.js';
import {knowledgeText} from './knowledge.mjs';
import {validateConversation,SPOKEN_CONTEXT_RULES} from './public/conversation.js';

import {normalise,refersBack,submitted,questionMode} from './public/question-intent.js';
export {questionMode};

export function answerContext({question,history=[],conversation=[],profile='',knowledge={records:[]},now=new Date(),autoDetect=false}){
 let mode=questionMode(question,history);const q=normalise(question),asksSubmission=submitted(q);
 const parts=splitContextDocument(profile),opportunities=[parts.opportunity];
 const candidateRecords=(knowledge.records||[]).map(r=>{if(asksSubmission)return r;const p=splitContextDocument(r.text);if(p.opportunity)opportunities.push(p.opportunity);return p.structured?{...r,text:p.personal}:r;}).filter(r=>r.text);
 const opportunity=opportunityFor(question,opportunities.filter(Boolean).join('\n\n'));
 if(mode==='general'&&/^why\s+\S+[?.!]*$/i.test(String(question).trim())&&opportunity)mode='personal-advice';
 const personal=mode==='personal'||mode==='personal-advice';
 const today=now.toISOString().slice(0,10);
 // A fresh question gets no previous generated script. Follow-ups keep a small
 // explicit snapshot. Speech detection also needs recent turns to detect echoes.
 const explicitQuestion=/^(what|why|how|who|when|where|which|is|are|do|does|did|can|could|would|should|tell|explain|sell|calculate|solve|write|return|translate|define|compare|give|show|summari[sz]e)\b/.test(q);
 const recent=mode==='follow-up'||mode==='personal'&&refersBack(q)||autoDetect&&!explicitQuestion&&mode==='personal'?history.slice(-2).map(h=>({question:h.question.slice(0,2000),answer:h.answer.slice(0,2000)})):[];
 const external=/\b(incubator|accelerator|programme|program|eligib|deadline|policy|rules)\b/.test(q);
 const records=candidateRecords.filter(r=>{
  if(r.kind==='research')return (!r.validUntil||r.validUntil>=today)&&(personal||external);
  if(r.kind==='preference')return personal;
  if(!personal)return false;
  if(r.kind==='application'||r.kind==='reference')return asksSubmission;
  return r.kind==='fact'||r.kind==='record';
 });
 return {mode,today,history:recent,conversation:validateConversation(conversation),profile:personal?(asksSubmission?profile:parts.personal):'',opportunity,knowledge:{...knowledge,records}};
}
export function answerPrompt({question,history=[],conversation=[],profile='',opportunity='',knowledge,mode='general',today=new Date().toISOString().slice(0,10),autoDetect=false,inputSource}){
 const reference=profile?'\n\nCAREER FACTS (user-supplied reference; only supported past claims):\n'+profile:'';
 const roleContext=opportunity?'\n\nOPPORTUNITY / COMPANY REFERENCE (supplied, dated claims may need verification; not personal achievements):\n'+opportunity+'\nUse this to understand the business and reason about the current problem. In a PM case, make a specific call, explain the most important trade-off and a decisive test. Choose the sharpest points rather than a checklist. Do not recite the reference or a rehearsal answer.':'';
 const source=inputSource==='shared'?'shared room microphone; either person may be speaking':inputSource==='mic'?'candidate microphone':inputSource==='system'?'computer or interviewer audio':'mixed audio';
 return `CURRENT TASK: ${autoDetect?'Decide whether the transcript contains a new question or task, then answer it.':'Answer the question or complete the requested text task directly.'}\nDate: ${today}. No live web access.\n${autoDetect?'LATEST TRANSCRIPT ('+source+')':'CURRENT QUESTION OR TASK'}:\n${question}${conversation.length?'\n\n'+SPOKEN_CONTEXT_RULES+'\nLIVE CONVERSATION:\n'+JSON.stringify(conversation):''}${history.length?'\n\nRECENT SUGGESTIONS (not proof the candidate spoke these words):\n'+JSON.stringify(history):''}\n\nCONTEXT SELECTION: ${mode}. ${mode==='personal-advice'?'Use personal facts as constraints and starting points for a new recommendation. Derive a specific choice, explain why it fits and what would disprove it. Proposals may be new; they must not be presented as past achievements. Do not answer by reciting experience.':'Use general knowledge and independent reasoning. Answer this question on its own merits.'}${reference}${roleContext}${knowledgeText(knowledge)}\n\nGive the requested answer, language and format. No unrelated personal story.`;
}
