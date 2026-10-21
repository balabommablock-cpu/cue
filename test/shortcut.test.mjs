import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStartController} from '../desktop-start.cjs';
import {renderer,tick} from '../test-support/renderer-harness.mjs';

test('cold-start shortcuts coalesce until the loaded interview is ready',()=>{
 const actions=[];let shown=0;const c=createStartController({show:()=>shown++,send:a=>actions.push(a)});
 c.request();c.request();assert.equal(actions.length,0);c.ready();assert.deepEqual(actions,['start-listening']);assert.equal(shown,3);
 c.ready();assert.equal(actions.length,1);c.request();assert.equal(actions.length,2);
 c.loading();c.ready();assert.equal(actions.length,2);
});
test('repeated shortcuts during startup do not toggle the connection off',async t=>{
 let release;const gate=new Promise(r=>release=r);const a=await renderer({fetch:async url=>{if(url==='/api/codex/check'){await gate;return Response.json({sessionId:'mock'});}}});t.after(()=>a.close());
 // Use a synthetic connect implementation: no microphone is captured by tests.
 a.run('connect=async()=>{connecting=true;await fetch("/api/codex/check");connecting=false;connected=true;}');
 const first=a.run('startFromShortcut()');await tick();await a.run('startFromShortcut()');assert.equal(a.requests.filter(x=>x.url==='/api/codex/check').length,1);
 release();await first;assert.equal(a.run('connected'),true);await a.run('startFromShortcut()');assert.equal(a.run('connected'),true);assert.equal(a.requests.filter(x=>x.url==='/api/codex/check').length,1);
});
test('shortcut resumes pause without restarting the model or stopping capture',async t=>{
 const a=await renderer();t.after(()=>a.close());a.run('connected=true;paused=true;settings.source="hybrid"');await a.run('startFromShortcut()');
 assert.equal(a.run('paused'),false);assert.equal(a.run('connected'),true);assert.equal(a.requests.some(x=>x.url==='/api/codex/check'),false);
});
test('shortcut leaves typed fallback and restores the chosen audio setup',async t=>{
 const a=await renderer();t.after(()=>a.close());a.run('settings.source="text";sourceBeforeText="hybrid";connect=async()=>{connected=true;}');await a.run('startFromShortcut()');
 assert.equal(a.run('settings.source'),'hybrid');assert.equal(a.run('connected'),true);assert.equal(a.el('audioSource').value,'hybrid');
});
