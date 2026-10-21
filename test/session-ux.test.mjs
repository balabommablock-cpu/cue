import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderer,channel,tick} from '../test-support/renderer-harness.mjs';
import {ProgressView} from '../public/progress-ui.js';

test('first screen explains Start and hides question, reader and history until relevant',async t=>{
 const a=await renderer({prefs:{source:'both'}});t.after(()=>a.close());
 assert.equal(a.el('welcome').hidden,false);assert.equal(a.el('answerFrame').hidden,true);
 assert.equal(a.el('questionBlock').hidden,true);assert.equal(a.el('readingBar').hidden,true);assert.equal(a.el('historyButton').hidden,true);
 assert.equal(a.el('startButton').textContent,'Start listening');assert.match(a.el('homeBackground').textContent,/background is ready/);
});
test('typing from idle starts a text-only connection and Stop restores the saved audio choice',async t=>{
 const stream=channel();const a=await renderer({prefs:{source:'both'},fetch:url=>url==='/api/answer'?stream.response:undefined});t.after(()=>a.close());
 a.el('typeButton').click();a.el('typedQuestion').value='What did I personally own?';await a.el('typedForm').onsubmit({preventDefault(){}});await tick();
 const setup=JSON.parse(a.requests.find(r=>r.url==='/api/codex/check').init.body);
 assert.equal(setup.audio,false);assert.equal(setup.dual,false);assert.equal(a.run('settings.source'),'text');assert.equal(a.run('read("source")'),'both');
 assert.equal(a.el('questionBlock').hidden,false);assert.equal(a.el('welcome').hidden,false);
 stream.send({type:'answer',text:'ANSWER: I owned product delivery.'});stream.send({type:'done'});stream.close();await tick();
 assert.equal(a.el('welcome').hidden,true);assert.equal(a.el('answerFrame').hidden,false);assert.equal(a.el('historyButton').hidden,false);
 a.run('stop()');assert.equal(a.run('settings.source'),'both');assert.equal(a.el('startButton').textContent,'Start listening');
 assert.equal(a.el('answer').textContent,'I owned product delivery.');
});
test('cancelling automatic text startup never submits the pending question or changes audio preference',async t=>{
 let resolve,slow=false;const a=await renderer({prefs:{source:'both'},fetch:url=>url==='/api/config'&&slow?new Promise(r=>resolve=r):undefined});t.after(()=>a.close());slow=true;
 a.el('typedQuestion').value='Why?';const submit=a.el('typedForm').onsubmit({preventDefault(){}});await tick();a.el('startButton').click();resolve(Response.json({localAudioAvailable:true}));await submit;await tick();
 assert.equal(a.run('connected'),false);assert.equal(a.run('settings.source'),'both');assert.equal(a.requests.filter(r=>r.url==='/api/answer').length,0);
});
test('history is a separate read-only view and never replaces the live answer',async t=>{
 const a=await renderer();t.after(()=>a.close());a.run('raw="ANSWER: The current answer.";render();answerArchive=[{question:"An earlier question?",raw:"ANSWER: The earlier answer."}];syncArchive()');
 a.el('historyButton').click();assert.equal(a.el('historyDialog').open,true);assert.equal(a.el('answer').textContent,'The current answer.');
 const details=a.el('historyList').options[0];assert.equal(details.options[0].textContent,'An earlier question?');assert.equal(details.options[1].textContent,'The earlier answer.');
 a.el('closeHistory').click();assert.equal(a.el('historyDialog').open,false);
 a.run('connected=true;settings.source="text"');a.el('historyButton').click();assert.match(a.el('historyHelp').textContent,/Recording is off/);
 a.run('settings.source="both";paused=true');a.el('historyButton').click();assert.match(a.el('historyHelp').textContent,/Listening is paused/);
 a.run('paused=false');a.el('historyButton').click();assert.match(a.el('historyHelp').textContent,/Listening continues/);
});
test('resuming listening reveals the answer prepared during Pause without another button',async t=>{
 const a=await renderer();t.after(()=>a.close());await a.run('connect()');a.run('settings.source="both"');a.el('pauseButton').click();
 a.run('readyAnswer={question:"The new question?",raw:"ANSWER: The new answer."};answerArchive=[readyAnswer]');a.el('pauseButton').click();
 assert.equal(a.run('readyAnswer'),null);assert.equal(a.el('answer').textContent,'The new answer.');assert.equal(a.el('showReadyAnswer').hidden,true);
});
test('one progress message replaces duplicate stage descriptions',()=>{
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{setAttribute(){}});return elements.get(id);};let updates=0;
 const p=new ProgressView({$,every:()=>0,clear:()=>{},onChange:()=>updates++});p.set('draft','Preparing your answer…');assert.equal($('processLabel').textContent,'Preparing your answer');assert.equal($('processDetail').textContent,'');assert.equal(updates,1);
 p.set('error','The connection was lost.');assert.equal($('processDetail').textContent,'The connection was lost.');
});
test('a fresh Start clears the previous script but preserves it in answer history',async t=>{
 const a=await renderer({fetch:url=>url==='/api/answer'?new Response('{"type":"answer","text":"ANSWER: Earlier answer."}\n{"type":"done"}\n'):undefined});t.after(()=>a.close());
 await a.run('connect()');await a.run('localAnswer({question:"Earlier question?"})');a.run('stop()');await a.run('connect()');
 assert.equal(a.el('answer').textContent,'');assert.equal(a.el('welcome').hidden,false);assert.equal(a.el('questionBlock').hidden,true);
 assert.equal(a.run('answerArchive.length'),1);assert.equal(a.el('historyButton').hidden,false);
});
test('a preview is cleared when the real session starts',async t=>{
 const a=await renderer();t.after(()=>a.close());a.el('demoButton').click();assert.equal(a.el('welcome').hidden,true);await a.run('connect()');
 assert.equal(a.run('raw'),'');assert.equal(a.el('answerFrame').hidden,true);assert.equal(a.el('welcome').hidden,false);
});
test('completed Realtime answers enter history while failed answers do not',async t=>{
 const a=await renderer();t.after(()=>a.close());
 a.run('handleEvent({type:"response.created",response:{id:"r1"}});handleEvent({type:"response.output_text.delta",response_id:"r1",delta:"QUESTION: Why?\\nANSWER: A clear reason."});handleEvent({type:"response.done",response:{id:"r1",status:"completed"}})');
 assert.equal(a.run('answerArchive.length'),1);assert.equal(a.el('historyButton').hidden,false);
 a.run('handleEvent({type:"response.created",response:{id:"r2"}});handleEvent({type:"response.done",response:{id:"r2",status:"failed"}})');assert.equal(a.run('answerArchive.length'),1);
});
