import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {SpeechWorker} from '../speech-worker.mjs';
import {CodexSession} from '../codex-stream.mjs';
import {SpeechPipeline} from '../public/speech-pipeline.js';
import {QuestionSegmenter} from '../public/local-audio.js';
import {renderer,tick,channel} from '../test-support/renderer-harness.mjs';

function workerFixture(t){
 const children=[],writes=[];
 const worker=new SpeechWorker({command:'mock',script:'mock',spawnProcess:()=>{
  const p=new EventEmitter();p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kills=0;p.kill=()=>p.kills++;p.stdin.on('data',bytes=>writes.push(JSON.parse(bytes.toString())));children.push(p);return p;
 },timeout:2000});t.after(()=>worker.close());
 const send=(data,child=children.at(-1))=>child.stdout.write(JSON.stringify(data)+'\n');
 return {worker,children,writes,send};
}
test('warm decoder serves consecutive utterances without spawning or loading again',async t=>{
 const {worker,children,writes,send}=workerFixture(t);const ready=worker.warm();send({type:'ready'});await ready;
 const first=worker.transcribe('pcm1');await tick();send({id:writes[0].id,text:'First question?'});assert.equal(await first,'First question?');
 const second=worker.transcribe('pcm2');await tick();send({id:writes[1].id,text:'Second question?'});assert.equal(await second,'Second question?');assert.equal(children.length,1);
});
test('decoder cancellation kills its work and a new utterance recovers on a fresh worker',async t=>{
 const {worker,children,writes,send}=workerFixture(t);const c=new AbortController();const first=worker.transcribe('old',c.signal);const rejected=assert.rejects(first,/Stopped/);send({type:'ready'});await tick();c.abort();await rejected;assert.equal(children[0].kills,1);
 const next=worker.transcribe('new');send({type:'ready'});await tick();send({id:writes.at(-1).id,text:'New question?'});assert.equal(await next,'New question?');assert.equal(children.length,2);
});
test('decoder wrong IDs, malformed output and a lost child fail instead of mixing utterances',async t=>{
 for(const mode of ['id','json','exit']){
  const {worker,children,send}=workerFixture(t);const pending=worker.transcribe('pcm');const rejection=assert.rejects(pending,/unexpected|unreadable|disconnected/);send({type:'ready'});await tick();
  if(mode==='id')send({id:999,text:'Wrong person'});else if(mode==='json')children[0].stdout.write('bad json\n');else children[0].emit('close');await rejection;
 }
});
test('an already aborted audio request does not even start a worker',async t=>{
 const {worker,children}=workerFixture(t);const c=new AbortController();c.abort();await assert.rejects(worker.transcribe('pcm',c.signal));assert.equal(children.length,0);
});
test('interviewer recognition proceeds while a separate readback decoder is blocked',async()=>{
 const finished=[],pending={};const p=new SpeechPipeline({parallel:true,transcribe:(pcm)=>new Promise(r=>pending[pcm]=r),onTranscript:item=>finished.push(item)});
 p.push({source:'mic',pcm:'reading',final:false});p.push({source:'system',pcm:'question',final:true});
 assert.deepEqual(Object.keys(pending),['reading','question']);pending.question('Why did you choose that?');await tick();assert.equal(finished[0].source,'system');p.stop();pending.reading('old readback');await tick();assert.equal(finished.length,1);
});
test('early end-of-question transcription is reused only after final endpoint confirmation',async()=>{
 let calls=0;const heard=[];const p=new SpeechPipeline({transcribe:async()=>{calls++;return 'Why this choice?';},onTranscript:item=>heard.push(item)});
 p.push({source:'system',pcm:'preview',endpoint:true,final:false,utteranceKey:'1:20'});await tick();assert.equal(heard.length,0);
 p.push({source:'system',pcm:'final',final:true,utteranceKey:'1:20',speechEndedAt:10});await tick();assert.equal(calls,1);assert.equal(heard.length,1);assert.equal(heard[0].eager,true);assert.equal(heard[0].speechEndedAt,10);p.stop();
});
test('an in-flight early transcript can be promoted without duplicate decoding',async()=>{
 let resolve,calls=0;const heard=[];const p=new SpeechPipeline({transcribe:()=>{calls++;return new Promise(r=>resolve=r);},onTranscript:item=>heard.push(item)});
 p.push({source:'system',pcm:'preview',endpoint:true,final:false,utteranceKey:'1:20'});p.push({source:'system',pcm:'final',final:true,utteranceKey:'1:20'});resolve('Question?');await tick();assert.equal(calls,1);assert.equal(heard.length,1);assert.equal(heard[0].final,true);p.stop();
});
test('resumed speech invalidates speculative words including a changed negation',async()=>{
 const heard=[];const p=new SpeechPipeline({transcribe:async pcm=>pcm,onTranscript:item=>heard.push(item)});
 p.push({source:'system',pcm:'Why did you hire them?',endpoint:true,final:false,utteranceKey:'1:20'});await tick();
 p.push({source:'system',pcm:'Why did you not hire them?',final:true,utteranceKey:'1:30'});await tick();assert.equal(heard.length,1);assert.match(heard[0].text,/not hire/);p.stop();
});
test('Stop discards both cached previews and in-flight decoder results',async()=>{
 let resolve;const heard=[];const p=new SpeechPipeline({transcribe:()=>new Promise(r=>resolve=r),onTranscript:item=>heard.push(item)});
 p.push({source:'system',pcm:'p',endpoint:true,final:false,utteranceKey:'1:2'});p.stop();resolve('Question?');await tick();p.push({source:'system',pcm:'f',final:true,utteranceKey:'1:2'});assert.equal(heard.length,0);assert.equal(p.cache.size,0);
});
test('VAD overlaps decode with silence, but resumed voice changes the utterance revision',()=>{
 let now=0;const early=[],final=[];const part=new QuestionSegmenter((pcm,meta)=>final.push(meta),()=>{},{silenceMs:650,onQuiet:(pcm,meta)=>early.push(meta),now:()=>now});
 const push=(value,count)=>{for(let i=0;i<count;i++){now+=50;part.push(new Float32Array(800).fill(value));}};
 push(.1,10);push(0,5);assert.equal(early.length,1);assert.equal(final.length,0);assert.equal(early[0].speechEndedAt,500);
 push(.1,8);push(0,13);assert.equal(final.length,1);assert.notEqual(final[0].utteranceKey,early[0].utteranceKey);assert.equal(final[0].utteranceKey,early[1].utteranceKey);assert.equal(final[0].speechEndedAt,1150);
});
function codexFixture(t,{maxTurns=6,idleMs=300000}={}){
 const connections=[],calls=[];let turn=0;
 const session=new CodexSession({command:'mock',maxTurns,idleMs,connectionFactory:()=>{
  const rpc={closed:false,close(){this.closed=true;},send(){},call:async(method,params)=>{
   calls.push({method,params});if(method==='config/read')return {config:{}};if(method==='thread/start')return {thread:{id:'thread'+connections.length}};
   if(method==='turn/start'){
    const id='turn'+ ++turn;
    rpc.onNotification('item/agentMessage/delta',{threadId:params.threadId,turnId:'previous-turn',itemId:'old',delta:'ANSWER: stale private text'});
    rpc.onNotification('item/agentMessage/delta',{threadId:params.threadId,turnId:id,itemId:id,delta:'ANSWER: A supported answer.'});rpc.onNotification('turn/completed',{threadId:params.threadId,turn:{id,status:'completed'}});return {turn:{id}};
   }return {};
  }};connections.push(rpc);return rpc;
 }});t.after(()=>session.close());return {session,connections,calls};
}
const options={cwd:'/tmp',key:'profile1',writingInstructions:'Facts only',prompt:'Question?',emit:()=>{}};
test('successive questions reuse one initialized thread, excluding delayed events from the previous turn',async t=>{
 const {session,connections,calls}=codexFixture(t);await session.prepare(options);for(let i=0;i<3;i++)assert.equal(await session.run(options),'ANSWER: A supported answer.');
 assert.equal(connections.length,1);assert.equal(calls.filter(x=>x.method==='initialize').length,1);assert.equal(calls.filter(x=>x.method==='thread/start').length,1);assert.equal(connections[0].closed,false);
});
test('profile identity changes and bounded context rotation close the previous conversation',async t=>{
 const {session,connections}=codexFixture(t,{maxTurns:2});await session.run(options);await session.run(options);await session.run(options);assert.equal(connections.length,2);assert.equal(connections[0].closed,true);
 await session.run({...options,key:'other-candidate'});assert.equal(connections.length,3);assert.equal(connections[1].closed,true);
});
test('latency label includes recognition and queue delay from the actual speech endpoint',async()=>{
 const s=channel();const ui=await renderer({fetch:url=>url==='/api/answer'?s.response:undefined});await ui.run('connect()');
 const pending=ui.run("localAnswer({question:'Why?',speechEndedAt:performance.now()-2000})");await tick();s.send({type:'answer',text:'ANSWER: A supported response.',streaming:true});await tick();assert.match(ui.el('latency').textContent,/2\.\ds from speech end/);s.send({type:'done'});s.close();await pending;ui.close();
});
test('warm-up happens once and its text is never emitted as an interview answer',async t=>{
 const {session,calls}=codexFixture(t);let count=0;await session.warm({...options,emit:()=>count++});await session.warm(options);assert.equal(count,0);assert.equal(calls.filter(x=>x.method==='turn/start').length,1);await session.run({...options,emit:e=>{if(e.type==='answer')count++;}});assert.equal(count,1);
});

