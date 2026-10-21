import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consumeAnswer} from '../public/answer-stream.js';
import {PendingTurns} from '../public/pending-turns.js';
import {QuestionSegmenter,pcmBase64} from '../public/local-audio.js';
import {SpeechPipeline,transcribeRequest} from '../public/speech-pipeline.js';
import {parseResponse} from '../public/core.js';
import {turnDecision} from '../public/turn-decision.js';

function response(bytes,chunk=1){let offset=0;return new Response(new ReadableStream({pull(c){if(offset>=bytes.length){c.close();return;}c.enqueue(bytes.slice(offset,offset+=chunk));}}));}
for(const width of [1,2,7,512])test('stream survives packet fragmentation at '+width+' byte(s)',async()=>{
 const seen=[],body=new TextEncoder().encode(JSON.stringify({type:'answer',text:'ANSWER: ₹40 crore — “yes”. 日本語.'})+'\n'+JSON.stringify({type:'done'}));
 await consumeAnswer(response(body,width),e=>seen.push(e));assert.equal(seen[0].text,'ANSWER: ₹40 crore — “yes”. 日本語.');assert.equal(seen.at(-1).type,'done');
});
for(const [name,body,pattern] of [
 ['truncated JSON','{"type":"answer"',/unreadable/],
 ['null event','null\n',/unexpected/],
 ['non-text answer','{"type":"answer","text":3}\n',/unreadable/],
 ['oversized line','x'.repeat(80001),/limit/],
 ['EOF without done','{"type":"answer","text":"ANSWER: Partial"}\n',/early/],
 ['error after partial','{"type":"answer","text":"ANSWER: Partial"}\n{"type":"error","message":"Network failed"}\n',/Network failed/],
 ['duplicate terminal event','{"type":"done"}\n{"type":"done"}\n',/Unexpected/],
 ['oversized answer',JSON.stringify({type:'answer',text:'a'.repeat(12001)})+'\n',/limit/],
])test('stream rejects '+name,async()=>await assert.rejects(consumeAnswer(response(new TextEncoder().encode(body),4096),()=>{}),pattern));
test('empty speech is a valid terminal result',async()=>{const events=[];await consumeAnswer(new Response('{"type":"empty"}\n'),e=>events.push(e));assert.equal(events.length,1);});

