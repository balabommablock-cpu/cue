import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderer,tick,channel} from '../test-support/renderer-harness.mjs';
import {cleanStory,SpeechLedger,validateCoach} from '../public/story-core.js';
import {LiveCoach} from '../public/coach-ui.js';
import {parseResponse} from '../public/core.js';

const story=(id='one')=>cleanStory({id,status:'confirmed',title:'A real experience',situation:'A customer was blocked.',decision:'Reduce the scope.',action:'I changed the workflow.',outcome:'We released it.',tags:[]});
const map=nudge=>({steps:['Context','Decision','Outcome'].map(label=>({label,covered:false,evidence:''})),nudge,checks:[],storyId:'',offTopic:false});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('a real-provider inline CHECK never leaks into the spoken answer',()=>{const r=parseResponse('ANSWER: We released two workflows. CHECK: Confirm which features were cut.');assert.equal(r.answer,'We released two workflows.');assert.equal(r.check,'Confirm which features were cut.');});
test('streaming an inline CHECK label keeps the visible answer stable',()=>{for(const suffix of ['C','CH','CHE','CHEC','CHECK','CHECK:','CHECK: Missing metric.'])assert.equal(parseResponse('ANSWER: We shipped. '+suffix).answer,'We shipped.');});

test('disk full cannot promote an unsaved story into live interview facts',async t=>{
 const a=await renderer();t.after(()=>a.close());a.run('studio.storage={setItem(){throw Error("disk full")}}');
 a.el('story_title').value='Unsaved achievement';a.el('story_situation').value='A real situation';a.el('story_action').value='My action';a.el('confirmStory').checked=true;a.run('studio.saveStory()');
 assert.equal(a.run('studio.stories.length'),0);assert.doesNotMatch(a.run('effectiveProfile()'),/Unsaved achievement/);assert.equal(a.el('story_title').value,'Unsaved achievement');assert.match(a.el('storySaveMessage').textContent,/Could not save/);
});
test('failed deletion preserves the original saved story',async t=>{
 const a=await renderer({prefs:{stories:[story()]}});t.after(()=>a.close());a.run('studio.edit(studio.stories[0]);studio.storage={setItem(){throw Error("disk full")}};studio.remove()');assert.equal(a.run('studio.stories.length'),1);
});
test('one malformed saved entry does not hide the rest of the library',async t=>{
 const a=await renderer({prefs:{stories:[null,story()]}});t.after(()=>a.close());assert.equal(a.run('studio.stories.length'),1);assert.equal(a.run('studio.stories[0].id'),'one');
});
test('failed fresh practice request retains the existing answer and follow-up',async t=>{
 const a=await renderer({fetch:url=>url==='/api/coach/practice'?Response.json({error:'Offline'},{status:503}):undefined});t.after(()=>a.close());a.run('studio.question="Original?";studio.nextQuestion="Follow-up?"');a.el('practiceQuestion').textContent='Original?';a.el('practiceAnswer').value='My unrehearsed answer';await a.run('studio.practice(true)');
 assert.equal(a.el('practiceAnswer').value,'My unrehearsed answer');assert.equal(a.run('studio.question'),'Original?');assert.equal(a.run('studio.nextQuestion'),'Follow-up?');
});
test('practice answer is protected while feedback is in flight and becomes editable afterward',async t=>{
 const d=deferred();const a=await renderer({fetch:url=>url==='/api/coach/practice'?d.promise:undefined});t.after(()=>a.close());a.run('studio.question="Why?"');a.el('practiceAnswer').value='The customer needed it.';const pending=a.run('studio.practice(false)');await tick();assert.equal(a.el('practiceAnswer').readOnly,true);assert.equal(a.el('recordPractice').disabled,true);
 d.resolve(Response.json({question:'What changed?',feedback:[],nextFocus:'Be specific.'}));await pending;assert.equal(a.el('practiceAnswer').readOnly,false);
});
test('editing a reviewed answer invalidates its old feedback and follow-up',async t=>{
 const a=await renderer({fetch:url=>url==='/api/coach/practice'?Response.json({question:'Follow-up?',feedback:[],nextFocus:'Be specific.'}):undefined});t.after(()=>a.close());a.run('studio.question="Why?"');a.el('practiceAnswer').value='Old answer.';await a.run('studio.practice(false)');a.el('practiceAnswer').value='A different decision.';a.el('practiceAnswer').oninput?.();assert.equal(a.el('practiceNext').hidden,true);assert.equal(a.el('practiceReview').disabled,false);assert.equal(a.run('studio.nextQuestion'),'');
});
test('closing practice ignores its late response and releases input locks',async t=>{
 const d=deferred();const a=await renderer({fetch:url=>url==='/api/coach/practice'?d.promise:undefined});t.after(()=>a.close());a.run('studio.question="Why?"');a.el('practiceAnswer').value='My answer';const pending=a.run('studio.practice(false)');await tick();a.run('studio.close()');d.resolve(Response.json({question:'Late?',feedback:[],nextFocus:'Late'}));await pending;assert.notEqual(a.run('studio.nextQuestion'),'Late?');assert.equal(a.el('practiceAnswer').readOnly,false);
});
test('voice-follow finals retain what the candidate actually said for follow-up context',async t=>{
 const a=await renderer();t.after(()=>a.close());a.run('settings.source="both";raw="ANSWER: I chose the smaller launch and talked to customers myself.";render();onSpeechText({text:"I chose the smaller launch and talked to customers myself.",source:"mic",final:true,utteranceId:1})');
 assert.match(a.run('JSON.stringify(localHistory)'),/talked to customers myself/);assert.match(a.run('JSON.stringify(localHistory)'),/Candidate response/);
});
test('a failed new answer restores the coach belonging to the visible previous answer',async t=>{
 const s=channel();const a=await renderer({fetch:url=>url==='/api/answer'?s.response:url==='/api/coach/live'?Response.json(map('New map')):undefined});t.after(()=>a.close());await a.run('connect()');a.run('raw="ANSWER: Original answer.";render();$("question").textContent="Original?";coach.toggle(true);coach.begin("Original?")');await tick();const p=a.run('localAnswer({question:"Next?"})');await tick();s.send({type:'answer',text:'ANSWER: Incomplete',streaming:true});s.close();await p;assert.equal(a.el('question').textContent,'Original?');assert.equal(a.run('coach.question'),'Original?');
});
test('returning to an old answer after Stop cannot restart live coaching',async t=>{
 const a=await renderer();t.after(()=>a.close());a.run('raw="ANSWER: Original.";render();coach.question="Original?";bookmarkAnswer();stop()');await a.run('returnToAnswer()');assert.equal(a.run('connected'),false);assert.equal(a.run('coach.running'),false);
});
test('blank labels and malformed model steps never create a misleading answer map',()=>{
 for(const steps of [[null,{},{}],[{label:'',covered:false},{label:'Decision'},{label:'Outcome'}]])assert.throws(()=>validateCoach({...map('Keep talking'),steps},{profile:'',stories:[],said:''}),/unreadable/);
});
test('late failures from superseded coaching cannot replace the new map',async()=>{
 const a=deferred(),b=deferred(),frames=[];let n=0;const c=new LiveCoach({getFacts:()=>({profile:'',stories:[]}),render:s=>frames.push(s),request:()=>++n===1?a.promise:b.promise});c.begin('Original?');c.begin('Challenge?');b.resolve(map('Explain why.'));await tick();a.reject(Error('Old timeout'));await tick();assert.equal(c.map.nudge,'Explain why.');assert.doesNotMatch(frames.at(-1).status,/Old timeout/);c.stop();
});
test('acknowledgements and common silent-audio hallucinations do not become off-topic coaching evidence',async()=>{
 let calls=0;const c=new LiveCoach({getFacts:()=>({profile:'',stories:[]}),render(){},request:async()=>{calls++;return map('Explain your decision.');}});c.begin('What did you build?');await tick();for(const text of ['Thank you.','Okay.','Thanks a lot.','Bye.'])c.hear({text,final:true});assert.equal(c.ledger.text(),'');assert.equal(calls,1);c.stop();
});
test('seeded speech disorder soak: 1000 utterances cannot corrupt finals or grow unbounded',()=>{
 const l=new SpeechLedger();let seed=7319;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
 for(let i=0;i<1000;i++){l.add({utteranceId:i,revision:1,text:'Partial answer'});l.add({utteranceId:i,revision:3,text:`Final decision ${i}`,final:true});for(let j=0;j<Math.floor(random()*6);j++)l.add({utteranceId:i,revision:2,text:'Stale invented outcome'});assert.equal(l.turns.get(i).text,`Final decision ${i}`);assert.ok(l.turns.size<=40);}assert.doesNotMatch(l.text(),/Stale invented/);
});
test('50 faulted interview cycles recover without growing history, keeping stale text, or retaining busy jobs',async t=>{
 let n=0;const a=await renderer({fetch:url=>{if(url==='/api/coach/live')return Response.json(map('Name your decision.'));if(url==='/api/answer'){n++;if(n%5===0)return Response.json({error:'Simulated connection loss'},{status:503});return new Response(JSON.stringify({type:'answer',text:'ANSWER: Valid turn '+n})+'\n{"type":"done"}\n');}}});t.after(()=>a.close());
 for(let i=0;i<50;i++){await a.run('connect()');await a.run(`localAnswer({question:'Example Program question ${i}: what did you personally decide?'})`);assert.equal(a.run('localBusy'),false);assert.ok(a.run('localHistory.length')<=6);assert.ok(a.run('answerArchive.length')<=12);a.run('stop()');assert.equal(a.run('coach.running'),false);assert.equal(a.run('connected'),false);}
});
