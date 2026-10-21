import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InterviewTurn} from '../public/question-joiner.js';
import {PendingTurns} from '../public/pending-turns.js';
import {instructions} from '../prompt.mjs';
import {renderer,tick,channel} from '../test-support/renderer-harness.mjs';

test('pauses between three requests retain every part until the candidate answers',()=>{
 const b=new InterviewTurn();
 b.accept('Walk me through the trade-offs.',{at:1000});
 b.accept('Give me one concrete experiment.',{at:5000});
 const all=b.accept('and the risk you are willing to take.',{at:10000});
 assert.equal(all.parts,3);assert.equal(all.confirmed,true);
 assert.equal(all.question,'Walk me through the trade-offs.\nGive me one concrete experiment.\nand the risk you are willing to take.');
 b.replied('I would keep the experiment small.',{at:12000});
 assert.equal(b.accept('Why that metric?',{at:15000}).question,'Why that metric?');
});
test('noise, echoes and delayed microphone finals cannot split the interviewer turn',()=>{
 const b=new InterviewTurn();b.accept('Give me one concrete experiment.',{at:1000});
 b.replied('Give me one concrete experiment.',{at:1100});b.replied('!',{at:1200});b.replied('I answered the previous question.',{at:900});
 assert.equal(b.accept('and its main risk.',{at:2000}).parts,2);
 assert.equal(b.accept('and its main risk!',{at:2100}),null);
});
test('queued expansions replace their own earlier version without duplicating or losing parts',()=>{
 const q=new PendingTurns();q.push({question:'A?',batchId:1});q.push({question:'A?\nB?',batchId:1});q.push({question:'A?\nB?\nC?',batchId:1});
 assert.equal(q.length,1);assert.equal(q.take().question,'A?\nB?\nC?');
});

test('three heard parts while generating reach the final request together and bypass microphone noise and scroll hold',async t=>{
 const streams=[],sent=[];let release;
 const gate=new Promise(r=>release=r);
 const a=await renderer({fetch:async(url,init)=>{
  if(url==='/api/answer'){const s=channel();streams.push(s);sent.push(JSON.parse(init.body));s.send({type:'accepted'});return s.response;}
  if(url==='/api/answer/interrupt'){await gate;streams[0].close();return Response.json({interrupted:true});}
 }});t.after(()=>a.close());await a.run('connect()');a.run('settings.source="both";raw="ANSWER: Old answer.";render();reader.hold();candidateSpeaking=true');
 a.run('onSpeechText({text:"Walk me through the trade-offs.",source:"system",final:true})');await tick();
 a.run('onSpeechText({text:"Give me one concrete experiment.",source:"system",final:true});onSpeechText({text:"and the risk you are willing to take.",source:"system",final:true})');await tick();
 release();await tick();assert.equal(sent.length,2);
 assert.match(sent[1].question,/trade-offs/);assert.match(sent[1].question,/concrete experiment/);assert.match(sent[1].question,/risk/);assert.equal(sent[1].autoDetect,false);
 streams[1].send({type:'answer',text:'ANSWER: Trade-off: speed versus confidence.\nExperiment: one small test.\nRisk: a misleading early signal.'});streams[1].send({type:'done'});streams[1].close();await tick();
 assert.match(a.el('answer').textContent,/Trade-off/);assert.match(a.el('answer').textContent,/Experiment/);assert.match(a.el('answer').textContent,/Risk/);
 assert.equal(a.run('readyAnswer'),null);assert.equal(a.run('localBusy'),false);assert.equal(a.run('reader.held'),false);
 assert.equal(a.requests.filter(r=>r.url==='/api/coach/live').length,0);
});

test('completed drafts do not mean the candidate answered; trailing clauses still expand the complete prompt',async t=>{
 const sent=[];const a=await renderer({fetch:(url,init)=>{if(url!=='/api/answer')return;sent.push(JSON.parse(init.body));return new Response('{"type":"answer","text":"ANSWER: Compact answer."}\n{"type":"done"}\n');}});t.after(()=>a.close());await a.run('connect()');a.run('settings.source="both"');
 for(const text of ['What would you test?','Explain your trade-off.','and the risk you would accept.']){a.run(`onSpeechText({text:${JSON.stringify(text)},source:'system',final:true})`);await tick();}
 assert.equal(sent.length,3);assert.match(sent[2].question,/What would you test/);assert.match(sent[2].question,/trade-off/);assert.match(sent[2].question,/risk/);
 a.run('onSpeechText({text:"I would test a smaller onboarding flow.",source:"mic",final:true});onSpeechText({text:"Why that customer?",source:"system",final:true})');await tick();
 assert.equal(sent[3].question,'Why that customer?');assert.match(JSON.stringify(sent[3].history),/smaller onboarding/);
});

test('quiet layout migrates coach off once, then respects explicitly enabling it',async t=>{
 const first=await renderer({prefs:{coachEnabled:true}});t.after(()=>first.close());assert.equal(first.run('coach.enabled'),false);assert.equal(first.el('coachEnabled').checked,false);
 const enabled=await renderer({prefs:{quietLayoutV1:true,coachEnabled:true}});t.after(()=>enabled.close());assert.equal(enabled.run('coach.enabled'),true);
});
test('a wheel hold expires without requiring an exact spoken match or manual resume',async t=>{
 const a=await renderer();t.after(()=>a.close());a.el('answerFrame').events.wheel();assert.equal(a.run('reader.held'),true);await a.advance(5000);assert.equal(a.run('reader.held'),false);assert.equal(a.el('resumeFollow').hidden,true);
});
test('interview rules require compact coverage of every requested part',()=>{
 const p=instructions('Synthetic facts','script',{textInput:true});assert.match(p,/EVERY requested part/);assert.match(p,/45–70 words/);assert.match(p,/up to 100 words/);
});

test('late microphone audio overlapping the bot cannot split a multipart computer question',async t=>{
 const sent=[];const a=await renderer({fetch:(url,init)=>{if(url!=='/api/answer')return;sent.push(JSON.parse(init.body));return new Response('{"type":"answer","text":"ANSWER: A useful response."}\n{"type":"done"}\n');}});t.after(()=>a.close());await a.run('connect()');a.run('settings.source="both"');
 a.run('onSpeechText({text:"You have 48 hours to improve a consumer app. Walk me through the trade-offs.",source:"system",final:true})');await tick();
 // A different ASR rendering defeats exact transcript equality; capture timing
 // still establishes that this mic audio overlapped the computer's voice.
 a.run('onSpeechText({text:"You have forty eight hours. Walk through the trade offs.",source:"mic",final:true,overlappedSystem:true})');
 a.run('onSpeechText({text:"Give me one experiment.",source:"system",final:true})');await tick();
 a.run('onSpeechText({text:"and the risk you would accept.",source:"system",final:true})');await tick();
 assert.match(sent.at(-1).question,/48 hours/);assert.match(sent.at(-1).question,/one experiment/);assert.match(sent.at(-1).question,/risk/);
 assert.ok(!sent.at(-1).history.some(x=>/forty eight/.test(x.question)));
 a.run('onSpeechText({text:"I would test the onboarding flow.",source:"mic",final:true,overlappedSystem:false});onSpeechText({text:"What metric?",source:"system",final:true})');await tick();
 assert.equal(sent.at(-1).question,'What metric?');
});
