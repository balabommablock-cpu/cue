import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {CodexConnection,streamCodex} from '../codex-stream.mjs';
import {parseResponse} from '../public/core.js';
import {consumeAnswer} from '../public/answer-stream.js';

function fixture(t){
  const p=new EventEmitter();p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kills=0;p.kill=()=>{p.kills++;};
  const controller=new AbortController();const rpc=new CodexConnection('mock',{signal:controller.signal,spawnProcess:()=>p,timeout:5000});t.after(()=>rpc.close());
  return {rpc,p,controller};
}
test('stream transport decodes split JSON and multibyte characters',async t=>{
  const {rpc,p}=fixture(t);const job=rpc.call('example',{});const encoded=Buffer.from('{"id":1,"result":{"text":"₹40 crore"}}\n');
  const rupee=encoded.indexOf(Buffer.from('₹'));p.stdout.write(encoded.subarray(0,rupee+1));p.stdout.write(encoded.subarray(rupee+1));
  assert.equal((await job).text,'₹40 crore');
});
test('Stop cancels pending requests and kills the inference process',async t=>{
  const {rpc,p,controller}=fixture(t);const job=rpc.call('turn/start',{});controller.abort();await assert.rejects(job,/Stopped/);assert.equal(p.kills,1);assert.equal(rpc.closed,true);
});
test('provider approval requests are rejected rather than executed',async t=>{
  const {rpc,p}=fixture(t);let sent='';p.stdin.on('data',b=>sent+=b);const pending=rpc.call('turn/start',{});
  p.stdout.write('{"id":900,"method":"item/commandExecution/requestApproval","params":{}}\n');
  await assert.rejects(pending,/unsupported action/);assert.match(sent,/does not provide tools or approvals/);assert.equal(p.kills,1);
});
test('provider errors are redacted and early exit is a failure',async t=>{
  const {rpc,p}=fixture(t);const pending=rpc.call('turn/start',{});p.stdout.write('{"id":1,"error":{"message":"secret diagnostic content"}}\n');
  await assert.rejects(pending,e=>!e.message.includes('secret')&&e.message.includes('model access'));
  const next=rpc.call('turn/start',{});p.emit('close',1);await assert.rejects(next,/ended early/);
});
test('ephemeral writing session disables inherited connectors and streams only final answer',async()=>{
  const calls=[],updates=[];let closed=false;
  const fake={send:()=>{},close:()=>{closed=true;},call:async(method,params)=>{
    calls.push({method,params});
    if(method==='config/read')return {config:{mcp_servers:{privateConnector:{}},plugins:{'plugin@example':{}}}};
    if(method==='thread/start')return {thread:{id:'test-thread'}};
    if(method==='turn/start'){
      fake.onNotification('item/started',{threadId:'test-thread',item:{id:'thinking',type:'agentMessage',phase:'commentary'}});
      fake.onNotification('item/agentMessage/delta',{threadId:'test-thread',itemId:'thinking',delta:'Not answer text'});
      for(const phase of ['analysis','reasoning']){
        fake.onNotification('item/started',{threadId:'test-thread',item:{id:phase,type:'agentMessage',phase}});
        fake.onNotification('item/agentMessage/delta',{threadId:'test-thread',itemId:phase,delta:'ANSWER: Private thinking, not the final answer.'});
        fake.onNotification('item/completed',{threadId:'test-thread',item:{id:phase,type:'agentMessage',phase,text:'ANSWER: Private thinking, not the final answer.'}});
      }
      fake.onNotification('item/agentMessage/delta',{threadId:'other-thread',itemId:'other',delta:'Private unrelated text'});
      fake.onNotification('item/started',{threadId:'test-thread',item:{id:'answer',type:'agentMessage',phase:'final_answer'}});
      for(const delta of ['ANSWER: I ','built the product.'])fake.onNotification('item/agentMessage/delta',{threadId:'test-thread',itemId:'answer',delta});
      fake.onNotification('turn/completed',{threadId:'test-thread',turn:{status:'completed'}});
    }
    return {};
  }};
  const text=await streamCodex({command:'mock',cwd:'/tmp',instructionPath:'/tmp/rules',writingInstructions:'Grounded facts only.',prompt:'Question?',emit:e=>updates.push(e),connectionFactory:()=>fake});
  assert.equal(text,'ANSWER: I built the product.');assert.equal(updates.filter(e=>e.type==='answer').length,2);assert.equal(closed,true);
  const start=calls.find(x=>x.method==='thread/start').params;
  assert.equal(start.ephemeral,true);assert.equal(start.sandbox,'read-only');assert.equal(start.baseInstructions,'Grounded facts only.');
  assert.equal(start.config.mcp_servers.privateConnector.enabled,false);assert.equal(start.config.plugins['plugin@example'].enabled,false);
  const decoded=[];
  await consumeAnswer(new Response([...updates,{type:'done'}].map(e=>JSON.stringify(e)).join('\n')+'\n'),e=>decoded.push(e));
  assert.equal(decoded.at(-1).type,'done');
  const timing=decoded.find(e=>e.type==='timing');assert.equal(typeof timing.selection.model,'string');assert.ok(Object.values(timing.phases).every(Number.isFinite));
});
test('interrupted turns cannot be reported as completed answers',async()=>{
  let fake;
  fake={send:()=>{},close:()=>{},call:async(method)=>{
    if(method==='config/read')return {config:{}};
    if(method==='thread/start')return {thread:{id:'t'}};
    if(method==='turn/start'){fake.onNotification('item/agentMessage/delta',{threadId:'t',itemId:'a',delta:'ANSWER: Incomplete'});fake.onNotification('turn/completed',{threadId:'t',turn:{status:'interrupted'}});}
    return {};
  }};
  await assert.rejects(streamCodex({command:'mock',cwd:'/tmp',writingInstructions:'Rules',emit:()=>{},connectionFactory:()=>fake}),/did not complete/);
});
test('WAIT completes only for explicit conversation-detection requests',async()=>{
  function factory(){let rpc;rpc={send:()=>{},close:()=>{},call:async(method)=>{
    if(method==='config/read')return {config:{}};
    if(method==='thread/start')return {thread:{id:'t'}};
    if(method==='turn/start'){
      rpc.onNotification('item/agentMessage/delta',{threadId:'t',itemId:'a',delta:'WAIT: Candidate is answering.'});
      rpc.onNotification('turn/completed',{threadId:'t',turn:{status:'completed'}});
    }return {};
  }};return rpc;}
  const options={command:'mock',cwd:'/tmp',writingInstructions:'Rules',emit:()=>{},connectionFactory:factory};
  assert.match(await streamCodex({...options,allowWait:true}),/^WAIT:/);
  await assert.rejects(streamCodex(options),/did not complete/);
});
test('non-object provider events are ignored without crashing the transport',async t=>{
 const {rpc,p}=fixture(t),result=rpc.call('sample',{});for(const value of ['null','5','[]','"text"'])p.stdout.write(value+'\n');p.stdout.write('{"id":1,"result":{"ok":true}}\n');assert.equal((await result).ok,true);
});
test('provider output above the transport ceiling terminates the child',async t=>{
 const {rpc,p}=fixture(t),result=rpc.call('sample',{});p.stdout.write(Buffer.alloc(2_000_001,65));await assert.rejects(result,/too much data/);assert.equal(p.kills,1);
});
for(const text of ['ANSWER:','ANSWER:\nCHECK: No fact.','ANSWER: '+ 'a'.repeat(12001)])test('provider cannot complete an empty or excessive answer: '+text.slice(0,25),async()=>{
 let rpc;rpc={send(){},close(){},call:async method=>{
  if(method==='config/read')return {config:{}};if(method==='thread/start')return {thread:{id:'t'}};
  if(method==='turn/start'){rpc.onNotification('item/completed',{threadId:'t',item:{id:'a',type:'agentMessage',phase:'final_answer',text}});rpc.onNotification('turn/completed',{threadId:'t',turn:{status:'completed'}});}return {};
 }};
 await assert.rejects(streamCodex({command:'mock',cwd:'/tmp',writingInstructions:'Rules',emit:()=>{},connectionFactory:()=>rpc}),/complete|limit/);
});

