import {test} from 'node:test';
import assert from 'node:assert/strict';
import {explicitQuestion} from '../public/reading.js';
import {ProgressView} from '../public/progress-ui.js';
import {QuestionJoiner} from '../public/question-joiner.js';
import {QuestionSegmenter} from '../public/local-audio.js';
import {writingOptions,closeLocal} from '../local-provider.mjs';
import {SpeechPipeline} from '../public/speech-pipeline.js';
import {renderer,tick,channel} from '../test-support/renderer-harness.mjs';

test('live progress shows elapsed stage time and stops ticking when ready',()=>{
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{setAttribute(){}});return elements.get(id);};let now=0,callback,clears=0;
 const p=new ProgressView({$,now:()=>now,every:fn=>(callback=fn,1),clear:()=>clears++});p.set('transcribe','Computer audio');now=350;callback();assert.equal($('processTime').textContent,'0.3s');assert.equal($('processLabel').textContent,'Transcribing');
 p.set('draft');now=850;callback();assert.equal($('processTime').textContent,'0.5s');p.set('ready');assert.equal($('processTime').textContent,'');assert.ok(clears>=3);
});
test('450 ms endpoint overlaps recognition with silence and retains speech endpoint time',()=>{
 let now=0;const stages=[],ends=[];const p=new QuestionSegmenter((pcm,m)=>ends.push(m),()=>stages.push('speech'),{silenceMs:450,quietMs:160,onQuiet:()=>stages.push('decode'),now:()=>now});
 for(let i=0;i<10;i++){now+=50;p.push(new Float32Array(800).fill(.1));}for(let i=0;i<8;i++){now+=50;p.push(new Float32Array(800));}
 assert.deepEqual(stages,['speech','decode']);assert.equal(ends.length,0);now+=50;p.push(new Float32Array(800));assert.equal(ends.length,1);assert.equal(now-ends[0].speechEndedAt,450);
});
test('recognition progress belongs to its audio lane and cleared decodes cannot deliver stale text',async()=>{
 let resolve;const states=[],heard=[];const p=new SpeechPipeline({transcribe:()=>new Promise(r=>resolve=r),onState:s=>states.push(s),onTranscript:s=>heard.push(s)});
 p.push({pcm:'pcm',source:'system',final:true});assert.equal(states[0].stage,'transcribe');assert.equal(states[0].source,'system');p.stop();resolve('Stale question?');await tick();assert.equal(heard.length,0);
});
test('automatic questions and confirmed follow-ups share the same warm identity and rules',async t=>{
 t.after(closeLocal);const data={profile:'A synthetic candidate fact sheet.',style:'script',sessionKey:'same'};const a=await writingOptions({...data,autoDetect:true}),b=await writingOptions({...data,autoDetect:false});
 assert.equal(a.key,b.key);assert.equal(a.writingInstructions,b.writingInstructions);assert.equal(a.instructionPath,b.instructionPath);
});
test('a pause inside a question preserves its beginning without answering an incomplete phrase',()=>{
 const j=new QuestionJoiner();assert.equal(j.accept('How did you deal with',{at:0,speechEndedAt:0}).waiting,true);
 assert.deepEqual(j.accept('the stakeholder disagreement?',{at:900,speechEndedAt:800}),{waiting:false,question:'How did you deal with the stakeholder disagreement?',speechEndedAt:800});
 assert.equal(j.accept('Why?',{at:1000}).waiting,false);j.accept('Can you tell me about the',{at:1100});assert.equal(j.accept('What happened next?',{at:1500}).question,'What happened next?');
 j.accept('How did you deal with',{at:1600});assert.equal(j.accept('a completely separate fragment',{at:33000}).question,'a completely separate fragment');
});
test('question context is retained during model delay and a failure restores the earlier context',async t=>{
 const stream=channel(),a=await renderer({fetch:url=>url==='/api/answer'?stream.response:undefined});t.after(()=>a.close());await a.run('connect()');a.run('raw="ANSWER: Previous.";render();$("question").textContent="Previous question?"');
 const run=a.run('localAnswer({question:"What changed?"})');await tick();assert.equal(a.el('question').textContent,'Previous question?');assert.equal(a.el('incomingQuestion').textContent,'What changed?');assert.equal(a.el('incomingQuestionBlock').hidden,false);assert.equal(a.el('answer').textContent,'Previous.');
 stream.send({type:'stage',step:'draft',text:'Preparing your answer…'});await tick();assert.equal(a.el('processLabel').textContent,'Preparing your answer');
 stream.error(new Error('Network lost'));await run;assert.equal(a.el('question').textContent,'Previous question?');assert.equal(a.el('incomingQuestionBlock').hidden,true);assert.equal(a.el('processLabel').textContent,'Needs attention');
});

