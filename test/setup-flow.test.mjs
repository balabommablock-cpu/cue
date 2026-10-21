import test from 'node:test';
import assert from 'node:assert/strict';
import {renderer} from '../test-support/renderer-harness.mjs';
test('personal setup saves reviewed notes and discards unsaved edits when closed',async()=>{
 const r=await renderer();await r.el('contextShortcut').click();assert.equal(r.el('setupDialog').open,true);
 r.el('profile').value='A confirmed new experience, with a specific outcome.';r.el('savePersonalContext').click();assert.equal(r.run('settings.profile'),'A confirmed new experience, with a specific outcome.');
 assert.equal(r.el('setupAIPanel').hidden,false);r.el('closeSetup').click();await r.el('contextShortcut').click();r.el('profile').value='unsaved replacement';r.el('closeSetup').click();assert.equal(r.el('profile').value,'A confirmed new experience, with a specific outcome.');r.close();
});
test('opening context during listening stops the session and keeps microphone off',async()=>{const r=await renderer();await r.el('startButton').click();assert.equal(r.run('connected'),true);await r.el('contextShortcut').click();assert.equal(r.run('connected'),false);assert.equal(r.run('connecting'),false);assert.equal(r.el('setupDialog').open,true);r.close();});
test('saved ChatGPT account selector sends the selected id before rerendering',async()=>{
 let selected='one';const accounts=[{id:'one',email:'one@example.test',label:'Account 1',sharing:false},{id:'two',email:'two@example.test',label:'Account 2',sharing:false}];
 const r=await renderer({native:{onShareState(){},onAction(){},ready(){},accountStatus:async()=>({ok:true,value:{id:selected,accounts,status:'disconnected',sharing:false}}),accountSelect:async id=>{selected=id;return {ok:true,value:{}};},protectCapture:async()=>true,status:async()=>({platform:'darwin',screen:'granted',microphone:'granted'})}});
 await r.el('aiShortcut').click();r.el('chatGPTAccount').value='two';await r.el('chatGPTAccount').onchange();assert.equal(selected,'two');assert.equal(r.el('chatGPTAccount').value,'two');r.close();
});

test('the full page has unique control IDs, including separate API and Realtime key fields',async()=>{const {readFile}=await import('node:fs/promises');const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);assert.ok(ids.includes('providerApiKey'));assert.ok(ids.includes('apiKey'));});
