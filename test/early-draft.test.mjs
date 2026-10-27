import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderer,channel,tick} from '../test-support/renderer-harness.mjs';
import {SpeechPipeline} from '../public/speech-pipeline.js';
import {ConversationLedger} from '../public/conversation.js';
const question='How would you protect cash while testing retention?';
async function setup(t){
 const streams=[],sent=[];
 const a=await renderer({fetch:(url,init)=>{
  if(url==='/api/answer'){const s=channel();streams.push(s);sent.push(JSON.parse(init.body));s.send({type:'accepted'});return s.response;}
  if(url==='/api/answer/interrupt'){streams.at(-1).close();return Response.json({interrupted:true});}
 }});t.after(()=>a.close());await a.run('connect()');a.run('settings.source="both";raw="ANSWER: Keep the current card.";render()');return {a,streams,sent};
}
function preview(a,text=question,id=7){a.run(`onSpeechPreview(${JSON.stringify({text,source:'system',utteranceId:id,speechEndedAt:performance.now()})})`);}
function final(a,text=question,id=7){a.run(`onSpeechText(${JSON.stringify({text,source:'system',utteranceId:id,final:true,speechEndedAt:performance.now()})})`);}
async function finish(s,text='A specific decision that protects the stated cash constraint.'){
 s.send({type:'answer',text:'ANSWER: '+text,streaming:false});s.send({type:'done'});s.close();await tick();
}
test('a finished preparation remains private until the identical final question confirms it',async t=>{
 const {a,streams,sent}=await setup(t);preview(a);await tick();await finish(streams[0]);
 assert.equal(a.el('answer').textContent,'Keep the current card.');assert.equal(a.run('answerArchive.length'),0);assert.equal(a.run('localHistory.length'),0);
 assert.equal(sent[0].preparation,undefined);final(a);await tick();
 assert.equal(sent.length,1);assert.equal(a.el('answer').textContent,'A specific decision that protects the stated cash constraint.');assert.equal(a.run('answerArchive.length'),1);
});
test('an in-flight preparation is adopted once and keeps the old card until completion',async t=>{
 const {a,streams,sent}=await setup(t);preview(a);await tick();streams[0].send({type:'answer',text:'ANSWER: First useful point.',streaming:true});await tick();final(a);await tick();
 assert.equal(sent.length,1);assert.equal(a.el('answer').textContent,'Keep the current card.');await finish(streams[0]);assert.match(a.el('answer').textContent,/specific decision/);
});
for(const changed of ['How would you protect cash with three weeks, not six months?','How would you protect cash while testing retention and what would you stop?'])test('a changed final question discards a speculative answer: '+changed,async t=>{
 const {a,streams,sent}=await setup(t);preview(a);await tick();streams[0].send({type:'answer',text:'ANSWER: WRONG UNCONFIRMED DRAFT',streaming:true});await tick();final(a,changed);await tick();
 assert.equal(sent.length,2);assert.match(sent[1].question,/three weeks|what would you stop/);assert.doesNotMatch(JSON.stringify(sent[1].history),/WRONG/);assert.equal(a.el('answer').textContent,'Keep the current card.');await finish(streams[1],'The corrected decision.');assert.equal(a.el('answer').textContent,'The corrected decision.');
});
test('new candidate speech invalidates a prepared answer even when the question is unchanged',async t=>{
 const {a,streams,sent}=await setup(t);preview(a);await tick();await finish(streams[0],'STALE CONTEXT');
 a.run('onSpeechText({text:"I would retain premium prices and stop the campaign.",source:"mic",utteranceId:88,final:true})');final(a);await tick();
 assert.equal(sent.length,2);assert.ok(sent[1].conversation.some(x=>/stop the campaign/.test(x.text)));await finish(streams[1],'Use the candidate’s actual choice.');
});
test('room and candidate previews never speculate from uncertain speaker attribution',async t=>{
 const {a,sent}=await setup(t);for(const source of ['shared','mic'])a.run(`onSpeechPreview({text:${JSON.stringify(question)},source:${JSON.stringify(source)},utteranceId:7})`);await tick();assert.equal(sent.length,0);
});
test('a preface or dangling fragment does not start a model request',async t=>{
 const {a,sent}=await setup(t);preview(a,'Your CEO wants to double users but cash is limited.');preview(a,'How would you handle the');await tick();assert.equal(sent.length,0);
});
test('one unfinished computer utterance can have only one prepared answer',async t=>{
 const {a,sent,streams}=await setup(t);preview(a);await tick();preview(a,question+' And the risks?');await tick();assert.equal(sent.length,1);await finish(streams[0]);preview(a,question+' And the risks?');await tick();assert.equal(sent.length,1);
});
test('Stop clears finished preparations and late responses cannot revive them',async t=>{
 const {a,streams}=await setup(t);preview(a);await tick();a.run('stop()');await finish(streams[0],'LATE');assert.equal(a.run('preparedAnswer'),null);assert.equal(a.run('answerArchive.length'),0);assert.doesNotMatch(a.el('answer').textContent,/LATE/);
});
test('Pause invalidates a preparation without making it a committed suggestion',async t=>{
 const {a,streams,sent}=await setup(t);preview(a);await tick();a.el('pauseButton').onclick();await finish(streams[0],'OLD PAUSED DRAFT');a.el('pauseButton').onclick();final(a);await tick();assert.equal(sent.length,2);assert.doesNotMatch(a.el('answer').textContent,/OLD PAUSED/);await finish(streams[1]);
});
test('a speculative request failure stays silent and final speech retries normally',async t=>{
 const {a,streams,sent}=await setup(t);preview(a);await tick();streams[0].send({type:'error',message:'Early generation failed'});streams[0].close();await tick();assert.equal(a.el('retryAnswer').hidden,true);assert.doesNotMatch(a.el('notice').textContent,/Early generation failed/);
 final(a);await tick();assert.equal(sent.length,2);await finish(streams[1]);
});
test('two physical utterances retain distinct identities for context validation',()=>{
 const c=new ConversationLedger();c.record({speaker:'interviewer',text:'The budget is one lakh.',source:'system',key:'system:1',at:0});c.record({speaker:'interviewer',text:question,source:'system',key:'system:2',at:1000});assert.equal(c.items.length,2);assert.equal(c.items[0].key,'system:1');
});
test('quiet recognition provides a private preview and still emits exactly one final transcript',async()=>{
 const seen=[],previews=[];const p=new SpeechPipeline({transcribe:async()=>question,onTranscript:x=>seen.push(x),onPreview:x=>previews.push(x)});
 p.push({source:'system',pcm:'audio',utteranceKey:'7:3',utteranceId:7,final:false,endpoint:true});await tick();assert.equal(seen.length,0);assert.equal(previews.length,1);
 p.push({source:'system',pcm:'audio',utteranceKey:'7:3',utteranceId:7,final:true});await tick();assert.equal(seen.length,1);p.stop();
});
