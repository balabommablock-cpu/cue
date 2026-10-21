import {test} from 'node:test';
import assert from 'node:assert/strict';
import {answerOptions} from '../public/model-options.js';
import {renderer,channel,tick} from '../test-support/renderer-harness.mjs';
import {createApp} from '../server.mjs';

test('unsupported model, effort masquerading as speed and Ultrafast cannot reach inference',async t=>{
 let calls=0;const server=createApp({local:{capabilities:()=>({}),check:async()=>calls++}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const origin=`http://127.0.0.1:${server.address().port}`;
 for(const selection of [{answerModel:'flashlight'},{answerSpeed:'ultra'},{answerSpeed:'ultrafast'}]){
  for(const path of ['/api/codex/check','/api/answer']){
   const res=await fetch(origin+path,{method:'POST',headers:{Origin:origin,'X-Cue-Client':'1','Content-Type':'application/json'},body:JSON.stringify({profile:'A sufficient synthetic candidate fact sheet.',style:'script',question:'Why?',...selection})});
   assert.equal(res.status,400);assert.match((await res.json()).error,/Choose/);
  }
 }assert.equal(calls,0);
});
test('persisted model and speed reach both preparation and streamed answer requests',async t=>{
 const stream=channel();const ui=await renderer({prefs:{answerModel:'gpt-6-astra',answerSpeed:'default'},fetch:url=>url==='/api/answer'?stream.response:undefined});t.after(()=>ui.close());
 await ui.run('connect()');const pending=ui.run("localAnswer({question:'Why Example Program?'})");await tick();
 for(const url of ['/api/codex/check','/api/answer']){const data=JSON.parse(ui.requests.find(r=>r.url===url).init.body);assert.equal(data.answerModel,'gpt-6-astra');assert.equal(data.answerSpeed,'default');}
 stream.send({type:'answer',text:'ANSWER: A grounded reply.'});stream.send({type:'done'});stream.close();await pending;
});
test('changing a model stops the current session and saves selection for the next Start',async t=>{
 const ui=await renderer();t.after(()=>ui.close());await ui.run('connect()');ui.el('answerModel').value='gpt-6-luna';ui.el('answerSpeed').value='default';
 await ui.el('settingsForm').onsubmit({preventDefault(){}});await tick();assert.equal(ui.run('connected'),false);assert.equal(ui.run('settings.answerModel'),'gpt-6-luna');assert.ok(ui.requests.some(r=>r.url==='/api/codex/stop'));
 await ui.run('connect()');const data=JSON.parse(ui.requests.filter(r=>r.url==='/api/codex/check').at(-1).init.body);assert.equal(data.answerModel,'gpt-6-luna');assert.equal(data.answerSpeed,'default');
});
test('invalid stale preferences recover to tested defaults and Realtime hides Codex controls',async t=>{
 const ui=await renderer({prefs:{answerModel:'unavailable',answerSpeed:'ultrafast'}});t.after(()=>ui.close());assert.equal(ui.run('settings.answerModel'),'gpt-6-sol');assert.equal(ui.el('answerSpeed').value,'priority');
 assert.equal(answerOptions().effort,'low');ui.el('provider').value='realtime';ui.el('provider').onchange();assert.equal(ui.el('codexSettings').hidden,true);
});

test('talking points stream immediately, retain line breaks and keep fact checks separate',async t=>{
 const stream=channel(),ui=await renderer({fetch:url=>url==='/api/answer'?stream.response:undefined});t.after(()=>ui.close());
 await ui.run('connect()');const pending=ui.run("localAnswer({question:'Is this acquisition profitable?'})");await tick();
 assert.equal(JSON.parse(ui.requests.find(r=>r.url==='/api/answer').init.body).style,'cues');
 stream.send({type:'answer',text:'ANSWER: Acquisition loses ₹200 per customer.',streaming:true});await tick();
 assert.equal(ui.el('answer').textContent,'Acquisition loses ₹200 per customer.');
 stream.send({type:'answer',text:'ANSWER: Acquisition loses ₹200 per customer.\n• ₹400 contribution against ₹600 CAC.\n• Six paid months to recover CAC.\nCHECK: Hypothetical example only.',streaming:false});
 stream.send({type:'done'});stream.close();await pending;
 assert.match(ui.el('answer').textContent,/\n• ₹400 contribution/);assert.match(ui.el('answer').textContent,/\n• Six paid months/);
 assert.doesNotMatch(ui.el('answer').textContent,/CHECK|Hypothetical example/);
 assert.equal(ui.requests.filter(r=>r.url==='/api/answer').length,1);
 assert.equal(ui.requests.filter(r=>r.url==='/api/coach/live').length,0);
});

test('existing explicit paragraph preference survives the new talking-points default',async t=>{
 const ui=await renderer({prefs:{style:'script'}});t.after(()=>ui.close());await ui.run('connect()');
 assert.equal(ui.run('settings.style'),'script');assert.equal(JSON.parse(ui.requests.find(r=>r.url==='/api/codex/check').init.body).style,'script');
});
