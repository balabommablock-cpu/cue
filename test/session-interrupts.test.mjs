import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installSessionInterrupts} from '../session-interrupts.cjs';
for(const event of ['suspend','lock-screen'])test(event+' stops Share View and invalidates renderer capture',()=>{
 const powerMonitor=new EventEmitter(),sent=[];let stops=0;const dispose=installSessionInterrupts({powerMonitor,webContents:{isDestroyed:()=>false,send:(...args)=>sent.push(args)},shareView:{stop:()=>stops++}});
 powerMonitor.emit(event);assert.equal(stops,1);assert.deepEqual(sent,[['cue:action','system-interrupted']]);dispose();powerMonitor.emit(event);assert.equal(stops,1);
});
test('sleep after the window closes cannot send into destroyed web contents',()=>{
 const powerMonitor=new EventEmitter();const dispose=installSessionInterrupts({powerMonitor,webContents:{isDestroyed:()=>true,send:()=>assert.fail('Destroyed window')},shareView:{stop(){}}});powerMonitor.emit('suspend');dispose();assert.equal(powerMonitor.listenerCount('suspend'),0);
});
