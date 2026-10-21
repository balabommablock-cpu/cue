import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sharedMicIntent} from '../public/reading.js';
import {renderer,tick,channel} from '../test-support/renderer-harness.mjs';

for(const text of ['Tell me about yourself.','Okay, so tell me about a difficult decision.','What do you want from Example Program?','Walk me through the trade-offs.','Give me one concrete experiment.','How did you keep the team moving?','Why not?','What went wrong?','Can you explain your role?','Anything else?'])test('room interviewer request: '+text,()=>assert.equal(sharedMicIntent(text),'question'));
for(const text of ['I built the first version with one developer.','What I did was break the work into smaller tasks.','Why I chose that option was the cost.','We reduced the scope after the first test.','My role was to get the first product out.','The result was a smaller but usable product.','I’m still exploring which consumer problem to pursue.','I asked the team, "why did you choose that?"'])test('room candidate response stays context: '+text,()=>assert.equal(sharedMicIntent(text),'candidate'));
for(const text of ["I'd like to hear more about your launch.","I'm curious about the decision you made.",'You mentioned that project. The hardest part?','I heard your answer. What would you change?'])test('ambiguous shared speech goes to intent check: '+text,()=>assert.equal(sharedMicIntent(text),'unknown'));
test('trailing requests join an open interviewer turn but candidate clauses do not',()=>{
 assert.equal(sharedMicIntent('and the risk you would accept.',{turnOpen:true}),'question');
 assert.equal(sharedMicIntent('and we tested that first.',{turnOpen:true}),'candidate');
 assert.equal(sharedMicIntent('and the risk you would accept.',{turnOpen:false}),'unknown');
});
test('an interviewer challenge is not mistaken for reading matching answer words',()=>{
 assert.equal(sharedMicIntent('Why did you choose a smaller first version?',{answer:'I would choose a smaller first version to test demand.'}),'question');
 assert.equal(sharedMicIntent('A smaller first version lets us test demand.',{answer:'A smaller first version lets us test demand.'}),'candidate');
});

function speech(a,text,extra={}){a.run(`onSpeechText(${JSON.stringify({text,source:'shared',final:true,...extra})})`);}
async function running(t,fetch){const a=await renderer({fetch});t.after(()=>a.close());await a.run('connect()');a.run('settings.source="mic"');return a;}
const response=()=>new Response('{"type":"answer","text":"ANSWER: I broke the work into small tasks and built the first version."}\n{"type":"done"}\n');