test('model or speed changes rotate the writer and set explicit per-turn speed',async t=>{
 const {session,connections,calls}=codexFixture(t);
 await session.run({...options,model:'gpt-6-sol',serviceTier:'priority'});
 await session.run({...options,model:'gpt-6-sol',serviceTier:'default'});
 await session.run({...options,model:'gpt-6-luna',serviceTier:'default'});
 assert.equal(connections.length,3);assert.equal(connections[0].closed,true);assert.equal(connections[1].closed,true);
 const starts=calls.filter(c=>c.method==='thread/start');assert.deepEqual(starts.map(c=>c.params.model),['gpt-6-sol','gpt-6-sol','gpt-6-luna']);
 assert.deepEqual(starts.map(c=>c.params.config.features.fast_mode),[true,false,false]);
 assert.deepEqual(calls.filter(c=>c.method==='turn/start').map(c=>c.params.serviceTierForTurn),['priority','default','default']);
});
test('unavailable Ultrafast never silently presents itself as Ultrafast',async t=>{
 const {session,calls}=codexFixture(t);await assert.rejects(session.run({...options,model:'gpt-6-astra',serviceTier:'ultrafast'}),/Ultrafast is not available/);
 assert.equal(calls.filter(c=>c.method==='turn/start').length,0);
});

