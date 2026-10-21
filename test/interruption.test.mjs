import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CodexSession} from '../codex-stream.mjs';
import {createApp} from '../server.mjs';
import {questionReplacement} from '../public/reading.js';
import {renderer,tick,channel} from '../test-support/renderer-harness.mjs';
const options={cwd:'/tmp',key:'test',writingInstructions:'Facts only.',prompt:'Synthetic question.',emit:()=>{}};
function fixture(t,{deferStart=false,interruptMs=200,terminal=true}={}){
 const connections=[],calls=[];let n=0,ack;
 const session=new CodexSession({command:'mock',interruptMs,connectionFactory:()=>{
  const rpc={closed:false,close(){this.closed=true;},send(){},call:async(method,params)=>{
   calls.push({method,params});
   if(method==='config/read')return {config:{}};
   if(method==='thread/start')return {thread:{id:'thread'}};
   if(method==='turn/start'){rpc.id='turn'+ ++n;if(deferStart)return new Promise(r=>ack=()=>r({turn:{id:rpc.id}}));return {turn:{id:rpc.id}};}
   if(method==='turn/interrupt'&&terminal)rpc.onNotification('turn/completed',{threadId:'thread',turn:{id:params.turnId,status:'interrupted'}});
   return {};
  }};connections.push(rpc);return rpc;
 }});t.after(()=>session.close());
 return {session,connections,calls,ack:()=>ack(),emit:(method,params)=>connections.at(-1).onNotification(method,{threadId:'thread',...params}),finish:(text='ANSWER: Current answer.')=>{const rpc=connections.at(-1);rpc.onNotification('item/agentMessage/delta',{threadId:'thread',turnId:rpc.id,itemId:rpc.id,delta:text});rpc.onNotification('turn/completed',{threadId:'thread',turn:{id:rpc.id,status:'completed'}});}};
}
test('interrupt waits for the terminal event then reuses the same warm connection',async t=>{
 const f=fixture(t);const first=f.session.run(options),rejected=assert.rejects(first,{name:'AbortError'});await tick();await f.session.interrupt();await rejected;
 assert.equal(f.connections[0].closed,false);assert.equal(f.session.busy,false);
 const events=[],next=f.session.run({...options,emit:e=>events.push(e)});await tick();
 f.emit('item/agentMessage/delta',{turnId:'turn1',itemId:'old',delta:'ANSWER: obsolete'});f.finish();assert.equal(await next,'ANSWER: Current answer.');assert.equal(f.connections.length,1);assert.doesNotMatch(JSON.stringify(events),/obsolete/);
});
test('correction before turn-start acknowledgement still interrupts the right turn',async t=>{
 const f=fixture(t,{deferStart:true});const run=f.session.run(options),rejected=assert.rejects(run,{name:'AbortError'});await tick();const cancel=f.session.interrupt();await tick();assert.equal(f.calls.filter(c=>c.method==='turn/interrupt').length,0);f.ack();await cancel;await rejected;assert.equal(f.calls.at(-1).params.turnId,'turn1');assert.equal(f.connections[0].closed,false);
});
test('interrupt acknowledgement alone cannot release the connection for reuse',async t=>{
 const f=fixture(t,{terminal:false,interruptMs:25});const run=f.session.run(options),rejected=assert.rejects(run,{name:'AbortError'});await tick();await f.session.interrupt();await rejected;assert.equal(f.connections[0].closed,true);
 const next=f.session.run(options);await tick();f.finish();await next;assert.equal(f.connections.length,2);
});
test('late deltas are suppressed while waiting for interruption to finish',async t=>{
 const f=fixture(t,{terminal:false}),events=[];const run=f.session.run({...options,emit:e=>events.push(e)}),rejected=assert.rejects(run,{name:'AbortError'});await tick();const cancel=f.session.interrupt();
 f.emit('item/agentMessage/delta',{turnId:'turn1',itemId:'old',delta:'ANSWER: unwanted'});f.emit('turn/completed',{turn:{id:'turn1',status:'interrupted'}});await cancel;await rejected;assert.equal(events.length,0);
});
test('natural completion racing with interruption also safely ends the obsolete turn',async t=>{
 const f=fixture(t,{terminal:false});const run=f.session.run(options),rejected=assert.rejects(run,{name:'AbortError'});await tick();const cancel=f.session.interrupt();f.finish();await cancel;await rejected;assert.equal(f.connections[0].closed,false);
});
test('Stop during interruption closes the transport and does not preserve it',async t=>{
 const f=fixture(t,{terminal:false}),controller=new AbortController();const run=f.session.run({...options,signal:controller.signal}),rejected=assert.rejects(run,{name:'AbortError'});await tick();const cancel=f.session.interrupt();controller.abort();await cancel;await rejected;assert.equal(f.connections[0].closed,true);
});
test('spoken replacement requires an explicit interviewer retraction',()=>{
 assert.deepEqual(questionReplacement('Actually, forget that question. What did you learn?','system'),{question:'What did you learn?'});
 assert.deepEqual(questionReplacement('Scratch that.','system'),{question:''});
 assert.deepEqual(questionReplacement('Let me rephrase: why did you stay?','system'),{question:'why did you stay?'});
 for(const [text,source] of [['Actually, why did you stay?','system'],['What happened when they said forget that?','system'],['Let me rephrase that. Why?','mic'],['Forget thatcher for now.','system']])assert.equal(questionReplacement(text,source),null);
});
async function uiFixture(t){
 const streams=[],sent=[],cancels=[];let cancelGate;
 const app=await renderer({fetch:async(url,init)=>{
  if(url==='/api/answer'){const s=channel();streams.push(s);sent.push(JSON.parse(init.body));init.signal.addEventListener('abort',()=>s.error(new DOMException('Stopped','AbortError')),{once:true});s.send({type:'accepted'});return s.response;}
  if(url==='/api/answer/interrupt'){cancels.push(JSON.parse(init.body));if(cancelGate)await cancelGate;streams[cancels.length-1].close();return Response.json({interrupted:true});}
 }});t.after(()=>app.close());await app.run('connect()');
 return {app,streams,sent,cancels,holdCancel:()=>{let resolve;cancelGate=new Promise(r=>resolve=r);return resolve;},finish:(index,text='ANSWER: Replacement answer.')=>{streams[index].send({type:'answer',text});streams[index].send({type:'done'});streams[index].close();}};
}
test('typed correction replaces streaming work and restores the previous complete answer',async t=>{
 const f=await uiFixture(t);f.app.run('raw="ANSWER: Earlier complete answer.";render()');const first=f.app.run('localAnswer({question:"Old question?"})');await tick();f.streams[0].send({type:'answer',text:'ANSWER: Obsolete partial.',streaming:true});await tick();
 const release=f.holdCancel();const replacement=f.app.run('replaceQuestion({question:"Corrected question?",autoDetect:false})');assert.equal(f.app.el('answer').textContent,'Earlier complete answer.');await tick();f.streams[0].send({type:'answer',text:'ANSWER: Late obsolete text.',streaming:true});await tick();assert.equal(f.app.el('answer').textContent,'Earlier complete answer.');release();await first;await tick();assert.equal(f.sent[1].question,'Corrected question?');f.finish(1);await replacement;
 assert.equal(f.app.el('answer').textContent,'Replacement answer.');assert.equal(f.app.run('answerArchive.length'),1);assert.doesNotMatch(f.app.run('JSON.stringify(localHistory)'),/Obsolete|Old question/);
});
test('two rapid corrections generate only the latest and cancel only once',async t=>{
 const f=await uiFixture(t),first=f.app.run('localAnswer({question:"Original?"})');await tick();const release=f.holdCancel();const second=f.app.run('replaceQuestion({question:"Correction one?"})');const third=f.app.run('replaceQuestion({question:"Correction two?"})');await tick();release();await first;await second;await tick();assert.equal(f.cancels.length,1);assert.equal(f.sent.length,2);assert.equal(f.sent[1].question,'Correction two?');f.finish(1);await third;
});
test('Stop while correcting never starts the replacement',async t=>{
 const f=await uiFixture(t),first=f.app.run('localAnswer({question:"Original?"})');await tick();const release=f.holdCancel();const next=f.app.run('replaceQuestion({question:"Correction?"})');await tick();f.app.run('stop()');release();await Promise.all([first,next]);assert.equal(f.sent.length,1);assert.equal(f.app.run('connected'),false);
});
test('correct-question editor prefills the question, holds reading, and Cancel restores it',async t=>{
 const f=await uiFixture(t),first=f.app.run('localAnswer({question:"What did you build?"})');await tick();f.finish(0);await first;f.app.el('correctQuestion').click();assert.equal(f.app.el('typedQuestion').value,'What did you build?');assert.equal(f.app.run('editingQuestion'),true);assert.equal(f.app.run('reader.held'),true);f.app.el('cancelQuestionEdit').click();assert.equal(f.app.run('reader.held'),false);assert.equal(f.app.el('typedForm').hidden,true);
});
test('a new question arriving during editing is held until Cancel',async t=>{
 const f=await uiFixture(t);f.app.run('settings.source="both";openQuestionEditor(true);onSpeechText({text:"What happened next?",source:"system",final:true})');await tick();assert.equal(f.sent.length,0);assert.equal(f.app.run('pendingQuestions.length'),1);f.app.el('cancelQuestionEdit').click();await tick();assert.equal(f.sent[0].question,'What happened next?');f.finish(0);await tick();
});
test('a spoken retraction without a replacement waits instead of inventing a new question',async t=>{
 const f=await uiFixture(t),first=f.app.run('localAnswer({question:"Original?"})');await tick();f.app.run('settings.source="both";onSpeechText({text:"Actually, forget that question.",source:"system",final:true})');await first;await tick();assert.equal(f.sent.length,1);assert.equal(f.app.run('latestSpeechText'),'');assert.match(f.app.el('statusText').textContent,/Waiting/);
});
test('candidate rephrasing does not interrupt the interviewer answer',async t=>{
 const f=await uiFixture(t),first=f.app.run('localAnswer({question:"Original?"})');await tick();f.app.run('settings.source="both";onSpeechText({text:"Let me rephrase that. I owned the launch.",source:"mic",final:true})');await tick();assert.equal(f.cancels.length,0);f.finish(0);await first;
});
test('HTTP interruption is scoped to the exact request and session; the next answer starts immediately',async t=>{
 let finish,calls=0,interrupts=0;
 const local={capabilities:()=>({}),check:async()=>{},answer:async(data,emit)=>{calls++;if(calls===1)await new Promise(r=>finish=r);else emit({type:'answer',text:'ANSWER: Recovered.'});},interrupt:async()=>{interrupts++;finish();return true;}};
 const server=createApp({local});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const origin=`http://127.0.0.1:${server.address().port}`,config=await fetch(origin+'/api/config'),cookie=config.headers.get('set-cookie').split(';')[0];
 const call=(path,data)=>fetch(origin+path,{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-Cue-Client':'1','Content-Type':'application/json'},body:JSON.stringify(data)});
 const {sessionId}=await(await call('/api/codex/check',{profile:'Synthetic facts for testing only.',style:'script'})).json();
 const data={requestId:'old',question:'Question?',profile:'Synthetic facts for testing only.',style:'script'};const first=await call('/api/answer',data);
 for(const ref of [{requestId:'wrong',sessionId},{requestId:'old',sessionId:'wrong'}])assert.equal((await(await call('/api/answer/interrupt',ref)).json()).interrupted,false);
 assert.equal(interrupts,0);assert.equal((await(await call('/api/answer/interrupt',{requestId:'old',sessionId})).json()).interrupted,true);assert.equal(interrupts,1);await first.text();
 const next=await call('/api/answer',{...data,requestId:'new'});assert.equal(next.status,200);assert.match(await next.text(),/Recovered/);
 assert.equal((await(await call('/api/answer/interrupt',{requestId:'old',sessionId})).json()).interrupted,false);
});

test('an explicitly submitted correction appears even while the microphone is active',async t=>{
 const f=await uiFixture(t);f.app.run('raw="ANSWER: Previous answer.";render();candidateSpeaking=true;openQuestionEditor(true)');
 f.app.el('typedQuestion').value='Corrected question?';f.app.el('typedForm').onsubmit({preventDefault(){}});await tick();f.finish(0);await tick();assert.equal(f.app.el('answer').textContent,'Replacement answer.');assert.equal(f.app.run('readyAnswer'),null);assert.equal(f.app.run('editingQuestion'),false);
});