function finalOnly(text,status='completed'){
 let rpc;rpc={send(){},close(){},call:async method=>{
  if(method==='config/read')return {config:{}};if(method==='thread/start')return {thread:{id:'t'}};
  if(method==='turn/start'){
   rpc.onNotification('item/completed',{threadId:'t',item:{id:'a',type:'agentMessage',phase:'final_answer',text}});
   rpc.onNotification('turn/completed',{threadId:'t',turn:{status}});
  }return {};
 }};return rpc;
}
test('completed exact JSON, code and translated text recover a missing ANSWER envelope without another generation',async()=>{
 for(const body of ['{"planet":"Mercury","moons":0}','def double(x):\n    return x * 2','मैं आपको कल फ़ोन करूँगा।']){
  const events=[];
  const text=await streamCodex({command:'mock',cwd:'/tmp',writingInstructions:'Rules',allowUnframed:true,emit:e=>events.push(e),connectionFactory:()=>finalOnly(body)});
  assert.equal(parseResponse(text).answer,body);assert.equal(events.filter(e=>e.type==='answer').at(-1).text,text);
 }
});
test('artifact recovery cannot convert empty, interrupted, failed or WAIT output into a successful answer',async()=>{
 for(const [body,status] of [['','completed'],['ANSWER:','completed'],['CHECK: Missing data.','completed'],['WAIT: Candidate speaking.','completed'],['{"x":1}','interrupted'],['{"x":1}','failed']]){
  await assert.rejects(streamCodex({command:'mock',cwd:'/tmp',writingInstructions:'Rules',allowUnframed:true,emit:()=>{},connectionFactory:()=>finalOnly(body,status)}),/did not complete/);
 }
 const waiting=await streamCodex({command:'mock',cwd:'/tmp',writingInstructions:'Rules',allowUnframed:true,allowWait:true,emit:()=>{},connectionFactory:()=>finalOnly('WAIT: Candidate speaking.')});assert.match(waiting,/^WAIT:/);
});
test('JSON strings containing reserved labels remain data, while separate CHECK notes remain private',()=>{
 const json=JSON.stringify({message:'Before CHECK: after',question:'QUESTION: literal text'});
 assert.equal(parseResponse('ANSWER:\n'+json).answer,json);assert.equal(parseResponse('ANSWER:\n'+json).check,'');
 const withNote=parseResponse('ANSWER: A supported answer.\nCHECK: Missing detail.');assert.equal(withNote.answer,'A supported answer.');assert.equal(withNote.check,'Missing detail.');
});
