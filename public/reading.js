export function words(text){
  return [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu)].map(m=>({word:m[0].toLowerCase().replace(/[’']/g,''),start:m.index,end:m.index+m[0].length}));
}

// Align a short ASR window against the visible script. Require a substantial,
// ordered match, tolerate skipped/filler words, and never rewind on a stutter.
export function matchReading(answer,heard,cursor=0){
  const script=words(answer),spoken=words(heard).filter(t=>!['um','uh','erm'].includes(t.word)).slice(-42);
  if(spoken.length<4||script.length<4)return null;
  let best=null;
  for(let prefix=0;prefix<Math.min(4,spoken.length-3);prefix++)for(let start=Math.max(0,cursor-42);start<script.length;start++){
    if(script[start].word!==spoken[prefix].word)continue;
    let j=start,matches=0,last=start,skips=0;
    for(const token of spoken.slice(prefix)){
      let found=-1;
      for(let k=j;k<Math.min(script.length,j+7);k++)if(script[k].word===token.word){found=k;break;}
      if(found>=0){skips+=found-j;j=found+1;last=found;matches++;}
    }
    const confidence=matches/spoken.length;
    if(matches<4||confidence<.65||skips>matches)continue;
    // Avoid leaping down the script on a few generic words.
    if(last-cursor>60&&matches<9)continue;
    const score=matches-skips*.35-Math.abs(start-cursor)*.015;
    if(!best||score>best.score)best={wordIndex:Math.max(cursor,last+1),confidence,score};
  }
  if(!best)return null;
  return {...best,total:script.length,offset:script[Math.min(best.wordIndex,script.length-1)]?.start||0};
}

export function sameUtterance(a,b){
  const left=words(a).map(t=>t.word),right=words(b).map(t=>t.word);
  if(!left.length||!right.length)return false;
  // A single changed word, number, negation or word order can change the task.
  // Prefer a duplicate request over silently discarding a different question.
  return left.join(' ')===right.join(' ');
}

export function explicitQuestion(text){if(/^(?:and then|anything else|the result|your role)[?.!]?$/i.test(text.trim()))return true;return /^(?:ok(?:ay)?[,.]?\s*|so[,.]?\s*|(?:and|but|wait|sorry)[,.]?\s*)?(?:please\s+)?(?:(?:what|why|how|when|where|who|which)\b|(?:can|could|would|will)\s+you\b|(?:did|does|do|is|are|was|were|has|have)\b|give\s+me\b|tell\s+me\b|walk\s+me\b|(?:describe|explain|compare|define|solve|calculate|translate|write|rewrite|draft|debug|summari[sz]e|derive|list|outline|design)\b)/i.test(text.trim());}

// A phone and the candidate share one physical microphone. These are intent
// hints, not speaker identification. Ambiguous speech goes to the model's turn
// check; it must never be silently labelled as the candidate from its source.
export function sharedMicIntent(text,{answer='',cursor=0,turnOpen=false}={}){
  const clean=text.trim().replaceAll('’',"'").replace(/^(?:(?:ok(?:ay)?|so|well|right|um|uh)[,.]?\s+)+/i,'');
  if(turnRoute({text:clean,source:'shared'})==='ack')return 'ack';
  const self=/^(?:(?:and|but)\s+)?(?:I\b|I've\b|I'm\b|I'd\b|I'll\b|we\b|we've\b|we're\b|my\b|our\b|for me\b|in my\b|what I\b|how I\b|why I\b|the (?:result|reason|decision) was\b)/i.test(clean);
  // Requests in a candidate's quotation or self-question are not new prompts.
  if(!self&&(explicitQuestion(clean)||/^(?:why not|what else|anything else|your role|the result)[?.!]*$/i.test(clean)||/^(?:you (?:said|mentioned|wrote)\b.+[?.!]\s*)?(?:tell|show|give|walk) me\b/i.test(clean)))return 'question';
  if(answer&&matchReading(answer,clean,cursor))return 'candidate';
  if(self&&!/^(?:I'd like (?:you|to hear)|I'm (?:curious|interested)\b|I (?:want|wanted) (?:you|to (?:know|hear)))/i.test(clean)){
    if(/[.!?]\s+(?:what|why|how|when|where|which)\b[^.!?]*\b(?:you|your)\b/i.test(clean))return 'unknown';
    return 'candidate';
  }
  if(turnOpen&&/^(?:and|also|then|finally|plus)\b/i.test(clean)&&! /\b(?:I|we|my|our)\b/i.test(clean))return 'question';
  return 'unknown';
}

export function turnRoute({text,source,hasAnswer,forced=false,dual=false}){
  if(forced)return 'answer';
  const clean=words(text).map(t=>t.word).join(' ');
  if(/^(?:thank you(?: very much)?|thanks(?: a lot)?|okay|ok|yes|yeah|no|sure|right|got it|understood|that makes sense|bye|goodbye|mm hmm|uh huh)$/.test(clean))return 'ack';
  // In this two-input product the microphone belongs to the candidate. Keep
  // their normal response as context rather than asking a model to rewrite it.
  if(source==='mic'&&dual)return 'context';
  return 'answer';
}

// Retractions discard the old question; ordinary follow-ups retain its context.
// A candidate saying "actually" is never an interviewer cancellation.
export function questionReplacement(text,source){
  if(source!=='system')return null;
  const match=text.trim().match(/^(?:actually[,;:]?\s+)?(?:forget that(?: question)?|scratch that|let me rephrase(?: that)?)(?=$|[\s.,;:!?—–-])[.,;:!?—–-]*\s*(.*)$/i);
  if(!match)return null;
  return {question:match[1].trim()};
}
