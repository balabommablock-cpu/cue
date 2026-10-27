export const normalise=q=>String(q||'').trim().toLowerCase().replace(/^please\s+/,'').replace(/^(can|could|would|will) you (please )?(?=define|explain|compare|tell me|solve|calculate|translate|write|rewrite|draft|debug|summari[sz]e|derive|list|outline|design)/,'');
export const refersBack=q=>/^(and |but |why\??$|why not\b|how so\b|how about\b|what if\b|what about\b|tell me more\b|what happened next\b|then\b)|\b(that|those|it|them|instead|again|the previous|the earlier|your proposed|your suggestion|your answer)\b/.test(q);
export const submitted=q=>/\b(application|submitted|submission|form)\b/.test(q);

// Career evidence is opt-in by the meaning of the request. Second-person
// wording ("How do you price a product?") is not itself a biography question.
export function questionMode(question='',history=[]){
 const q=normalise(question);
 const tailoredAdvice=/\b(?:given|based on|considering|with)\b.{0,70}\b(?:my|your)\s+(?:experience|background|skills|career|strengths?|context|track record)\b/.test(q)
  || /\b(?:what|where|how)\b.{0,35}\bshould I\b/i.test(q) && /\b(?:build|start|focus|choose|position|improve|career|business|next)\b/.test(q)
  || /\b(?:apply|use|build on|draw on)\b.{0,35}\b(?:your|my|what you)\b.{0,35}\b(?:experience|background|learned|skills|launch)\b/.test(q);
 if(tailoredAdvice)return 'personal-advice';
 const historical=/\b(?:did|have|had)\s+(?:you|i|we)\b|\b(?:your|my) (?:actual|past|previous|submitted)\b|\b(?:you|i|we) (?:worked|launched|achieved|quit|left|led|owned)\b/.test(q);
 const selection=/\bwhy should we (?:select|choose|pick|back|hire)\b|\bwhy (?:do|would) (?:you|i) need\b/.test(q);
 const imagined=/^(?:suppose|imagine|assume|let['’]s say|your (?:company|team|product|ceo|manager)\b)|\b(?:would|could|should)\s+(?:you|we|i)\b/.test(q);
 if(imagined&&!historical&&!selection)return 'scenario';
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
  if(previous&&['personal','personal-advice'].includes(questionMode(previous,[]))&&/^(why\??$|what happened next|how did|what did|and then|tell me more)|\b(that (experience|launch|project)|your (decision|contribution))\b/.test(q))return 'personal';
  return 'follow-up';
 }
 if(/\b(suppose|imagine|hypothetically|hypothetical|case study|proposed product)\b/.test(q)||/\b(would|could|should)\s+(you|we|i)\b/.test(q)||/^if\b/.test(q))return 'scenario';
 return 'general';
}

