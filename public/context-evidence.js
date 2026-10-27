// Markdown context packs often mix biography, role/company research and a
// rehearsal answer bank. Keep the original pack locally; do not promote draft
// answers or its embedded instructions into facts or governing instructions.
export function splitContextDocument(value=''){
 const text=String(value),matches=[...text.matchAll(/^##\s+(.+)$/gm)];
 if(!matches.length)return {structured:false,personal:text,opportunity:'',preparationSections:0};
 const personal=[],opportunity=[];let preparationSections=0,recognised=0;
 for(let i=0;i<matches.length;i++){
  const heading=matches[i][1].replace(/^\d+[.)]?\s*/,''),body=text.slice(matches[i].index,i+1<matches.length?matches[i+1].index:text.length).trim();
  if(/answer bank|sample answers?|suggested answers?|prepared answers?|mock interview|questions (?:to ask|and answers)|main risks|interviewer angle|hypothes|practice|rehearsal/i.test(heading)){preparationSections++;recognised++;continue;}
  if(/\b(cv|resume|career|personal facts|background|experience|education|skills|my facts|profile|goals|strengths|compensation|availability)\b/i.test(heading)){personal.push(body);recognised++;continue;}
  if(/\b(role|job description|company|business|employer|opportunity|jd|what is known)\b/i.test(heading)){opportunity.push(body);recognised++;}
 }
 if(!recognised)return {structured:false,personal:text,opportunity:'',preparationSections:0};
 const title=text.match(/^#\s+(.+)$/m)?.[1];
 return {structured:true,personal:(personal.length&&title?'Reference title: '+title+'\n\n':'')+personal.join('\n\n'),opportunity:opportunity.join('\n\n'),preparationSections};
}
export function opportunityFor(question,opportunity=''){
 if(!opportunity)return '';
 const q=String(question).toLowerCase();
 if(/\b(here|this role|this company|this business|our platform|our customers|our business|first (?:90|ninety) days)\b/.test(q))return opportunity;
 const stop=new Set('what where which should would could about think product products business company model models feature features first next before after given using build building need needs user users customer customers team teams work works role good best from with have that this does your their there will more into make want'.split(' '));
 const terms=[...new Set(q.match(/[\p{L}\p{N}]{4,}/gu)||[])].filter(t=>!stop.has(t));
 const stem=t=>t.endsWith('ies')?t.slice(0,-3)+'y':t.endsWith('s')&&!t.endsWith('ss')?t.slice(0,-1):t;
 const plain=opportunity.toLowerCase().replace(/https?:\/\/\S+/g,''),known=new Set((plain.match(/[\p{L}\p{N}]{4,}/gu)||[]).map(stem));
 return terms.some(t=>known.has(stem(t)))?opportunity:'';
}
