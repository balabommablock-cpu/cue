import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {ShareViewController} from '../share-view.cjs';

function fixture(options={}){
  const children=[], states=[];
  const controller=new ShareViewController({helperPath:'/test/ShareView',platform:'darwin',exists:()=>true,onState:s=>states.push(s),spawnProcess:()=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;child.kill=()=>{child.killed=true;};children.push(child);return child;
  },...options});
  return {controller,children,states,send:event=>children.at(-1).stdout.write(JSON.stringify(event)+'\n')};
}
test('permission request is never reported as live and remains actionable after helper closes',t=>{
  const f=fixture();t.after(()=>f.controller.stop());f.controller.start({displayID:1});f.send({state:'permission_required',message:'Allow recording'});
  assert.equal(f.controller.state.state,'permission_required');f.children[0].emit('close',0);assert.equal(f.controller.state.state,'permission_required');assert.equal(f.controller.child,null);
});
test('cancelled helper cannot revive or overwrite a replacement session',t=>{
  const f=fixture();t.after(()=>f.controller.stop());f.controller.start({displayID:1});const old=f.children[0];f.controller.stop();assert.ok(old.killed);
  f.controller.start({displayID:2});old.stdout.write('{"state":"live"}\n');old.emit('close',0);assert.equal(f.controller.state.state,'starting');
  f.send({state:'live',message:'Select this window'});assert.equal(f.controller.state.state,'live');
  f.send({state:'starting'});assert.equal(f.controller.state.state,'live');
});
test('fragmented status lines, malformed JSON and non-object values are handled safely',t=>{
  const f=fixture();t.after(()=>f.controller.stop());f.controller.start({displayID:1});const out=f.children[0].stdout;
  out.write('broken\nnull\n17\n{"state":"invisible"}\n{"sta');assert.equal(f.controller.state.state,'starting');out.write('te":"live","message":"Ready"}\n');assert.equal(f.controller.state.state,'live');
});
test('oversized helper output stops capture and cannot become a success',t=>{
  const f=fixture();t.after(()=>f.controller.stop());f.controller.start({displayID:1});f.children[0].stdout.write('x'.repeat(65000));assert.ok(f.children[0].killed);assert.equal(f.controller.state.state,'error');
});
test('missing helper and unsupported platforms do not spawn processes',()=>{
  for(const options of [{exists:()=>false},{platform:'win32'}]){const f=fixture(options);f.controller.start({displayID:1});assert.equal(f.children.length,0);assert.equal(f.controller.state.state,'error');}
});
test('duplicate start reuses the existing helper; crash is visible to the user',t=>{
  const f=fixture();t.after(()=>f.controller.stop());f.controller.start({displayID:1});f.controller.start({displayID:2});assert.equal(f.children.length,1);f.send({state:'live'});f.children[0].emit('close',1);assert.equal(f.controller.state.state,'error');assert.equal(f.controller.child,null);
});
test('a helper that never supplies frames or a permission result is stopped on timeout',async t=>{
  const f=fixture({startTimeout:10});t.after(()=>f.controller.stop());f.controller.start({displayID:1});await new Promise(resolve=>setTimeout(resolve,35));assert.ok(f.children[0].killed);assert.equal(f.controller.state.state,'error');
});
test('launch exceptions and invalid display IDs never escape as a false live state',()=>{
  const f=fixture({spawnProcess:()=>{throw new Error('unavailable')}});assert.equal(f.controller.start({displayID:1}).state,'error');assert.throws(()=>f.controller.start({displayID:NaN}),/Invalid display/);assert.equal(f.controller.child,null);
});
