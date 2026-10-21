import test from 'node:test';
import assert from 'node:assert/strict';
import {renderer,tick} from '../test-support/renderer-harness.mjs';
function nativeApi(){
 let state={providers:{openai:{connected:true},anthropic:{connected:true}}},listener,selectedModel;
 const native={
  onShareState(){},onAction(){},ready(){},protectCapture:async()=>true,status:async()=>({platform:'darwin',screen:'granted',microphone:'granted'}),
  apiStatus:async()=>({ok:true,value:state}),
  apiModels:async p=>({ok:true,value:[{id:p+'-future',name:'Future model'}]}),
  apiCancelConnect:async()=>({ok:true,value:true}),apiInterrupt:async()=>({ok:true,value:true}),
  onApiAnswer:fn=>{listener=fn;return()=>listener=null;},
  apiAnswer:async d=>{selectedModel=d.model;listener?.({id:d.id,type:'delta',text:'A direct answer.'});return {ok:true,value:{text:'A direct answer.'}};},
 };
 return {native,model:()=>selectedModel};
}
test('a saved API connection starts a typed session without checking Codex or downloading speech',async t=>{
 const f=nativeApi(),r=await renderer({native:f.native,prefs:{provider:'openai','apiModel:openai':'custom-model',setupComplete:true}});t.after(()=>r.close());
 await r.el('startButton').click();assert.equal(r.run('connected'),true);assert.equal(r.run('usesText()'),true);
 assert.equal(r.requests.some(x=>x.url==='/api/codex/check'),false);
 assert.equal(r.el('setupDialog').open,false);
});
test('API answers stream through the actual reader and preserve the exact chosen model',async t=>{
 const f=nativeApi(),r=await renderer({native:f.native,prefs:{provider:'anthropic','apiModel:anthropic':'claude-custom',setupComplete:true}});t.after(()=>r.close());
 r.run("deviceModule={answerMessages:()=>[{role:'user',content:'Question'}]};deviceRuntime={status:()=>({speech:true})};localDevice=async()=>deviceRuntime;");
 await r.el('startButton').click();await r.run("localAnswer({question:'Give me a short answer?'})");await tick();
 assert.equal(f.model(),'claude-custom');assert.match(r.el('answer').textContent,/A direct answer/);
 assert.equal(r.requests.some(x=>x.url==='/api/answer'),false);
});
test('API setup keeps the last custom model, and closing clears a pasted credential',async t=>{
 const f=nativeApi(),r=await renderer({native:f.native,prefs:{provider:'openai','apiModel:openai':'my-fine-tune',setupComplete:true}});t.after(()=>r.close());
 await r.el('aiShortcut').click();await tick();assert.equal(r.el('setupAPI').hidden,false);assert.equal(r.el('setupLocal').hidden,true);
 assert.equal(r.el('apiModel').value,'my-fine-tune');
 r.el('providerApiKey').value='private draft';r.el('closeSetup').click();assert.equal(r.el('providerApiKey').value,'');
});
test('choosing a new model saves only its ID and switches the provider',async t=>{
 const f=nativeApi(),r=await renderer({native:f.native,prefs:{provider:'openai','apiModel:openai':'old-model',setupComplete:true}});t.after(()=>r.close());
 await r.el('aiShortcut').click();await tick();r.el('apiModel').value='custom:next';r.el('useApi').click();
 assert.equal(r.run("read('apiModel:openai','')"),'custom:next');assert.equal(r.run('settings.provider'),'openai');assert.equal(r.el('setupTestPanel').hidden,false);
});

test('the sample voice test prepares local transcription for API users without capturing live audio',async t=>{
 const f=nativeApi();const r=await renderer({native:f.native,prefs:{provider:'openai','apiModel:openai':'custom-model',setupComplete:true},fetch:async url=>url==='/sample-question.wav'?new Response(new Uint8Array([0])):undefined});t.after(()=>r.close());
 r.run("deviceModule={answerMessages:()=>[{role:'user',content:'Question'}]};deviceRuntime={prepareSpeech:async()=>{window.speechReady=true;},status:()=>({speech:!!window.speechReady}),transcribe:async()=>{if(!window.speechReady)throw new Error('Missing speech');return 'What is a prototype?';}};AudioContext=class{async decodeAudioData(){return {getChannelData:()=>new Float32Array(16)};}async close(){}};");
 await r.el('sampleButton').click();await tick();assert.equal(r.run('window.speechReady'),true);assert.equal(r.run('settings.source'),'text');assert.equal(!!r.run('capture'),false);assert.equal(r.requests.some(x=>x.url==='/sample-question.wav'),true);assert.match(r.el('answer').textContent,/A direct answer/);
});
