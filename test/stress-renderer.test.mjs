import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderer,channel,tick} from '../test-support/renderer-harness.mjs';

test('Cancel during configuration fetch cannot reconnect later',async t=>{
 let pending=false;const releases=[];const app=await renderer({fetch:url=>url==='/api/config'&&pending?new Promise(r=>releases.push(r)):undefined});t.after(()=>app.close());
 pending=true;const start=app.run('connect()');await tick();app.run('connect()');await tick();for(const release of releases)release(Response.json({localAudioAvailable:true}));await tick();
 assert.equal(app.run('connected'),false);assert.equal(app.run('connecting'),false);await start;
});

test('Stop during model streaming ignores every late chunk',async t=>{
 const stream=channel(),app=await renderer({fetch:url=>url==='/api/answer'?stream.response:undefined});t.after(()=>app.close());
 await app.run('connect()');const answer=app.run('localAnswer({question:"First question?"})');await tick();
 stream.send({type:'answer',text:'ANSWER: First draft.',streaming:true});await tick();app.run('stop()');
 stream.send({type:'answer',text:'ANSWER: Stale text must not appear.',streaming:false});stream.send({type:'done'});stream.close();await answer;
 assert.equal(app.el('answer').textContent,'First draft.');assert.equal(app.run('connected'),false);
});

test('a broken stream restores the last complete answer and exposes retry',async t=>{
 const stream=channel(),app=await renderer({fetch:url=>url==='/api/answer'?stream.response:undefined});t.after(()=>app.close());await app.run('connect()');
 app.run('raw="ANSWER: The last complete answer.";render()');const answer=app.run('localAnswer({question:"Next question?"})');await tick();
 stream.send({type:'answer',text:'ANSWER: An unfinished',streaming:true});stream.close();await answer;
 assert.equal(app.el('answer').textContent,'The last complete answer.');assert.match(app.el('notice').textContent,/early|complete/);assert.equal(app.el('retryAnswer').hidden,false);
});

test('WAIT and candidate speech preserve the visible answer without spending another model call',async t=>{
 const stream=channel(),app=await renderer({fetch:url=>url==='/api/answer'?stream.response:undefined});t.after(()=>app.close());await app.run('connect()');
 app.run('settings.source="both";raw="ANSWER: Keep this answer.";render()');
 app.run('onSpeechText({text:"Why did I choose that? Because customers wanted it.",source:"mic",final:true})');await tick();
 assert.equal(app.requests.filter(r=>r.url==='/api/answer').length,0);
 const answer=app.run('localAnswer({question:"Thanks.",autoDetect:true})');await tick();stream.send({type:'answer',text:'WAIT: Acknowledgement.'});stream.send({type:'done'});stream.close();await answer;
 assert.equal(app.el('answer').textContent,'Keep this answer.');
});

test('one-word-at-a-time and Unicode response chunks render only the answer body',async t=>{
 const stream=channel(),app=await renderer({fetch:url=>url==='/api/answer'?stream.response:undefined});t.after(()=>app.close());await app.run('connect()');
 const answer=app.run('localAnswer({question:"What did you build?"})');await tick();
 const text='QUESTION: What did you build?\nANSWER: I launched it. ₹40 crore.\nCHECK: Confirm date.';
 for(let i=1;i<=text.length;i++)stream.send({type:'answer',text:text.slice(0,i),streaming:true});stream.send({type:'done'});stream.close();await answer;
 assert.equal(app.el('answer').textContent,'I launched it. ₹40 crore.');assert.equal(app.el('check').hidden,false);assert.equal(app.run('answerArchive.length'),1);
});

