import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completedOpening} from '../public/core.js';
import {renderer,channel,tick} from '../test-support/renderer-harness.mjs';
const opening='Protect cash first; stop buying unprofitable growth.';
async function setup(t){const s=channel();const a=await renderer({fetch:url=>url==='/api/answer'?s.response:undefined});t.after(()=>a.close());await a.run('connect()');a.run('raw="ANSWER: The previous readable answer.";render()');const flight=a.run('localAnswer({question:"What changes with three weeks of cash?",autoDetect:false,showImmediately:true,waitForComplete:true,fastOpening:true})');await tick();return {a,s,flight};}
test('tokens, reasoning, decimals and unfinished openings do not count as ready',()=>{
 for(const x of ['ANSWER: Protect cash','ANSWER: The margin is 12.','ANSWER: <think>private</think>','ANSWER: This is how I','ANSWER: {"value":3}\n'])assert.equal(completedOpening(x),'');
 assert.equal(completedOpening('ANSWER: '+opening+'\n- Cash:'),opening);
});
test('a complete opening switches once and subsequent finished cue lines only append',async t=>{
 const {a,s,flight}=await setup(t);s.send({type:'answer',text:'ANSWER: Protect cash first;',streaming:true});await tick();assert.equal(a.el('answer').textContent,'The previous readable answer.');
 s.send({type:'answer',text:'ANSWER: '+opening+'\n- Cash: Collect receiv',streaming:true});await tick();assert.equal(a.el('answer').textContent,opening);
 s.send({type:'answer',text:'ANSWER: '+opening+'\n- Cash: Collect receivables now.\n- Spend: Stop',streaming:true});await tick();assert.equal(a.el('answer').textContent,opening+'\n- Cash: Collect receivables now.');
 s.send({type:'answer',text:'ANSWER: '+opening+'\n- Cash: Collect receivables now.\n- Spend: Stop speculative campaigns.',streaming:false});s.send({type:'done'});s.close();await flight;assert.match(a.el('answer').textContent,/Stop speculative campaigns/);
});
test('a provider rewriting the committed opening restores the previous card and reports failure',async t=>{
 const {a,s,flight}=await setup(t);s.send({type:'answer',text:'ANSWER: '+opening+'\n- Cash:',streaming:true});await tick();
 s.send({type:'answer',text:'ANSWER: Reverse everything and spend all cash.',streaming:false});s.send({type:'done'});s.close();await flight;assert.equal(a.el('answer').textContent,'The previous readable answer.');assert.equal(a.el('retryAnswer').hidden,false);assert.match(a.el('notice').textContent,/changed its opening/);
});
test('interviewer speech, Pause and editing keep the old card until a complete response can be shown',async t=>{
 const {a,s,flight}=await setup(t);a.run('segmenters=[{source:"system",active:true,reset(){}}]');s.send({type:'answer',text:'ANSWER: '+opening+'\n- Cash:',streaming:true});await tick();assert.equal(a.el('answer').textContent,'The previous readable answer.');
 a.run('segmenters[0].active=false;paused=true');s.send({type:'answer',text:'ANSWER: '+opening+'\n- Cash: Collect receivables.',streaming:false});s.send({type:'done'});s.close();await flight;assert.equal(a.el('answer').textContent,'The previous readable answer.');a.run('paused=false;maybePresentReady()');assert.match(a.el('answer').textContent,/Collect receivables/);
});
