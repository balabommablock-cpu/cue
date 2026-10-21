export const STORY_FIELDS=['title','situation','decision','action','outcome'];
export function normalize(text){return String(text||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
export function quotedIn(quote,text){const q=normalize(quote);return q.length>=4&&normalize(text).includes(q);}
export function cleanStory(value){
  if(!value||typeof value!=='object')throw new Error('Invalid story.');
  const story={id:typeof value.id==='string'?value.id.slice(0,100):'',status:value.status==='confirmed'?'confirmed':'draft'};
  for(const key of STORY_FIELDS){if(typeof value[key]!=='string'||value[key].length>(key==='title'?160:1800))throw new Error('Keep each story field under 1,800 characters.');story[key]=value[key].trim();}
  if(!story.title)throw new Error('Give this story a title.');
  story.tags=Array.isArray(value.tags)?value.tags.filter(x=>typeof x==='string').slice(0,8).map(x=>x.slice(0,50)):[];
  story.sourceQuote=String(value.sourceQuote||'').slice(0,2500);
  story.followUps=Array.isArray(value.followUps)?value.followUps.filter(x=>typeof x==='string').slice(0,4).map(x=>x.slice(0,250)):[];
  return story;
}
export function storyFacts(stories,budget=14000){
  const kept=[];for(const s of stories.filter(s=>s.status==='confirmed')){const block={id:s.id,...Object.fromEntries(STORY_FIELDS.map(k=>[k,s[k]])),tags:s.tags};if(JSON.stringify([...kept,block]).length>budget)continue;kept.push(block);}return JSON.stringify(kept);
}
export function confirmedProfile(profile){return String(profile||'').split(/\nSTILL TO CONFIRM\b/i)[0];}
export function rankStories(question,stories){
  const expansions={stakeholder:['disagreement','conflict','franchisee','cxo','convince'],resources:['small','team','developer','constraints'],failure:['failed','wrong','learn','mistake'],leadership:['team','people','own','decision'],growth:['distribution','launch','market','acquisition']};
  const tokens=new Set(normalize(question).split(' ').filter(w=>w.length>3));for(const [word,synonyms] of Object.entries(expansions))if([word,...synonyms].some(w=>tokens.has(w)))for(const w of [word,...synonyms])tokens.add(w);
  return stories.filter(s=>s.status==='confirmed').map(story=>{const text=normalize(STORY_FIELDS.map(k=>story[k]).join(' ')+' '+story.tags.join(' '));return {story,score:[...tokens].filter(t=>text.includes(t)).length};}).filter(x=>x.score>=2).sort((a,b)=>b.score-a.score).slice(0,3).map(x=>x.story);
}
export function contextStories(stories,question='',budget=14000){
  const ranked=rankStories(question,stories),ids=new Set(ranked.map(s=>s.id));
  return JSON.parse(storyFacts([...ranked,...stories.filter(s=>!ids.has(s.id))],budget)).map(s=>({...s,status:'confirmed'}));
}
export class SpeechLedger {
  constructor(){this.turns=new Map();this.fallback=0;}
  add({text,utteranceId,revision=0,final=false}){
    if(!text?.trim())return;const id=utteranceId??`manual-${++this.fallback}`;const old=this.turns.get(id);
    if(old&&(old.final||revision<old.revision))return;
    let merged=text.trim();
    if(old&&!final){const a=old.text.split(/\s+/),b=merged.split(/\s+/);let overlap=0;for(let n=1;n<=Math.min(a.length,b.length);n++)if(normalize(a.slice(-n).join(' '))===normalize(b.slice(0,n).join(' ')))overlap=n;
      if(normalize(merged).startsWith(normalize(old.text)))merged=text.trim();else if(overlap>=2)merged=[...a,...b.slice(overlap)].join(' ');else if(a.length>b.length)merged=old.text+' '+merged;
    }
    this.turns.set(id,{text:merged.slice(-12000),revision,final});while(this.turns.size>40)this.turns.delete(this.turns.keys().next().value);
  }
  text(){return [...this.turns.values()].map(x=>x.text).join(' ').slice(-18000);}
  clear(){this.turns.clear();}
}
export function validateCoach(result,input){
  if(!result||!Array.isArray(result.steps)||result.steps.length!==3||result.steps.some(s=>!s||typeof s.label!=='string'||!s.label.trim())||typeof result.nudge!=='string'||!result.nudge.trim()||result.checks!==undefined&&!Array.isArray(result.checks))throw new Error('The coach returned an unreadable update.');
  const said=input.said||'';const facts=confirmedProfile(input.profile)+'\n'+storyFacts(input.stories||[]);
  const steps=result.steps.map((s,i)=>({label:String(input.plan?.[i]?.label||s.label).slice(0,40),covered:s.covered===true&&quotedIn(s.evidence,said),evidence:quotedIn(s.evidence,said)?s.evidence.slice(0,350):''}));
  const checks=(result.checks||[]).filter(c=>c&&typeof c.heard==='string'&&typeof c.reference==='string'&&typeof c.message==='string'&&c.message.trim()&&c.confidence>=.9&&quotedIn(c.heard,said)&&quotedIn(c.reference,facts)).slice(0,2).map(c=>({heard:c.heard.slice(0,300),reference:c.reference.slice(0,300),message:c.message.slice(0,240)}));
  const unsupported=result.steps.some((step,i)=>step.covered&&!steps[i].covered);
  return {steps,nudge:unsupported?'Make this specific: '+steps.find(s=>!s.covered).label+'.':result.nudge.slice(0,150),storyId:(input.stories||[]).some(s=>s.status==='confirmed'&&s.id===result.storyId)?result.storyId:'',checks,offTopic:result.offTopic===true&&quotedIn(result.offTopicEvidence,said)};
}
