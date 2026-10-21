import test from 'node:test';
import assert from 'node:assert/strict';
import {renderer,tick} from '../test-support/renderer-harness.mjs';
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

test('one local setup click prepares speech and the chosen model before switching provider',async()=>{
 const r=await renderer({prefs:{provider:'codex'}});
 r.run("deviceModule={}; deviceRuntime={prepare:async options=>{window.prepared=options;window.localReady=true;},status:()=>({answer:!!window.localReady,speech:!!window.localReady,model:'light'})};");
 await r.el('aiShortcut').click();assert.equal(r.el('aiChoices').open,false);r.el('chooseLocal').click();r.el('simpleLocalModel').value='light';
 await r.el('useLocal').click();assert.deepEqual(JSON.parse(r.run('JSON.stringify(window.prepared)')),{model:'light',audio:true});assert.equal(r.run('settings.provider'),'device');assert.equal(r.el('setupTestPanel').hidden,false);assert.equal(r.run('read("devicePrepared",false)'),true);assert.equal(r.run('connected'),false);r.close();
});

test('failed local setup leaves the working provider selected and shows the error',async()=>{
 const r=await renderer({prefs:{provider:'codex'}});
 r.run("deviceModule={}; deviceRuntime={prepare:async()=>{throw new Error('Not enough graphics memory. Try the smaller model.');},status:()=>({answer:false,speech:false})};");
 await r.el('aiShortcut').click();r.el('chooseLocal').click();await r.el('useLocal').click();
 assert.equal(r.run('settings.provider'),'codex');assert.match(r.el('setupMessage').textContent,/smaller model/);assert.equal(r.el('useLocal').disabled,false);assert.equal(r.el('simpleLocalModel').disabled,false);assert.equal(r.run('read("devicePrepared",false)'),false);r.close();
});

test('closing a pending download aborts it and a late result cannot switch AI or mark setup ready',async()=>{
 const r=await renderer({prefs:{provider:'codex'}});
 r.run("deviceModule={}; deviceRuntime={prepare:async (_options,signal)=>{window.setupSignal=signal;await new Promise(resolve=>window.finishDownload=resolve);},status:()=>({answer:false,speech:false})};");
 await r.el('aiShortcut').click();r.el('chooseLocal').click();const work=r.el('useLocal').click();await tick();
 assert.equal(r.el('setupStepcontext').disabled,true);r.el('setupStepcontext').click();assert.equal(r.el('setupAIPanel').hidden,false);
 r.el('closeSetup').click();assert.equal(r.run('window.setupSignal.aborted'),true);r.run('window.finishDownload()');await work;
 assert.equal(r.run('settings.provider'),'codex');assert.equal(r.run('read("devicePrepared",false)'),false);assert.equal(r.el('setupDialog').open,false);r.close();
});

test('failed setup offers a smaller-model retry while preserving the saved context',async()=>{
 const r=await renderer({prefs:{provider:'codex'}});
 r.run("deviceModule={};deviceRuntime={prepare:async options=>{window.lastDownload=options.model;if(options.model!=='light')throw new Error('Not enough memory');window.ready=true;},status:()=>({answer:!!window.ready,speech:!!window.ready,model:window.lastDownload})};");
 await r.el('aiShortcut').click();r.el('chooseLocal').click();r.el('simpleLocalModel').value='strong';await r.el('useLocal').click();assert.equal(r.el('localRecovery').hidden,false);
 const profile=r.run('settings.profile');await r.el('retrySmallLocal').click();assert.equal(r.run('window.lastDownload'),'light');assert.equal(r.run('settings.profile'),profile);assert.equal(r.run('settings.provider'),'device');assert.equal(r.el('setupTestPanel').hidden,false);r.close();
});

test('unprepared AI cannot start a setup question, and choosing an audio source never starts recording',async()=>{
 const r=await renderer({prefs:{provider:'device'}});await r.el('aiShortcut').click();r.el('setupSteptest').click();
 assert.equal(r.el('trySetupQuestion').disabled,true);assert.equal(r.el('trySetupVoice').disabled,true);r.el('trySetupQuestion').click();assert.equal(r.run('connected'),false);
 r.el('setupAudioSource').value='mic';r.el('setupAudioSource').onchange();assert.equal(r.run('settings.source'),'mic');assert.equal(r.run('connected'),false);assert.equal(r.run('read("source","")'),'mic');r.close();
});

test('opening AI setup cancels background warmup and removes the stale loading notice',async()=>{
 const r=await renderer();r.run("warmAbort=new AbortController();window.warmSignal=warmAbort.signal;notice('Loading your saved local AI…');");
 await r.el('aiShortcut').click();assert.equal(r.run('window.warmSignal.aborted'),true);assert.equal(r.el('notice').textContent,'');assert.equal(r.run('connected'),false);r.close();
});

test('invalid saved setup steps recover to context instead of a blank screen',async()=>{
 const r=await renderer({prefs:{provider:'device',setupStep:'invalid'}});await r.run("personalSetup.open('invalid')");assert.equal(r.el('setupContextPanel').hidden,false);assert.equal(r.el('setupAIPanel').hidden,true);r.el('closeSetup').click();r.close();
});

test('cancelled local setup clears the preparing badge after an asynchronous cleanup',async()=>{
 const r=await renderer({prefs:{provider:'device'}});
 r.run("deviceModule={};window.pendingSetup=false;deviceRuntime={prepare:async()=>{window.pendingSetup=true;await new Promise(resolve=>window.endPending=resolve);window.pendingSetup=false;},status:()=>({answer:false,loading:window.pendingSetup,model:'light'})};");
 await r.el('aiShortcut').click();const work=r.el('useLocal').click();await tick();r.el('closeSetup').click();r.run('window.endPending()');await work;
 assert.doesNotMatch(r.el('aiShortcut').textContent,/preparing/);assert.match(r.el('aiShortcut').textContent,/set up/);r.close();
});
