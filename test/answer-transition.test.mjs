import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderer,channel,tick} from '../test-support/renderer-harness.mjs';

test('new question and old answer are never presented as one pair, including repeated question events',async t=>{
 const s=channel(),a=await renderer({fetch:url=>url==='/api/answer'?s.response:undefined});t.after(()=>a.close());await a.run('connect()');
 a.run('raw="ANSWER: I would give leaders an update.";render();$("question").textContent="How would you update leadership?"');
 const task=a.run('localAnswer({question:"How would you handle a risky design?",showImmediately:true})');await tick();
 s.send({type:'question',text:'How would you handle a risky design?'});await tick();
 assert.equal(a.el('question').textContent,'How would you update leadership?');assert.equal(a.el('questionLabel').textContent,'PREVIOUS ANSWER');
 assert.equal(a.el('incomingQuestion').textContent,'How would you handle a risky design?');assert.equal(a.el('incomingQuestionBlock').hidden,false);
 assert.equal(a.el('correctQuestion').hidden,true);a.el('correctIncomingQuestion').click();assert.equal(a.el('typedQuestion').value,'How would you handle a risky design?');a.el('cancelQuestionEdit').click();
 s.send({type:'answer',text:'ANSWER: I would first understand the risk.',streaming:true});await tick();
 assert.equal(a.el('question').textContent,'How would you handle a risky design?');assert.equal(a.el('answer').textContent,'I would first understand the risk.');assert.equal(a.el('incomingQuestionBlock').hidden,true);
 s.send({type:'done'});s.close();await task;
});
test('WAIT and Stop remove the pending question without relabelling the visible answer',async t=>{
 const s=channel(),a=await renderer({fetch:url=>url==='/api/answer'?s.response:undefined});t.after(()=>a.close());await a.run('connect()');
 a.run('raw="ANSWER: Keep reading this.";render();$("question").textContent="Original question?"');const task=a.run('localAnswer({question:"Thanks.",autoDetect:true})');await tick();
 s.send({type:'answer',text:'WAIT: Acknowledgement.'});s.send({type:'done'});s.close();await task;
 assert.equal(a.el('question').textContent,'Original question?');assert.equal(a.el('incomingQuestionBlock').hidden,true);
 a.run('showIncomingQuestion("Next question?");stop()');assert.equal(a.el('incomingQuestionBlock').hidden,true);assert.equal(a.el('question').textContent,'Original question?');
});
test('an automatic expanded question does not flash an older answer during cancellation',async t=>{
 const streams=[],sent=[];let release;const gate=new Promise(r=>release=r);
 const a=await renderer({fetch:async(url,init)=>{
  if(url==='/api/answer'){const s=channel();streams.push(s);sent.push(JSON.parse(init.body));s.send({type:'accepted'});return s.response;}
  if(url==='/api/answer/interrupt'){await gate;streams[0].close();return Response.json({interrupted:true});}
 }});t.after(()=>a.close());await a.run('connect()');
 a.run('settings.source="both";raw="ANSWER: Much older answer.";render();$("question").textContent="Older question?";onSpeechText({text:"What would you test?",source:"system",final:true})');await tick();
 streams[0].send({type:'answer',text:'ANSWER: I would test demand first.',streaming:true});await tick();
 a.run('onSpeechText({text:"and which risk would you accept?",source:"system",final:true})');await tick();
 assert.equal(a.el('answer').textContent,'I would test demand first.');assert.equal(a.el('question').textContent,'What would you test?');
 release();await tick();assert.equal(a.el('answer').textContent,'I would test demand first.');assert.match(a.el('incomingQuestion').textContent,/risk/);
 streams[1].send({type:'answer',text:'ANSWER: Test demand. Accept a small sample risk.'});streams[1].send({type:'done'});streams[1].close();await tick();assert.equal(a.el('incomingQuestionBlock').hidden,true);
});
