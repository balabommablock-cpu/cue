import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderer,tick,channel} from '../test-support/renderer-harness.mjs';
import {turnRoute,explicitQuestion} from '../public/reading.js';
import {accountResponse} from '../public/account-ui.js';
import {apiResponse} from '../public/api-ui.js';
import {formatSuggestion,parseResponse,stripReasoning} from '../public/core.js';
import {turnDecision} from '../public/turn-decision.js';
import {answerMessages} from '../device-src/messages.mjs';

async function fixture(t){
 const streams=[],sent=[];
 const app=await renderer({fetch:(url,init)=>{
  if(url==='/api/answer'){
   const stream=channel();streams.push(stream);sent.push(JSON.parse(init.body));
   stream.send({type:'accepted'});return stream.response;
  }
  if(url==='/api/answer/interrupt'){
   streams.at(-1).close();return Response.json({interrupted:true});
  }
 }});
 t.after(()=>app.close());await app.run('connect()');
 app.run('settings.source="both";raw="ANSWER: The answer I am reading.";render()');
 return {app,streams,sent};
}
const hear=(app,text)=>app.run(`onSpeechText(${JSON.stringify({text,source:'system',final:true})})`);

test('short acknowledgements and comments cannot restart an answer already on screen',async t=>{
 const f=await fixture(t);
 f.app.run('interviewerTurn.accept("What did you build?")');
 for(const text of ['Okay, yes.','Right, got it.','Uh-huh, okay.','That is interesting.',"That's interesting.",'That’s useful.',"I'm listening.",'I’m listening.','Take your time.','I am listening.']){
  hear(f.app,text);await tick();
  assert.equal(f.sent.length,0,text);
  assert.equal(f.app.el('answer').textContent,'The answer I am reading.',text);
 }
});

test('a real follow-up keeps the old answer until the new answer is complete',async t=>{
 const f=await fixture(t);hear(f.app,'Why did you choose that?');await tick();
 assert.equal(f.sent.length,1);
 f.streams[0].send({type:'answer',text:'ANSWER: A half-written follow-up',streaming:true});await tick();
 assert.equal(f.app.el('answer').textContent,'The answer I am reading.');
 f.streams[0].send({type:'answer',text:'ANSWER: A complete, useful follow-up.',streaming:false});
 await tick();assert.equal(f.app.el('answer').textContent,'The answer I am reading.');
 f.streams[0].send({type:'done'});f.streams[0].close();await tick();
 assert.equal(f.app.el('answer').textContent,'A complete, useful follow-up.');
});

test('a failed follow-up never replaces the readable answer with its partial draft',async t=>{
 const f=await fixture(t);hear(f.app,'How would you test it?');await tick();
 f.streams[0].send({type:'answer',text:'ANSWER: Unfinished thought',streaming:true});await tick();
 f.streams[0].error(new Error('Connection lost'));await tick();
 assert.equal(f.app.el('answer').textContent,'The answer I am reading.');
 assert.equal(f.app.el('retryAnswer').hidden,false);
});

test('acknowledgements during a follow-up do not cancel or rewrite its draft',async t=>{
 const f=await fixture(t);hear(f.app,'What was the outcome?');await tick();
 f.streams[0].send({type:'answer',text:'ANSWER: Still drafting',streaming:true});await tick();
 hear(f.app,'Okay, yes.');hear(f.app,'Right, got it.');await tick();
 assert.equal(f.sent.length,1);assert.equal(f.app.run('localJob.superseded'),false);
 assert.equal(f.app.el('answer').textContent,'The answer I am reading.');
 f.streams[0].send({type:'answer',text:'ANSWER: The completed outcome.',streaming:false});
 f.streams[0].send({type:'done'});f.streams[0].close();await tick();
 assert.equal(f.app.el('answer').textContent,'The completed outcome.');
});

test('a completed follow-up waits through Pause and appears on Resume',async t=>{
 const f=await fixture(t);hear(f.app,'How did you test that?');await tick();
 f.app.el('pauseButton').click();
 f.streams[0].send({type:'answer',text:'ANSWER: The complete test result.',streaming:false});
 f.streams[0].send({type:'done'});f.streams[0].close();await tick();
 assert.equal(f.app.el('answer').textContent,'The answer I am reading.');
 assert.ok(f.app.run('readyAnswer'));
 f.app.el('pauseButton').click();await tick();
 assert.equal(f.app.el('answer').textContent,'The complete test result.');
});

test('the first answer still streams immediately',async t=>{
 const f=await fixture(t);f.app.run('resetDisplay()');hear(f.app,'What would you build?');await tick();
 f.streams[0].send({type:'answer',text:'ANSWER: First useful words.',streaming:true});await tick();
 assert.equal(f.app.el('answer').textContent,'First useful words.');
 f.streams[0].send({type:'done'});f.streams[0].close();await tick();
});

