export function stripReasoning(text){
  let value=String(text).trimStart();
  while(value.startsWith('<')){
    if(['<think>','<analysis>'].some(tag=>tag.startsWith(value.toLowerCase())))return '';
    const open=/^<(think|analysis)>/i.exec(value);if(!open)break;
    const close=new RegExp('</'+open[1]+'>','i').exec(value);
    if(!close)return '';
    value=value.slice(close.index+close[0].length).trimStart();
  }
  return value;
}
export function parseResponse(raw) {
  const q=/^QUESTION:\s*(.*)/m.exec(raw)?.[1]?.trim() || '';
  const answerAt=/^ANSWER:/m.exec(raw)?.index??-1;
  // Some model responses put the reserved CHECK field after a sentence.
  // Keep that private note out of the speakable answer even without a newline.
  const tail=answerAt>=0?raw.slice(answerAt+7):raw;
  // In a complete JSON artifact, quoted words such as "CHECK:" are data,
  // not private-note delimiters. Preserve exact requested JSON output.
  if(answerAt>=0){try{JSON.parse(tail);return {question:q,answer:tail.trim(),check:''};}catch{}}
  const check=/(?:^|\s)CHECK:/.exec(tail);
  const checkAt=check?(answerAt>=0?answerAt+7:0)+check.index+check[0].indexOf('CHECK:'):-1;
  let answer=answerAt >= 0 ? raw.slice(answerAt+7,checkAt > answerAt ? checkAt : undefined).trim() : '';
  // Do not briefly expose a half-streamed CHECK label as words to read aloud.
  answer=stripReasoning(answer).replace(/(?:^|\n)(?:C|CH|CHE|CHEC|CHECK)\s*$/,'').trim();
  answer=answer.replace(/([.!?])\s+(?:C|CH|CHE|CHEC|CHECK)\s*$/,'$1').trim();
  const note=checkAt>=0?raw.slice(checkAt+6).trim():'';
  return {
    question:q,
    answer,
    check:/^(?:none|n\/a|not needed|omit if unnecessary)[.!]?$/i.test(note)?'':note,
  };
}
export function completedText(response) {
  return (response?.output || []).flatMap(item=>item.content || []).filter(x=>x.type==='text'||x.type==='output_text').map(x=>x.text || '').join('\n');
}

// A finished opening line, not a token or a guessed sentence boundary. Wait
// for the newline so streamed decimals and abbreviations cannot commit early.
export function completedOpening(raw){
  const text=parseResponse(raw).answer,newline=text.indexOf('\n');if(newline<0)return '';
  const first=text.slice(0,newline).trim(),count=first.split(/\s+/).length;
  return first.length<=200&&(count>=5||count>=3&&/\d/.test(first))&&!/^(?:[#{\[```]|[-•])/u.test(first)?first:'';
}

// The inline turn check may decline a background comment. Do not wrap its
// WAIT sentinel in ANSWER, including while that sentinel is still streaming.
export function formatSuggestion(text,autoDetect=false){
  const value=stripReasoning(text);
  if(!value)return '';
  if(autoDetect&&(/^(?:W|WA|WAI)$/.test(value)||/^WAIT(?::|$)/.test(value)))return value;
  return 'ANSWER:\n'+value;
}