test('queued multipart questions combine in order without losing the original prompt',()=>{
 const q=new PendingTurns();for(const question of ['Describe the launch.','Specifically the hard part.','And what changed afterwards?'])q.push({question,inputSource:'system',autoDetect:true});
 assert.equal(q.take().question,'Describe the launch.\nSpecifically the hard part.\nAnd what changed afterwards?');assert.equal(q.length,0);
});
test('long queued questions split at the size limit instead of cutting off the start',()=>{
 const q=new PendingTurns(),first='First question '+ 'x'.repeat(2500),second='Second question '+'y'.repeat(2500);
 q.push({question:first,inputSource:'system',autoDetect:true});q.push({question:second,inputSource:'system',autoDetect:true});assert.equal(q.take().question,first);assert.equal(q.take().question,second);
});
test('typed, interviewer and microphone questions cannot overwrite each other',()=>{
 const q=new PendingTurns();for(const inputSource of ['system','mic',undefined])q.push({question:'Question '+inputSource,inputSource,autoDetect:!!inputSource});
 assert.equal(q.take().inputSource,'system');assert.equal(q.take().inputSource,'mic');assert.equal(q.take().inputSource,undefined);
});
test('queue capacity is bounded and overflow is explicit',()=>{
 const q=new PendingTurns();for(let i=0;i<8;i++)q.push({question:'Question '+i});assert.throws(()=>q.push({question:'Overflow'}),/Too many/);assert.equal(q.length,8);q.clear();assert.equal(q.take(),null);
});
test('ten thousand speech previews do not grow the decoder queue',async()=>{
 let release;const pipe=new SpeechPipeline({transcribe:()=>new Promise(r=>release=r),onTranscript:()=>{}});
 pipe.push({pcm:'active',source:'mic',final:false});for(let i=0;i<10000;i++)pipe.push({pcm:'preview '+i,source:'mic',final:false});assert.equal(pipe.queue.length,1);assert.equal(pipe.queue[0].pcm,'preview 9999');pipe.stop();release('late');
});
test('final audio overload warns without growing memory indefinitely',async()=>{
 let release,errors=0;const pipe=new SpeechPipeline({transcribe:()=>new Promise(r=>release=r),onTranscript:()=>{},onError:()=>errors++});
 for(let i=0;i<20;i++)pipe.push({pcm:'question '+i,source:'system',final:true});assert.equal(pipe.queue.length,8);assert.equal(errors,11);pipe.stop();release('late');
});
test('clearing a paused decoder ignores old speech and processes a resumed turn',async()=>{
 let release;const seen=[];const pipe=new SpeechPipeline({transcribe:pcm=>pcm==='old'?new Promise(r=>release=r):Promise.resolve(pcm),onTranscript:x=>seen.push(x.text)});
 pipe.push({pcm:'old',source:'mic',final:true});pipe.clear();pipe.push({pcm:'resumed',source:'system',final:true});release('old');await new Promise(r=>setImmediate(r));assert.deepEqual(seen,['resumed']);pipe.stop();
});
test('ninety seconds of speech are segmented within the maximum size and retain all samples',()=>{
 const out=[],s=new QuestionSegmenter(x=>out.push(x));for(let i=0;i<900;i++)s.push(new Float32Array(1600).fill(.05));s.flush();assert.equal(out.length,2);assert.ok(out.every(x=>x.length<=720000));assert.equal(out.reduce((n,x)=>n+x.length,0),1440000);
});
test('empty and nonfinite audio cannot poison later speech recognition',()=>{
 const out=[],s=new QuestionSegmenter(x=>out.push(x));s.push(new Float32Array());s.push(new Float32Array([NaN,Infinity]));for(let i=0;i<5;i++)s.push(new Float32Array(1600).fill(.05));s.flush();assert.equal(out.length,1);assert.ok(out[0].every(Number.isFinite));
});
test('PCM clips peaks, preserves silence and uses little-endian signed samples',()=>{
 const pcm=Buffer.from(pcmBase64(new Float32Array([-2,-1,0,1,2])),'base64');assert.deepEqual(Array.from({length:5},(_,i)=>pcm.readInt16LE(i*2)),[-32767,-32767,0,32767,32767]);
});
test('a decoder busy race retries briefly and keeps the same utterance',async()=>{
 const sent=[],delays=[];const result=await transcribeRequest('same PCM',new AbortController().signal,{fetcher:async(_url,init)=>{sent.push(JSON.parse(init.body).pcm);return sent.length<3?Response.json({error:'Busy'},{status:429}):Response.json({text:'Question recovered.'});},wait:async ms=>delays.push(ms)});
 assert.equal(result,'Question recovered.');assert.deepEqual(sent,['same PCM','same PCM','same PCM']);assert.deepEqual(delays,[100,300]);
});
test('a persistently busy decoder stops retrying and surfaces the error',async()=>{
 let calls=0;await assert.rejects(transcribeRequest('pcm',new AbortController().signal,{fetcher:async()=>{calls++;return Response.json({error:'Speech recognition is busy.'},{status:429});},wait:async()=>{}}),/busy/);assert.equal(calls,4);
});
test('Stop during a decoder busy retry prevents another request',async()=>{
 let calls=0;const c=new AbortController();await assert.rejects(transcribeRequest('pcm',c.signal,{fetcher:async()=>{calls++;return Response.json({error:'Busy'},{status:429});},wait:async()=>c.abort()}),{name:'AbortError'});assert.equal(calls,1);
});
test('partial CHECK headers cannot leak into the speakable answer',()=>{
 for(const label of ['C','CH','CHE','CHEC','CHECK','CHECK:'])assert.equal(parseResponse('ANSWER: Supported words.\n'+label).answer,'Supported words.');
 assert.equal(turnDecision('ANSWER:\nCHECK: Missing fact.'),'pending');
});
test('format keywords quoted inside a question do not become the suggested answer',()=>{
 const p=parseResponse('QUESTION: Why did the prompt say ANSWER: yes?\nANSWER: Here is my response.\nCHECK: Verify date.');assert.equal(p.answer,'Here is my response.');
});

test('context routing and ready-session timing survive the real answer-stream decoder',async()=>{
 const events=[{type:'context',mode:'general',records:0,historyTurns:0},{type:'answer',text:'ANSWER: A direct general answer.',streaming:true},{type:'timing',phases:{readyMs:0,readyWaitMs:10,firstDeltaMs:900,totalMs:1100}},{type:'done'}];
 const seen=[];await consumeAnswer(new Response(events.map(e=>JSON.stringify(e)).join('\n')+'\n'),e=>seen.push(e));assert.deepEqual(seen,events);
});
test('invalid context counts cannot enter renderer state',async()=>{
 await assert.rejects(consumeAnswer(new Response('{"type":"context","mode":"general","records":-1,"historyTurns":0}\n'),()=>{}),/invalid context/);
});
