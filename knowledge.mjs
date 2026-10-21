import {readFileSync} from 'node:fs';

const stop=new Set('a an the i me my you your we our us it its is are was were be been have has had do did does what which who how why when where tell about of for to in on with and or but can could would should from that this there them their as at by all any one more most much something through now'.split(' '));
const groups=[
 ['cofounder','co-founder','cto','partner'],['resources','resource','constraint','constraints'],
 ['stakeholder','stakeholders','conflict','disagreement'],['customer','customers','user','users'],
 ['education','school','college','degree'],['strength','strengths','quality','speed'],
 ['money','budget','cost','revenue'],['creative','creativity','film','ad','copywriting'],
];
function tokens(text){return String(text||'').toLowerCase().replace(/(\d)[,.](?=\d{3}\b)/g,'$1').match(/[\p{L}\p{N}]+/gu)?.filter(t=>t.length>1&&!stop.has(t))||[];}
function expand(text){const result=new Map(tokens(text).map(t=>[t,1]));for(const group of groups)if(group.some(t=>result.has(t)))for(const t of group)if(!result.has(t))result.set(t,.3);return result;}

export function createKnowledge(pack){
 if(pack?.schemaVersion!==1||!Array.isArray(pack.records)||!Array.isArray(pack.sources)||pack.records.length>500)throw new Error('Invalid background pack.');
 const ids=new Set();
 for(const r of pack.records){if(!r||typeof r.id!=='string'||ids.has(r.id)||!['fact','record','application','preference','reference','research'].includes(r.kind)||!['title','text','source','topics','note'].every(k=>typeof r[k]==='string')||r.text.length>10000||!pack.sources.some(s=>s.id===r.source))throw new Error('Invalid background entry.');if(r.kind==='research'&&(!/^https:\/\//.test(r.url||'')||!/^\d{4}-\d{2}-\d{2}$/.test(r.checkedAt||'')||!/^\d{4}-\d{2}-\d{2}$/.test(r.validUntil||'')||r.validUntil<r.checkedAt))throw new Error('Invalid research source.');ids.add(r.id);}
 const indexed=pack.records.map(r=>({record:r,words:new Set(tokens(r.title+' '+r.text+' '+r.topics)),title:new Set(tokens(r.title+' '+r.topics))}));
 const frequency=new Map();for(const row of indexed)for(const word of row.words)frequency.set(word,(frequency.get(word)||0)+1);
 function retrieve(question='',history=[],budget=11000){
  budget=Math.max(0,Math.min(40000,budget));
  const query=expand(question);const words=tokens(question);
  const fit=/incubator|accelerator/i.test(question)&&/why|want|look|need|expect|get|bring/i.test(question);
  // Short follow-ups inherit only the immediately preceding topic, never old turns.
  if(words.length<=5&&history.length){const last=history.at(-1);for(const [word,weight] of expand(last.question+' '+last.answer.slice(0,1600)))if(!query.has(word))query.set(word,weight*.45);}
  const today=new Date().toISOString().slice(0,10);
  const ranked=indexed.filter(row=>row.record.kind!=='research'||row.record.validUntil>=today).map(row=>({...row,score:(fit&&row.record.id==='cofounder'?30:0)+[...query].reduce((score,[word,weight])=>score+(row.words.has(word)?weight*(1+Math.log(1+indexed.length/(1+(frequency.get(word)||0))))*(row.title.has(word)?1.8:1):0),0)})).filter(row=>row.score>0||row.record.always).sort((a,b)=>Number(!!b.record.always)-Number(!!a.record.always)||b.score-a.score);
  const records=[];let used=0;
  for(const row of ranked){const r=row.record;const item={id:r.id,kind:r.kind,title:r.title,source:r.source,text:r.text,...(r.note?{note:r.note}:{}),...(r.kind==='research'?{url:r.url,checkedAt:r.checkedAt,validUntil:r.validUntil}:{})};const length=JSON.stringify(item).length;if(used+length>budget)continue;records.push(item);used+=length;if(records.length>=9)break;}
  return {id:pack.id,records};
 }
 return {retrieve,summary:()=>({id:pack.id,capturedAt:pack.capturedAt,applicationSections:pack.applicationSections,applicationFields:pack.applicationFields,entries:pack.records.length,sources:pack.sources,note:pack.note}),view:()=>pack};
}

export function knowledgeText(value){return value?.records?.length?'\nOPTIONAL REFERENCE EXCERPTS (may be irrelevant; use only what the question needs; replaces earlier excerpts):\n'+JSON.stringify(value.records):'';}
export function confirmedKnowledgeText(value){return value?.records?.filter(r=>r.kind==='fact').map(r=>`${r.title}: ${r.text}`).join('\n\n')||'';}
let pack;
try{pack=createKnowledge(JSON.parse(readFileSync(new URL('./background.json',import.meta.url),'utf8')));}catch{pack={retrieve:()=>({records:[]}),summary:()=>({error:'Your imported background could not load. Reinstall this Cue update; your saved fact sheet is still available.'}),view:()=>({records:[],sources:[],error:'Your imported background could not load.'})};}
export const knowledge=pack;