test('fast follow-ups interrupt old generation, retain context, combine bursts and reject late text',async t=>{
 const streams=[],sent=[],cancels=[];let release;const gate=new Promise(r=>release=r);
 const a=await renderer({fetch:async(url,init)=>{
   if(url==='/api/answer'){const s=channel();streams.push(s);sent.push(JSON.parse(init.body));s.send({type:'accepted'});return s.response;}
   if(url==='/api/answer/interrupt'){cancels.push(JSON.parse(init.body));await gate;streams[0].close();return Response.json({interrupted:true});}
 }});t.after(()=>a.close());await a.run('connect()');a.run('settings.source="both"');
 const first=a.run('localAnswer({question:"What did you build?"})');await tick();streams[0].send({type:'answer',text:'ANSWER: I built a small product.',streaming:true});await tick();
 a.run('onSpeechText({text:"Why did you choose that?",source:"system",final:true});onSpeechText({text:"And what did you learn?",source:"system",final:true})');await tick();
 assert.equal(cancels.length,1);assert.equal(a.el('processLabel').textContent,'Switching to the follow-up');
 streams[0].send({type:'answer',text:'ANSWER: Obsolete late text.',streaming:true});await tick();assert.doesNotMatch(a.el('answer').textContent,/Obsolete/);
 release();await first;await tick();assert.equal(sent.length,2);assert.equal(sent[1].question,'Why did you choose that?\nAnd what did you learn?');assert.match(JSON.stringify(sent[1].history),/What did you build/);assert.match(JSON.stringify(sent[1].history),/small product/);
 streams[1].send({type:'answer',text:'ANSWER: Relevant follow-up.'});streams[1].send({type:'done'});streams[1].close();await tick();assert.equal(a.el('answer').textContent,'Relevant follow-up.');
});
test('coaching cannot start a competing model request before the first answer text',async t=>{
 const stream=channel();const a=await renderer({fetch:url=>url==='/api/answer'?stream.response:undefined});t.after(()=>a.close());await a.run('connect()');
 const run=a.run('localAnswer({question:"Why?"})');await tick();assert.equal(a.requests.filter(r=>r.url==='/api/coach/live').length,0);
 stream.send({type:'answer',text:'ANSWER: A clear response.'});stream.send({type:'done'});stream.close();await run;assert.equal(a.el('processLabel').textContent,'Answer ready');
});
test('Realtime progress follows actual events and reports failures without a renderer exception',async t=>{
 const a=await renderer();t.after(()=>a.close());a.run('handleEvent({type:"input_audio_buffer.speech_started"})');assert.equal(a.el('processLabel').textContent,'Hearing the question');
 a.run('handleEvent({type:"input_audio_buffer.speech_stopped"});handleEvent({type:"response.created",response:{id:"r1"}})');assert.equal(a.el('processLabel').textContent,'Preparing your answer');
 a.run('handleEvent({type:"response.output_text.delta",response_id:"r1",delta:"ANSWER: Hello."})');assert.equal(a.el('processLabel').textContent,'Writing your answer');
 a.run('handleEvent({type:"response.done",response:{id:"r1",status:"failed"}})');assert.equal(a.el('processLabel').textContent,'Needs attention');
});

test('short natural follow-ups and yes/no questions do not wait behind the old draft',()=>{
 for(const text of ['And then?','Anything else?','Did you build it alone?','Was that a mistake?','Give me an example.'])assert.equal(explicitQuestion(text),true,text);
 for(const text of ['I did build it alone.','The result was good.','Thanks.'])assert.equal(explicitQuestion(text),false,text);
});
