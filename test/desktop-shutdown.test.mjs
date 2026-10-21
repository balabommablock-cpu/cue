import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installRendererRecovery} from '../desktop-lifecycle.cjs';

// Electron invalidates BrowserWindow.webContents after the final window closes.
// Keep this fixture faithful to that getter, rather than a permanently live object.
test('recovery cleanup after the window is destroyed does not access its native getter',()=>{
  const wc=new EventEmitter();let destroyed=false;
  const win={isDestroyed:()=>destroyed,get webContents(){if(destroyed)throw new TypeError('Object has been destroyed');return wc;}};
  const dispose=installRendererRecovery({win,server:{},shareView:{stop(){}},dialog:{},quit(){}});
  destroyed=true;
  assert.doesNotThrow(()=>{dispose();dispose();});
  assert.equal(wc.listenerCount('render-process-gone'),0);
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('closing during a pending recovery dialog neither reloads nor quits again',async()=>{
  const wc=new EventEmitter();let destroyed=false,choose,quits=0;
  wc.reload=()=>assert.fail('a closed window must not reload');
  const win={isDestroyed:()=>destroyed,get webContents(){if(destroyed)throw new TypeError('Object has been destroyed');return wc;}};
  const dispose=installRendererRecovery({win,server:{disposeLocal(){}},shareView:{stop(){}},dialog:{showMessageBox:()=>new Promise(resolve=>{choose=resolve;})},quit(){quits++;}});
  wc.emit('render-process-gone');destroyed=true;dispose();choose({response:0});await tick();
  assert.equal(quits,0);
});
test('a rejected recovery dialog is reported and quits safely without an unhandled rejection',async()=>{
  const wc=new EventEmitter(),events=[];
  const dispose=installRendererRecovery({win:{webContents:wc,isDestroyed:()=>false},server:{disposeLocal(){}},shareView:{stop(){}},dialog:{showMessageBox:async()=>{throw new Error('Dialog unavailable');}},onError:(name,error)=>events.push([name,error.message]),quit:()=>events.push('quit')});
  wc.emit('render-process-gone');await tick();dispose();
  assert.deepEqual(events,[['renderer-recovery','Dialog unavailable'],'quit']);
});
test('dialog rejection after close is handled without trying to quit a second time',async()=>{
  const wc=new EventEmitter();let reject,quits=0;const errors=[];
  const dispose=installRendererRecovery({win:{webContents:wc,isDestroyed:()=>false},server:{disposeLocal(){}},shareView:{stop(){}},dialog:{showMessageBox:()=>new Promise((_,r)=>{reject=r;})},onError:name=>errors.push(name),quit:()=>quits++});
  wc.emit('render-process-gone');dispose();reject(new Error('Window closed'));await tick();
  assert.equal(quits,0);assert.deepEqual(errors,['renderer-recovery']);
});
const {createShutdown}=await import('../desktop-lifecycle.cjs');
test('window close and app quit perform cleanup only once, in the declared order',()=>{
  const events=[];
  const shutdown=createShutdown(['listeners','shortcuts','sharing','providers','connections','server'].map(name=>[name,()=>events.push(name)]),{onPhase:phase=>events.push(phase)});
  shutdown();shutdown();shutdown();
  assert.deepEqual(events,['shutdown-start','listeners','shortcuts','sharing','providers','connections','server','shutdown-complete']);
});
test('a failed cleanup step is reported but remaining resources still close',()=>{
  const events=[];
  const shutdown=createShutdown([['listeners',()=>{throw new Error('bad listener');}],['providers',()=>events.push('providers stopped')],['server',()=>events.push('server closed')]],{onError:(name,error)=>events.push([name,error.message])});
  assert.doesNotThrow(shutdown);shutdown();
  assert.deepEqual(events,[['listeners','bad listener'],'providers stopped','server closed']);
});
test('reentrant shutdown from a close callback cannot repeat cleanup',()=>{
  const events=[];let shutdown;
  shutdown=createShutdown([['server',()=>{events.push('server');shutdown();}],['last',()=>events.push('last')]]);
  shutdown();assert.deepEqual(events,['server','last']);
});