test('phone question generates automatically, own answer stays intact, follow-up starts a fresh turn',async t=>{
 const sent=[];const a=await running(t,(url,init)=>{if(url==='/api/answer'){sent.push(JSON.parse(init.body));return response();}});
 speech(a,'Tell me about a time you built with a small team.');await tick();assert.equal(sent.length,1);assert.equal(sent[0].inputSource,'shared');
 const answer=a.el('answer').textContent;
 speech(a,'I broke the work into small tasks and built the first version.');await tick();assert.equal(sent.length,1);assert.equal(a.el('answer').textContent,answer);assert.ok(a.run('reader.cursor')>0);
 speech(a,'Why did you choose that approach?');await tick();assert.equal(sent.length,2);assert.equal(sent[1].question,'Why did you choose that approach?');assert.equal(a.run('readyAnswer'),null);
 assert.match(JSON.stringify(sent[1].history),/Candidate response/);
});
test('all three phone question parts survive pauses and a completed draft',async t=>{
 const sent=[];const a=await running(t,(url,init)=>{if(url==='/api/answer'){sent.push(JSON.parse(init.body));return response();}});
 for(const text of ['Walk me through the trade-offs.','Give me one concrete experiment.','and the risk you would accept.']){speech(a,text);await tick();}
 assert.equal(sent.length,3);assert.match(sent[2].question,/trade-offs/);assert.match(sent[2].question,/experiment/);assert.match(sent[2].question,/risk/);assert.equal(a.run('interviewerTurn.parts.length'),3);
});
test('phone follow-ups interrupt a slow draft and retain every requested part',async t=>{
 const sent=[],streams=[];let release;const gate=new Promise(r=>release=r);
 const a=await running(t,async(url,init)=>{
  if(url==='/api/answer'){const s=channel();streams.push(s);sent.push(JSON.parse(init.body));s.send({type:'accepted'});return s.response;}
  if(url==='/api/answer/interrupt'){await gate;streams[0].close();return Response.json({interrupted:true});}
 });
 a.run('raw="ANSWER: Old answer.";render();reader.hold();');
 speech(a,'Walk me through the trade-offs.');await tick();speech(a,'Give me one experiment.');speech(a,'and the main risk.');await tick();release();await tick();
 assert.equal(sent.length,2);assert.match(sent[1].question,/trade-offs/);assert.match(sent[1].question,/experiment/);assert.match(sent[1].question,/main risk/);
 streams[1].send({type:'answer',text:'ANSWER: Trade-off. Experiment. Main risk.'});streams[1].send({type:'done'});streams[1].close();await tick();assert.equal(a.el('answer').textContent,'Trade-off. Experiment. Main risk.');assert.equal(a.run('readyAnswer'),null);
});
test('phone questions never feed coaching or advance reading before the candidate speaks',async t=>{
 const a=await running(t,url=>url==='/api/answer'?response():undefined);a.run('raw="ANSWER: Why did you choose a smaller first version?";render();coach.hear=()=>{throw new Error("Interviewer fed to coaching")};');
 speech(a,'Why did you choose a smaller first version?',{final:false});assert.equal(a.run('reader.cursor'),0);
 speech(a,'Why did you choose a smaller first version?');await tick();assert.match(a.el('answer').textContent,/small tasks/);
});
test('unknown room speech is checked by the model and WAIT preserves the current answer',async t=>{
 let sent;const a=await running(t,(url,init)=>{if(url==='/api/answer'){sent=JSON.parse(init.body);return new Response('{"type":"answer","text":"WAIT: No new question."}\n{"type":"done"}\n');}});
 a.run('raw="ANSWER: Keep this answer visible.";render();$("question").textContent="The last real question?"');speech(a,'The hardest part of that whole thing.');await tick();
 assert.equal(sent.inputSource,'shared');assert.equal(sent.autoDetect,true);assert.equal(a.el('answer').textContent,'Keep this answer visible.');
 assert.equal(a.el('question').textContent,'The last real question?');
});
test('legacy mic selection also uses shared routing instead of candidate-only handling',async t=>{
 const sent=[];const a=await running(t,(url,init)=>{if(url==='/api/answer'){sent.push(JSON.parse(init.body));return response();}});
 speech(a,'What do you want to build?',{source:'mic'});await tick();assert.equal(sent[0].inputSource,'shared');
});
test('switching the visible setup persists room mode, while typed fallback restores it',async t=>{
 const a=await renderer({prefs:{source:'both'},fetch:url=>url==='/api/answer'?response():undefined});t.after(()=>a.close());
 a.el('quickAudio').value='mic';a.el('quickAudio').onchange();assert.equal(a.run('read("source")'),'mic');assert.equal(a.el('audioSource').value,'mic');assert.equal(a.el('roomHint').hidden,false);
 a.el('typedQuestion').value='Why this team?';await a.el('typedForm').onsubmit({preventDefault(){}});await tick();a.run('stop()');assert.equal(a.run('settings.source'),'mic');
});
test('a new shared speech segment is not reset as old candidate readback when a draft appears',async t=>{
 const a=await running(t);a.run('segmenters=[{source:"shared",active:true,reset(){throw new Error("Dropped next phone question")}}];resetReading()');
 a.run('segmenters=[]');
});
test('general task requests interrupt an existing answer instead of being treated as readback',async t=>{
 const sent=[];const a=await running(t,(url,init)=>{if(url==='/api/answer'){sent.push(JSON.parse(init.body));return response();}});
 a.run('raw="ANSWER: Translate the sentence carefully.";render();candidateSpeaking=true;');
 for(const text of ['Please translate this sentence into Hindi.','Calculate seventeen times twenty four.','Write a Python function.']){
  assert.equal(sharedMicIntent(text,{answer:'Translate the sentence carefully.'}),'question');speech(a,text);await tick();
 }
 assert.equal(sent.length,3);assert.ok(sent.every(x=>x.autoDetect===false));assert.match(sent.at(-1).question,/Write a Python function/);
 for(const text of ['I wrote a Python function.','We calculated the result.','My answer is forty two.'])assert.equal(sharedMicIntent(text),'candidate');
});
