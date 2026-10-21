import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalBrain,checkDevice} from '../device-src/models.js';

test('local setup verifies a generated answer before marking the model ready',async()=>{
  let request;const progress=[];
  const brain=new LocalBrain(p=>progress.push(p),{createWorker:()=>({terminate(){}}),createEngine:async()=>({interruptGenerate(){},chat:{completions:{async create(data){request=data;assert.equal(brain.ready,false);return {choices:[{message:{content:'Ready'}}]};}}}})});
  await brain.load('light');assert.equal(brain.ready,true);assert.equal(request.stream,false);assert.equal(request.max_tokens,24);assert.equal(request.extra_body.enable_thinking,false);assert.equal(progress.at(-1).stage,'verify');brain.dispose();
});
test('an empty verification answer releases the worker and never reports ready',async()=>{
  let terminated=false;
  const brain=new LocalBrain(()=>{},{createWorker:()=>({terminate(){terminated=true;}}),createEngine:async()=>({interruptGenerate(){},chat:{completions:{async create(){return {choices:[{message:{content:''}}]};}}}})});
  await assert.rejects(brain.load('light'),/returned no answer/);assert.equal(brain.ready,false);assert.equal(brain.loading,false);assert.equal(terminated,true);
});
test('cancelling while verifying cannot revive a disposed local model',async()=>{
  let resolve,started;const verifying=new Promise(r=>started=r);
  const brain=new LocalBrain(()=>{},{createWorker:()=>({terminate(){}}),createEngine:async()=>({interruptGenerate(){},chat:{completions:{create(){started();return new Promise(r=>resolve=r);}}}})});
  const loading=brain.load('light');await verifying;brain.dispose();resolve({choices:[{message:{content:'Ready'}}]});await assert.rejects(loading,/cancelled/);assert.equal(brain.ready,false);assert.equal(brain.loading,false);
});
test('invalid model selection fails before creating workers',async()=>{
  const brain=new LocalBrain(()=>{},{createWorker:()=>assert.fail('unexpected worker')});
  await assert.rejects(brain.load('unknown'),/available local models/);
});
test('GPU failures are actionable; storage estimates are optional',async()=>{
  assert.equal((await checkDevice({gpu:null,storage:null})).ok,false);
  assert.equal((await checkDevice({gpu:{requestAdapter:async()=>{throw new Error('driver');}},storage:null})).ok,false);
  assert.equal((await checkDevice({gpu:{requestAdapter:async()=>({features:new Set()})},storage:null})).ok,false);
  assert.equal((await checkDevice({gpu:{requestAdapter:async()=>({features:new Set(['shader-f16'])})},storage:{estimate:async()=>{throw new Error('unavailable');}}})).ok,true);
});
