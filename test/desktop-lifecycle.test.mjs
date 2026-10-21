import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installRendererRecovery,windowBounds} from '../desktop-lifecycle.cjs';
for(const area of [{x:0,y:25,width:1920,height:1055},{x:0,y:0,width:640,height:480},{x:-1366,y:0,width:1366,height:768},{x:0,y:0,width:480,height:400}])test('window remains visible in '+JSON.stringify(area),()=>{const b=windowBounds(area);assert.ok(b.x>=area.x&&b.y>=area.y);assert.ok(b.x+b.width<=area.x+area.width);assert.ok(b.y+b.height<=area.y+area.height);});
test('renderer crash closes inference and sharing, coalesces duplicate events, and reloads once',async()=>{
 const wc=new EventEmitter(),events=[];let choose;wc.reload=()=>events.push('reload');const win={webContents:wc,isDestroyed:()=>false};
 const dispose=installRendererRecovery({win,server:{disposeLocal:()=>events.push('provider stopped')},shareView:{stop:()=>events.push('sharing stopped')},dialog:{showMessageBox:()=>new Promise(r=>choose=r)},quit:()=>events.push('quit')});wc.emit('render-process-gone');wc.emit('render-process-gone');assert.deepEqual(events,['provider stopped','sharing stopped']);choose({response:0});await new Promise(r=>setImmediate(r));assert.deepEqual(events,['provider stopped','sharing stopped','reload']);dispose();assert.equal(wc.listenerCount('render-process-gone'),0);
});
test('closing Cue while crash dialog is pending cannot reload a destroyed window',async()=>{
 const wc=new EventEmitter();let choose;wc.reload=()=>assert.fail('reloaded');const dispose=installRendererRecovery({win:{webContents:wc,isDestroyed:()=>false},server:{disposeLocal(){}},shareView:{stop(){}},dialog:{showMessageBox:()=>new Promise(r=>choose=r)},quit:()=>assert.fail('quit')});wc.emit('render-process-gone');dispose();choose({response:0});await new Promise(r=>setImmediate(r));
});