test('acknowledgement prefixes do not hide real questions or clarifications',()=>{
 for(const text of ['Yes, but why did you choose that?','Okay, can you explain the risk?','That is interesting. How did you test it?'])
  assert.equal(explicitQuestion(text),true,text);
 for(const text of ['No, I meant the acquisition cost.','Specifically, the team size.','Assume the budget is one lakh.','and the main risk.'])
  assert.equal(turnRoute({text,source:'system',hasAnswer:true}),'answer',text);
 assert.equal(turnRoute({text:'Describe a difficult decision.',source:'mic',hasAnswer:true,dual:true}),'context');
});

test('unclassified speech does not inherit a previous question confirmation',async t=>{
 const f=await fixture(t);f.app.run('interviewerTurn.accept("What did you build?")');
 hear(f.app,'The hardest part of that whole thing.');await tick();
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].autoDetect,true);
 assert.equal(f.sent[0].question,'The hardest part of that whole thing.');
 f.streams[0].send({type:'answer',text:'WAIT: No new question.'});f.streams[0].send({type:'done'});f.streams[0].close();await tick();
 assert.equal(f.app.el('answer').textContent,'The answer I am reading.');
});

test('inline turn checking uses recent conversation without a second model request',()=>{
 const messages=answerMessages({question:'The hardest part.',autoDetect:true,history:[{question:'What did you build?',answer:'ANSWER: I built a prototype.'}]});
 assert.match(messages[0].content,/WAIT: No new question/);
 assert.ok(messages.some(m=>m.role==='assistant'&&/prototype/.test(m.content)));
 assert.doesNotMatch(answerMessages({question:'What is retention?'}).at(0).content,/WAIT: No new question/);
 assert.equal(formatSuggestion('WAIT: This literal text was requested.',false),'ANSWER:\nWAIT: This literal text was requested.');
});

test('ChatGPT, API and device messages keep a numerical what-if follow-up grounded in the previous turn',()=>{
 const messages=answerMessages({question:'What if CAC doubles?',history:[{question:'CAC is 1500 and gross profit is 300 a month.',answer:'ANSWER: Payback is 5 months.'}]});
 assert.ok(messages.some(m=>m.role==='assistant'&&/5 months/.test(m.content)));
 assert.ok(messages.some(m=>m.role==='user'&&/1500/.test(m.content)));
});

for(const provider of ['chatgpt','openai'])test(provider+' preserves WAIT through native streaming instead of displaying it as an answer',async()=>{
 let event;
 const respond=async({id})=>{for(const text of ['W','WA','WAIT:','WAIT: No new question.'])event({id,type:'delta',text});return {ok:true,value:{text:'WAIT: No new question.'}};};
 const native={onAccountAnswer:fn=>(event=fn,()=>{}),accountAnswer:respond,accountInterrupt(){},onApiAnswer:fn=>(event=fn,()=>{}),apiAnswer:respond,apiInterrupt(){}};
 const response=(provider==='chatgpt'?accountResponse:apiResponse)(native,{question:'A background comment.',model:'gpt-6.1-sol',provider:'openai',messages:[],autoDetect:true},new AbortController().signal);
 const events=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.ok(events.filter(e=>e.type==='answer').every(e=>turnDecision(e.text)!=='answer'));
 assert.equal(events.at(-1).type,'done');
});

test('reasoning blocks, including split opening tags, never enter the answer',()=>{
 for(const text of ['<','<th','<think>private planning','<analysis>private planning']){
  assert.equal(stripReasoning(text),'');assert.equal(formatSuggestion(text),'');
 }
 const response='<analysis>private planning</analysis>\nThe useful answer.';
 assert.equal(formatSuggestion(response),'ANSWER:\nThe useful answer.');
 assert.equal(parseResponse('ANSWER:\n'+response).answer,'The useful answer.');
 assert.equal(parseResponse('ANSWER:\n{"analysis":"requested data"}').answer,'{"analysis":"requested data"}');
});

test('the live reading area contains no thinking or waiting commentary',async t=>{
 const f=await fixture(t);f.app.run('resetDisplay()');hear(f.app,'What should I prioritise?');await tick();
 assert.equal(f.app.el('welcome').hidden,true);
 await f.app.advance(12000);
 assert.doesNotMatch(f.app.el('notice').textContent,/Still working|Thinking|preparing/i);
 f.streams[0].send({type:'answer',text:'ANSWER: Prioritise the user need.',streaming:true});
 f.streams[0].send({type:'done'});f.streams[0].close();await tick();
 assert.equal(f.app.el('answer').textContent,'Prioritise the user need.');
});
