import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CrossSourceEcho,speechSourceFor,transcriptionLane} from '../public/audio-routing.js';
import {SpeechPipeline} from '../public/speech-pipeline.js';
import {renderer,tick,channel} from '../test-support/renderer-harness.mjs';

const reply=()=>new Response('{"type":"answer","text":"ANSWER: I would test the smallest useful change."}\n{"type":"done"}\n');
function hear(a,text,source,extra={}){a.run(`onSpeechText(${JSON.stringify({text,source,final:true,...extra})})`);}
async function setup(t,fetch){const a=await renderer({fetch});t.after(()=>a.close());await a.run('connect()');a.run('settings.source="hybrid"');return a;}

test('Mac and room decode concurrently even when one decoder is slow',async()=>{
 const pending={},heard=[];const p=new SpeechPipeline({parallel:true,transcribe:(pcm,_signal,item)=>new Promise(r=>{pending[pcm]={resolve:r,lane:transcriptionLane('hybrid',item.source)};}),onTranscript:item=>heard.push(item)});
 p.push({pcm:'mac',source:speechSourceFor('hybrid','system'),final:true});
 p.push({pcm:'phone',source:speechSourceFor('hybrid','mic'),final:true});
 assert.equal(pending.mac.lane,'question');assert.equal(pending.phone.lane,'readback');
 pending.phone.resolve('Why that decision?');await tick();assert.equal(heard[0].source,'shared');
 pending.mac.resolve('What is the main risk?');await tick();assert.equal(heard.length,2);p.stop();
});
test('overlapping phone question, Mac question and trailing phone request are all retained',async t=>{
 const sent=[];const a=await setup(t,(url,init)=>{if(url==='/api/answer'){sent.push(JSON.parse(init.body));return reply();}});
 hear(a,'Walk me through the trade-offs.','system');await tick();
 hear(a,'Give me one concrete experiment.','shared',{overlappedSystem:true});await tick();
 hear(a,'and the risk you would accept.','shared');await tick();
 assert.equal(sent.length,3);assert.match(sent[2].question,/trade-offs/);assert.match(sent[2].question,/experiment/);assert.match(sent[2].question,/risk/);
 hear(a,'I would test the smallest useful change.','shared');await tick();assert.equal(sent.length,3);
 hear(a,'Why that customer?','system');await tick();assert.equal(sent[3].question,'Why that customer?');assert.match(JSON.stringify(sent[3].history),/Candidate response/);
});
test('room and Mac follow-ups interrupt a slow answer without dropping either input',async t=>{
 const sent=[],streams=[];const a=await setup(t,(url,init)=>{
  if(url==='/api/answer'){const s=channel();streams.push(s);sent.push(JSON.parse(init.body));s.send({type:'accepted'});return s.response;}
  if(url==='/api/answer/interrupt'){streams[0].close();return Response.json({interrupted:true});}
 });
 hear(a,'What would you build?','system');await tick();
 hear(a,'How would you test it?','shared',{overlappedSystem:true});hear(a,'and the main risk.','system');await tick();
 assert.match(sent.at(-1).question,/What would you build/);assert.match(sent.at(-1).question,/How would you test/);assert.match(sent.at(-1).question,/main risk/);
 streams.at(-1).send({type:'answer',text:'ANSWER: One useful test and its risk.'});streams.at(-1).send({type:'done'});streams.at(-1).close();await tick();assert.match(a.el('answer').textContent,/One useful test/);
});
test('cross-input duplicates cannot become candidate replies or trigger another answer',async t=>{
 const sent=[];const a=await setup(t,(url,init)=>{if(url==='/api/answer'){sent.push(JSON.parse(init.body));return reply();}});
 hear(a,'I want to understand your decision.','system',{speechEndedAt:1000});await tick();
 hear(a,'I want to understand your decision.','shared',{speechEndedAt:1020});await tick();
 assert.equal(sent.length,1);assert.equal(a.run('localHistory.some(x=>x.answer.startsWith("WAIT:"))'),false);
 hear(a,'What was the result?','shared',{speechEndedAt:2000});await tick();
 hear(a,'What was the result?','system',{speechEndedAt:2030});await tick();assert.equal(sent.length,2);
});
test('echo matching keeps different questions, negations, numbers and later repetitions',()=>{
 const e=new CrossSourceEcho();assert.equal(e.accept('Why did you hire two people?','system',1000),true);
 assert.equal(e.accept('Why did you hire two people!','shared',1050),false);
 assert.equal(e.accept('Why did you not hire two people?','shared',1060),true);
 assert.equal(e.accept('Why did you hire three people?','shared',1070),true);
 assert.equal(e.accept('Why did you hire two people?','shared',10000),true);
 e.clear();assert.equal(e.accept('Why did you hire two people?','system',10001),true);
});
test('half a Mac question cannot consume an independent phone fragment',async t=>{
 const sent=[];const a=await setup(t,(url,init)=>{if(url==='/api/answer'){sent.push(JSON.parse(init.body));return reply();}});
 hear(a,'What would you build for','system');await tick();assert.equal(sent.length,0);
 hear(a,'the main risk.','shared');await tick();assert.equal(sent[0].question,'the main risk.');
 hear(a,'busy parents?','system');await tick();assert.equal(sent.at(-1).question,'What would you build for busy parents?');
});
test('hybrid setup persists and shows two correctly labelled meters',async t=>{
 const a=await renderer();t.after(()=>a.close());a.el('quickAudio').value='hybrid';a.el('quickAudio').onchange();
 assert.equal(a.run('read("source")'),'hybrid');assert.equal(a.el('audioSource').value,'hybrid');assert.equal(a.el('dualSignals').hidden,false);assert.equal(a.el('micSourceLabel').textContent,'Room / phone');assert.equal(a.el('microphoneSetting').hidden,false);assert.match(a.el('audioHelp').textContent,/Hears questions from this Mac/);
});