test('isolated answers start new model threads while reusing the authenticated transport',async t=>{
 const calls=[],connections=[];let count=0;
 const session=new CodexSession({command:'mock',isolatedTurns:true,maxTurns:40,connectionFactory:()=>{
  const rpc={closed:false,close(){this.closed=true;},send(){},call:async(method,params)=>{
   calls.push({method,params});if(method==='config/read')return {config:{}};
   if(method==='thread/start')return {thread:{id:'thread'+ ++count}};
   if(method==='turn/start'){rpc.onNotification('item/agentMessage/delta',{threadId:params.threadId,itemId:'answer',delta:'ANSWER: Correct current answer.'});rpc.onNotification('turn/completed',{threadId:params.threadId,turn:{status:'completed'}});}return {};
  }};connections.push(rpc);return rpc;
 }});t.after(()=>session.close());
 await session.warm(options);
 for(let i=0;i<9;i++)await session.run({...options,prompt:`Current question ${i}`});
 assert.equal(connections.length,1);assert.equal(calls.filter(c=>c.method==='initialize').length,1);
 const turns=calls.filter(c=>c.method==='turn/start');assert.equal(new Set(turns.map(c=>c.params.threadId)).size,10);
 assert.equal(turns.at(-1).params.input[0].text,'Current question 8');
});
test('stalled first text is bounded and closes the connection without inventing an answer',async t=>{
 let closed=false;const session=new CodexSession({command:'mock',connectionFactory:()=>({closed:false,close(){closed=true;},send(){},call:async(method)=>{
  if(method==='config/read')return {config:{}};if(method==='thread/start')return {thread:{id:'t'}};return {};
 }})});t.after(()=>session.close());
 const events=[];await assert.rejects(session.run({...options,firstTextMs:15,emit:e=>events.push(e)}),e=>e.code==='FIRST_TEXT_TIMEOUT');
 assert.equal(closed,true);assert.equal(events.filter(e=>e.type==='answer').length,0);
});