test('the current answer stays stable while the candidate speaks; the next answer appears after a quiet interval',async t=>{
 const stream=channel(),app=await renderer({fetch:url=>url==='/api/answer'?stream.response:undefined});t.after(()=>app.close());await app.run('connect()');
 app.run('raw="ANSWER: I am reading this answer.";render();candidateSpeaking=true;');
 const answer=app.run('localAnswer({question:"Follow-up?"})');await tick();stream.send({type:'answer',text:'ANSWER: Here is the follow-up.'});stream.send({type:'done'});stream.close();await answer;
 assert.equal(app.el('answer').textContent,'I am reading this answer.');assert.equal(app.el('showReadyAnswer').hidden,false);
 app.run('finishSpeaking()');await app.advance(1600);assert.equal(app.el('answer').textContent,'Here is the follow-up.');assert.equal(app.el('showReadyAnswer').hidden,true);
});
test('manual scroll position holds the current answer until Show next is chosen',async t=>{
 const stream=channel(),app=await renderer({fetch:url=>url==='/api/answer'?stream.response:undefined});t.after(()=>app.close());await app.run('connect()');
 app.run('raw="ANSWER: Current answer.";render();reader.hold();');const answer=app.run('localAnswer({question:"Follow-up?"})');await tick();stream.send({type:'answer',text:'ANSWER: Next answer.'});stream.send({type:'done'});stream.close();await answer;
 app.run('finishSpeaking()');await app.advance(1600);assert.equal(app.el('answer').textContent,'Current answer.');await app.el('showReadyAnswer').click();assert.equal(app.el('answer').textContent,'Next answer.');
});
test('Pause drops unfinished audio and queued questions; a model result waits for review',async t=>{
 const stream=channel(),app=await renderer({fetch:url=>url==='/api/answer'?stream.response:undefined});t.after(()=>app.close());await app.run('connect()');
 app.run('raw="ANSWER: Keep this.";render();settings.source="both"');const answer=app.run('localAnswer({question:"First?"})');await tick();
 app.run('onSpeechText({text:"What comes next?",source:"system",final:true})');app.el('pauseButton').click();assert.equal(app.run('pendingQuestions.length'),0);
 stream.send({type:'answer',text:'ANSWER: New result.'});stream.send({type:'done'});stream.close();await answer;assert.equal(app.el('answer').textContent,'Keep this.');assert.equal(app.el('statusText').textContent,'Paused');
});
test('multiple follow-ups during a slow answer preserve order and candidate speech cannot replace them',async t=>{
 const streams=[channel(),channel()],sent=[];const app=await renderer({fetch:(url,init)=>{if(url!=='/api/answer')return;sent.push(JSON.parse(init.body));return streams[sent.length-1].response;}});t.after(()=>app.close());await app.run('connect()');app.run('settings.source="both"');
 const first=app.run('localAnswer({question:"First?"})');await tick();
 for(const text of ['What failed during the launch?','And how did you recover?'])app.run(`onSpeechText({text:${JSON.stringify(text)},source:'system',final:true})`);
 app.run('onSpeechText({text:"I owned the launch and worked on the issue.",source:"mic",final:true})');
 streams[0].send({type:'answer',text:'ANSWER: First answer.'});streams[0].send({type:'done'});streams[0].close();await first;await tick();
 assert.equal(sent.length,2);assert.equal(sent[1].question,'What failed during the launch?\nAnd how did you recover?');assert.match(JSON.stringify(sent[1].history),/I owned the launch/);
 streams[1].send({type:'answer',text:'ANSWER: Follow-up answer.'});streams[1].send({type:'done'});streams[1].close();await tick();
});
test('microphone echo heard before computer audio cannot suppress the interviewer question',async t=>{
 const stream=channel(),app=await renderer({fetch:url=>url==='/api/answer'?stream.response:undefined});t.after(()=>app.close());await app.run('connect()');app.run('settings.source="both"');
 app.run('onSpeechText({text:"Tell me about yourself.",source:"mic",final:true});onSpeechText({text:"Tell me about yourself.",source:"system",final:true});');await tick();assert.equal(app.requests.filter(r=>r.url==='/api/answer').length,1);stream.send({type:'answer',text:'ANSWER: A response.'});stream.send({type:'done'});stream.close();await tick();
});
test('manual mode stores every question and Answer now does not wait for another utterance',async t=>{
 const streams=[channel(),channel()],sent=[];const app=await renderer({fetch:(url,init)=>{if(url!=='/api/answer')return;sent.push(JSON.parse(init.body));return streams[sent.length-1].response;}});t.after(()=>app.close());await app.run('connect()');
 app.run('settings.auto=false;onSpeechText({text:"First question?",source:"system",final:true});onSpeechText({text:"Second question?",source:"system",final:true});generate();');await tick();assert.equal(sent[0].question,'First question?');assert.equal(sent[0].autoDetect,false);
 streams[0].send({type:'answer',text:'ANSWER: First.'});streams[0].send({type:'done'});streams[0].close();await tick();assert.equal(sent.length,1);app.run('generate()');await tick();assert.equal(sent[1].question,'Second question?');streams[1].send({type:'answer',text:'ANSWER: Second.'});streams[1].send({type:'done'});streams[1].close();await tick();
});
test('a failed request can be retried without restarting capture',async t=>{
 let calls=0;const app=await renderer({fetch:url=>{if(url!=='/api/answer')return;if(++calls===1)return Response.json({error:'Rate limited.'},{status:429});return new Response('{"type":"answer","text":"ANSWER: Recovered."}\n{"type":"done"}\n');}});t.after(()=>app.close());await app.run('connect()');
 await app.run('localAnswer({question:"Why?"})');assert.equal(app.el('retryAnswer').hidden,false);await app.el('retryAnswer').click();await tick();assert.equal(app.el('answer').textContent,'Recovered.');assert.equal(app.run('connected'),true);
});
test('a long simulated interview keeps only six context turns and twelve answer cards',async t=>{
 let calls=0;const app=await renderer({fetch:url=>url==='/api/answer'?new Response(JSON.stringify({type:'answer',text:'ANSWER: Turn '+(++calls)})+'\n{"type":"done"}\n'):undefined});t.after(()=>app.close());await app.run('connect()');
 for(let i=0;i<150;i++)await app.run(`localAnswer({question:'Question ${i}'})`);
 assert.equal(calls,150);assert.equal(app.run('localHistory.length'),6);assert.equal(app.run('answerArchive.length'),12);assert.equal(app.run('localBusy'),false);assert.equal(app.el('answer').textContent,'Turn 150');
});
test('a completed event without an answer reports failure instead of success',async t=>{
 const app=await renderer({fetch:url=>url==='/api/answer'?new Response('{"type":"done"}\n'):undefined});t.after(()=>app.close());await app.run('connect()');await app.run('localAnswer({question:"Why?"})');assert.equal(app.el('statusText').textContent,'Answer failed');assert.equal(app.run('answerArchive.length'),0);
});
test('a stalled answer times out, releases busy state and leaves a retry path',async t=>{
 const app=await renderer({fetch:(url,init)=>url==='/api/answer'?new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true})):undefined});t.after(()=>app.close());await app.run('connect()');
 const answer=app.run('localAnswer({question:"Why?"})');await tick();await app.advance(95000);await answer;assert.equal(app.run('localBusy'),false);assert.match(app.el('notice').textContent,/timed out/);assert.equal(app.el('retryAnswer').hidden,false);
});
test('an old request cannot change a new session after Stop and Start',async t=>{
 const old=channel(),fresh=channel();let count=0;const app=await renderer({fetch:url=>url==='/api/answer'?(++count===1?old:fresh).response:undefined});t.after(()=>app.close());await app.run('connect()');
 const first=app.run('localAnswer({question:"Old?"})');await tick();app.run('stop()');await app.run('connect()');const second=app.run('localAnswer({question:"New?"})');await tick();
 old.send({type:'answer',text:'ANSWER: Old answer.'});old.send({type:'done'});old.close();await first;assert.equal(app.run('localBusy'),true);
 fresh.send({type:'answer',text:'ANSWER: New answer.'});fresh.send({type:'done'});fresh.close();await second;assert.equal(app.el('answer').textContent,'New answer.');assert.equal(app.run('answerArchive.length'),1);
});
test('Stop clears recording indicators as well as audio state',async t=>{
 const app=await renderer();t.after(()=>app.close());await app.run('connect()');app.run('stop()');assert.equal(app.el('readingState').textContent,'Recording off');assert.match(app.el('questionLabel').textContent,/RECORDING OFF/);assert.equal(app.el('micState').textContent,'Off');
});
test('Start after Stop shows the typed-session status instead of stale reader guidance',async t=>{
 const app=await renderer({prefs:{scrollMode:"voice"}});t.after(()=>app.close());await app.run('connect()');app.run('stop()');await app.run('connect()');assert.equal(app.run('connected'),true);assert.equal(app.el('readingState').textContent,'Typed session · recording off');
});
test('a delayed readback from the previous answer cannot advance the new answer',async t=>{
 const app=await renderer();t.after(()=>app.close());await app.run('connect()');
 app.run('settings.source="both";raw="ANSWER: I built the product with a small team and shipped the first version.";render();answerRevision=4;onSpeechText({text:"I built the product with a small team",source:"mic",final:false,answerRevision:3});');assert.equal(app.run('reader.cursor'),0);
 app.run('onSpeechText({text:"I built the product with a small team",source:"mic",final:false,answerRevision:4});');assert.ok(app.run('reader.cursor')>0);
});
test('manual scrolling prevents voice-follow movement until resumed',async t=>{
 const app=await renderer({prefs:{scrollMode:"voice"}});t.after(()=>app.close());app.run('raw="ANSWER: I built a trading platform with one developer. We broke down the work and delivered a useful experience.";render();reader.hold();reader.hear("We broke down the work and delivered a useful experience");');assert.equal(app.el('answerFrame').scrollTop,0);assert.equal(app.el('resumeFollow').hidden,false);
 app.el('resumeFollow').click();assert.ok(app.el('answerFrame').scrollTop>0);
});
test('clicking the script does not pause voice-follow',async t=>{
 const app=await renderer({prefs:{scrollMode:"voice"}});t.after(()=>app.close());app.run('raw="ANSWER: I built a trading platform with one developer and shipped the first version for our team.";render();');
 app.el('answerFrame').events.pointerdown({target:app.el('answerFrame'),clientX:100});
 app.run('reader.hear("I built a trading platform with one developer and shipped the first version for our team")');assert.equal(app.run('reader.held'),false);assert.ok(app.el('answerFrame').scrollTop>0);assert.equal(app.el('readingState').textContent,'Answer complete');
});
test('manual scrolling resumes on matching speech after the short hold expires',async t=>{
 const app=await renderer();t.after(()=>app.close());app.run('raw="ANSWER: I built a trading platform with one developer.";render();');
 app.el('answerFrame').events.wheel();assert.equal(app.run('reader.held'),true);
 app.run('reader.holdUntil=performance.now()-1;reader.hear("I built a trading platform with one developer")');assert.equal(app.run('reader.held'),false);assert.equal(app.el('resumeFollow').hidden,true);
});
test('a new answer restarts microphone segmentation so fresh reading is not labelled stale',async t=>{
 const app=await renderer();t.after(()=>app.close());
 app.run('var resets=0;segmenters=[{source:"mic",reset(){resets++;}},{source:"system",reset(){throw Error("Interviewer must not reset");}}];candidateSpeaking=true;resetReading();');
 assert.equal(app.run('resets'),1);assert.equal(app.run('candidateSpeaking'),false);assert.equal(app.run('answerRevision'),1);app.run('segmenters=[]');
});

test('voice-follow explains unavailable microphone or provider instead of appearing broken',async t=>{
 const app=await renderer({prefs:{scrollMode:"voice"}});t.after(()=>app.close());
 app.run('settings.source="system";reader.describe()');assert.match(app.el('readingState').textContent,/needs your microphone/);
 app.run('settings.source="both";reader.describe()');assert.equal(app.el('readingState').textContent,'Speak to follow');
 app.run('settings.provider="realtime";reader.describe()');assert.match(app.el('readingState').textContent,/steady scroll/);
});
test('Stop clears the last microphone transcript from the visible interface',async t=>{
 const app=await renderer();t.after(()=>app.close());app.run('settings.source="both";onSpeechText({text:"A candidate response",source:"mic",final:true})');
 assert.equal(app.el('heardLine').hidden,false);app.run('stop()');assert.equal(app.el('heardLine').textContent,'');assert.equal(app.el('heardLine').hidden,true);
});
