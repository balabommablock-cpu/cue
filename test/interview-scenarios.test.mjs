import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderer,channel,tick} from '../test-support/renderer-harness.mjs';

async function setup(t){
 const streams=[],questions=[];
 const a=await renderer({fetch:(url,init)=>{
  if(url==='/api/answer'){const stream=channel();streams.push(stream);questions.push(JSON.parse(init.body));stream.send({type:'accepted'});return stream.response;}
  if(url==='/api/answer/interrupt'){streams.at(-1).close();return Response.json({interrupted:true});}
 }});
 t.after(()=>a.close());await a.run('connect()');
 a.run('settings.source="both";raw="ANSWER: Keep the complete answer visible.";render()');
 return {a,streams,questions};
}
const hear=(a,text,source='system')=>a.run(`onSpeechText(${JSON.stringify({text,source,final:true})})`);
const finish=async(stream,text)=>{stream.send({type:'answer',text:'ANSWER: '+text,streaming:false});stream.send({type:'done'});stream.close();await tick();};

test('a typed follow-up has the same complete-answer switch as a spoken follow-up',async t=>{
 const {a,streams}=await setup(t);
 a.el('typedQuestion').value='Why not compromise?';await a.el('typedForm').onsubmit({preventDefault(){}});await tick();
 streams[0].send({type:'answer',text:'ANSWER: A partial',streaming:true});await tick();
 assert.equal(a.el('answer').textContent,'Keep the complete answer visible.');
 await finish(streams[0],'Compromise on scope, but protect the core user promise.');
 assert.equal(a.el('answer').textContent,'Compromise on scope, but protect the core user promise.');
});

test('an interviewer rephrasing a question never exposes an unfinished replacement',async t=>{
 const {a,streams}=await setup(t);hear(a,'Actually, forget that question. What would you do with half the budget?');await tick();
 streams[0].send({type:'answer',text:'ANSWER: Half the',streaming:true});await tick();
 assert.equal(a.el('answer').textContent,'Keep the complete answer visible.');
 await finish(streams[0],'Test one customer problem with a smaller release.');
 assert.equal(a.el('answer').textContent,'Test one customer problem with a smaller release.');
});

test('a sharper challenge supersedes a draft while acknowledgements and candidate speech do not',async t=>{
 const {a,streams,questions}=await setup(t);hear(a,'What would you build first?');await tick();
 streams[0].send({type:'answer',text:'ANSWER: Old unfinished draft',streaming:true});await tick();
 hear(a,"That's useful.");hear(a,'I would narrow the first release.','mic');await tick();
 assert.equal(questions.length,1);
 hear(a,'But what if the customer will not pay?');await tick();
 assert.equal(questions.length,2);assert.match(questions[1].question,/will not pay/);
 streams[1].send({type:'answer',text:'ANSWER: Demand',streaming:true});await tick();
 assert.equal(a.el('answer').textContent,'Keep the complete answer visible.');
 await finish(streams[1],'Test willingness to pay before committing the full build.');
 assert.equal(a.el('answer').textContent,'Test willingness to pay before committing the full build.');
});

test('Stop during a replacement leaves the completed answer and rejects late text',async t=>{
 const {a,streams}=await setup(t);hear(a,'What is the main risk?');await tick();a.run('stop()');
 streams[0].send({type:'answer',text:'ANSWER: Late network response',streaming:false});streams[0].send({type:'done'});streams[0].close();await tick();
 assert.equal(a.el('answer').textContent,'Keep the complete answer visible.');assert.equal(a.run('connected'),false);
});

test('a provider timeout keeps the answer and offers an explicit retry',async t=>{
 const {a,streams}=await setup(t);hear(a,'How would you measure success?');await tick();
 streams[0].send({type:'answer',text:'ANSWER: Incomplete measurement',streaming:true});await tick();
 await a.advance(30000);streams[0].error(new DOMException('Stopped','AbortError'));await tick();
 assert.equal(a.el('answer').textContent,'Keep the complete answer visible.');
 assert.equal(a.el('retryAnswer').hidden,false);assert.match(a.el('notice').textContent,/timed out/);
});

test('real provider selection metadata cannot discard a completed interview answer',async t=>{
 const {a,streams}=await setup(t);hear(a,'Which risk matters most?');await tick();
 streams[0].send({type:'answer',text:'ANSWER: Test whether customers will pay.',streaming:false});
 streams[0].send({type:'timing',selection:{model:'gpt-6.1-sol',serviceTier:'priority',effort:'low'},phases:{readyMs:0,readyWaitMs:1,turnStartedMs:12,firstDeltaMs:1800,totalMs:2800}});
 streams[0].send({type:'done'});streams[0].close();await tick();
 assert.equal(a.el('answer').textContent,'Test whether customers will pay.');
 assert.equal(a.el('retryAnswer').hidden,true);
});