test('prewarmed pool uses each model conversation for only one real answer',async()=>{
 const {WarmWriterPool}=await import('../codex-stream.mjs');const workers=[];
 const pool=new WarmWriterPool({sessionFactory:()=>{
  const worker={warmed:0,questions:[],closed:false,async warm(){this.warmed++;},async run(o){this.questions.push(o.prompt);return 'ANSWER: OK';},close(){this.closed=true;},async interrupt(){return true;}};
  workers.push(worker);return worker;
 }});
 try{
  await pool.warm(options);assert.equal(workers.length,2);
  for(let i=0;i<10;i++)await pool.run({...options,prompt:`Only question ${i}`});
  assert.equal(workers.filter(w=>w.questions.length).length,10);assert.ok(workers.every(w=>w.questions.length<=1));
  assert.equal(workers.filter(w=>!w.closed).length,2);assert.equal(pool.slots.length,2);
 }finally{pool.close();}
 assert.ok(workers.every(w=>w.closed));
});
test('Stop during pool warm-up cannot emit an answer or replenish the stopped pool',async()=>{
 const {WarmWriterPool}=await import('../codex-stream.mjs');const workers=[];
 const pool=new WarmWriterPool({sessionFactory:()=>{
  let reject;const worker={ready:new Promise((_,r)=>reject=r),warm(){return this.ready;},run(){throw new Error('Must not run');},close(){reject(new DOMException('Stopped.','AbortError'));}};workers.push(worker);return worker;
 }});
 const controller=new AbortController();const run=pool.run({...options,signal:controller.signal});pool.close();controller.abort();await assert.rejects(run,/Stopped/);assert.equal(workers.length,2);assert.equal(pool.slots.length,0);
});
test('warm pool rotates on profile or model changes and never revives prior personal context',async()=>{
 const {WarmWriterPool}=await import('../codex-stream.mjs');const workers=[];
 const pool=new WarmWriterPool({sessionFactory:()=>{const w={closed:false,async warm(){},async run(){return 'ANSWER: OK';},close(){this.closed=true;}};workers.push(w);return w;}});
 await pool.warm(options);const previous=[...workers];await pool.warm({...options,key:'different-interview'});assert.ok(previous.every(w=>w.closed));assert.equal(pool.slots.length,2);pool.close();
});

test('pool chooses a ready slot instead of waiting behind a slow preparation',async()=>{
 const {WarmWriterPool}=await import('../codex-stream.mjs');let count=0;
 const pool=new WarmWriterPool({sessionFactory:()=>{
  const id=++count;let reject;const ready=id===1?new Promise((_,r)=>reject=r):Promise.resolve();
  return {warm:()=>ready,async run(){return 'ANSWER: Slot '+id;},close(){reject?.(new DOMException('Stopped.','AbortError'));}};
 }});
 try{await pool.warm(options);assert.equal(await pool.run(options),'ANSWER: Slot 2');}finally{pool.close();}
});
test('one failed warm-up does not discard another healthy ready session',async()=>{
 const {WarmWriterPool}=await import('../codex-stream.mjs');let count=0;
 const pool=new WarmWriterPool({sessionFactory:()=>{const id=++count;return {warm:()=>id===1?Promise.reject(new Error('Slow model connection')):Promise.resolve(),async run(){return 'ANSWER: Healthy';},close(){}};}});
 try{await pool.warm(options);assert.equal(await pool.run(options),'ANSWER: Healthy');}finally{pool.close();}
});

test('pool-owned writer stays prepared across a long answer and closes explicitly on Stop',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {session,connections}=codexFixture(t,{idleMs:0,maxTurns:2});
 await session.warm(options);t.mock.timers.tick(301000);
 assert.equal(connections[0].closed,false);
 await session.run({...options,prompt:'A question after five minutes of speaking.'});assert.equal(connections.length,1);
 session.close();assert.equal(connections[0].closed,true);
});

test('a disconnected prepared transport is replaced rather than reused as ready',async t=>{
 const {session,connections}=codexFixture(t,{idleMs:0});await session.warm(options);
 connections[0].closed=true;
 assert.equal(await session.run(options),'ANSWER: A supported answer.');assert.equal(connections.length,2);
});
