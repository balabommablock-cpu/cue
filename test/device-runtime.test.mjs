import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntime} from '../device-src/runtime.js';
import {consumeAnswer} from '../public/answer-stream.js';
function fixture(){
  const messages=[];let current=0,max=0;
  const brain={ready:false,load:async()=>{brain.ready=true;},dispose:()=>{brain.ready=false;},interrupt(){},async answer(m,onText){current++;max=Math.max(max,current);messages.push(m);await new Promise(r=>setTimeout(r,15));onText('A clear opening.\n- One useful cue');current--;}};
  const speech={ready:false,async load(){speech.ready=true;},dispose(){speech.ready=false;},async transcribe(audio){assert.equal(audio.length,2);return 'What is a prototype?';}};
  return {brain,messages,max:()=>max,runtime:createRuntime({brainFactory:()=>brain,speechFactory:()=>speech,deviceCheck:async()=>({ok:true})})};
}
const read=async response=>{const events=[];await consumeAnswer(response,e=>events.push(e));return events;};
test('local runtime prepares models, emits compatible events and excludes biography on general questions',async()=>{
  const f=fixture();await f.runtime.prepare();
  const e=await read(f.runtime.answerResponse({question:'What is a prototype?',profile:'A private biography not relevant here.',requestId:'a'}));
  assert.equal(e[0].type,'accepted');assert.equal(e.at(-1).type,'done');assert.match(e.find(x=>x.type==='answer').text,/^ANSWER:\n/);
  assert.doesNotMatch(JSON.stringify(f.messages),/private biography/);
});
test('local runtime selects personal context and keeps inference serialized',async()=>{
  const f=fixture();await f.runtime.prepare();
  await Promise.all([read(f.runtime.answerResponse({question:'Tell me about a time you improved support',profile:'I reduced response time to four hours.',requestId:'one'})),read(f.runtime.answerResponse({question:'What is a database?',requestId:'two'}))]);
  assert.match(JSON.stringify(f.messages[0]),/four hours/);assert.doesNotMatch(JSON.stringify(f.messages[1]),/four hours/);assert.equal(f.max(),1);
});
test('local audio is decoded correctly and candidate speech can preserve the current answer',async()=>{
  const f=fixture();await f.runtime.prepare();assert.equal(await f.runtime.transcribe('AID/fw=='),'What is a prototype?');
  const e=await read(f.runtime.answerResponse({question:'What I did was redesign the workflow.',autoDetect:true}));
  assert.match(e.find(x=>x.type==='answer').text,/^WAIT:/);assert.equal(f.messages.length,0);
});
test('cancelled and stopped local requests cannot revive a queued answer',async()=>{
  const f=fixture();await f.runtime.prepare();const c=new AbortController();c.abort();
  const response=f.runtime.answerResponse({question:'What is a prototype?'},c.signal);assert.equal(await response.text(),'');
  const response2=f.runtime.answerResponse({question:'What is a prototype?'});f.runtime.stop();
  const body=await response2.text();assert.doesNotMatch(body,/"type":"answer"/);
});
test('local evidence excludes unconfirmed application stories and keeps the end of a long fact sheet',async()=>{
  const f=fixture();await f.runtime.prepare();
  const profile='Earlier unrelated background.\n\n'.repeat(700)+'\n\nI reduced support response time to four hours.';
  const records=Array.from({length:24},(_,i)=>({kind:'fact',title:'Other work '+i,text:'An unrelated event.'}));
  records.unshift({kind:'application',title:'Support',text:'I magically eliminated all support requests.'});
  await read(f.runtime.answerResponse({question:'Tell me about a time you improved support response time',profile,knowledge:{records}}));
  assert.doesNotMatch(JSON.stringify(f.messages),/magically/);assert.match(JSON.stringify(f.messages),/four hours/);
});
test('unknown personal experience does not receive unrelated general conversation as evidence',async()=>{
  const f=fixture();await f.runtime.prepare();
  await read(f.runtime.answerResponse({question:'What is photosynthesis?',profile:'Confidential career details.',history:[{question:'Tell me about yourself',answer:'ANSWER: Confidential career details.'}]}));
  assert.doesNotMatch(JSON.stringify(f.messages),/Confidential career/);
});

test('cancelling setup while the GPU check is pending cannot load a model or emit ready later',async()=>{
 let resolveCheck,loads=0;const progress=[];
 const runtime=createRuntime({progress:p=>progress.push(p),deviceCheck:()=>new Promise(r=>resolveCheck=r),brainFactory:()=>({ready:false,load:async()=>{loads++;},dispose(){},interrupt(){}}),speechFactory:()=>({dispose(){}})});
 const work=runtime.prepare();runtime.cancelSetup();resolveCheck({ok:true});await assert.rejects(work,{name:'AbortError'});assert.equal(loads,0);assert.equal(progress.some(p=>p.kind==='ready'),false);
});

test('changing local models cancels an unfinished load and lets the new selection finish',async()=>{
 let cancel,loads=[];const progress=[];
 const brain={ready:false,load(model){loads.push(model);if(model==='strong')return new Promise((_r,reject)=>{cancel=()=>reject(new DOMException('Cancelled','AbortError'));});brain.ready=true;return Promise.resolve();},dispose(){brain.ready=false;cancel?.();cancel=null;},interrupt(){}};
 const runtime=createRuntime({progress:p=>progress.push(p),brainFactory:()=>brain,speechFactory:()=>({ready:true,dispose(){}}),deviceCheck:async()=>({ok:true})});
 const old=runtime.prepare({model:'strong',audio:false});const rejected=assert.rejects(old,{name:'AbortError'});await new Promise(r=>setImmediate(r));
 await runtime.prepare({model:'light',audio:false});await rejected;assert.deepEqual(loads,['strong','light']);assert.equal(runtime.status().model,'light');assert.equal(runtime.status().answer,true);assert.equal(progress.filter(p=>p.kind==='ready').length,1);
});

test('simultaneous setup requests for one model share the load',async()=>{
 let loads=0,finish;const brain={ready:false,load:async()=>{loads++;await new Promise(r=>finish=r);brain.ready=true;},dispose(){},interrupt(){}};
 const runtime=createRuntime({brainFactory:()=>brain,speechFactory:()=>({ready:true}),deviceCheck:async()=>({ok:true})});
 const a=runtime.prepare({model:'light',audio:false}),b=runtime.prepare({model:'light',audio:false});await new Promise(r=>setImmediate(r));finish();await Promise.all([a,b]);assert.equal(loads,1);assert.equal(runtime.status().answer,true);
});
