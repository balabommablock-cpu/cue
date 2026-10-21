import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SpeechLedger,cleanStory,storyFacts,rankStories,validateCoach} from '../public/story-core.js';
import {validateInput,validateResult} from '../coaching.mjs';
import {LiveCoach} from '../public/coach-ui.js';
import {VoiceNotes} from '../public/voice-notes.js';
import {createApp} from '../server.mjs';
import {renderer,tick,channel} from '../test-support/renderer-harness.mjs';
const story=(extra={})=>cleanStory({id:'s',status:'confirmed',title:'Stakeholder disagreement',situation:'The sponsor wanted every feature.',decision:'Start with the core.',action:'I mapped the tradeoff with the sponsor.',outcome:'We shipped in two weeks.',tags:['stakeholder','disagreement'],...extra});
const base={profile:'Reached 40 crore GMV in six months.',stories:[story()],question:'Tell me about a disagreement.',said:''};
const map=(extra={})=>({steps:['Context','My decision','Outcome'].map(label=>({label,covered:false,evidence:''})),nudge:'Explain your decision.',storyId:'s',checks:[],offTopic:false,offTopicEvidence:'',...extra});
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('only confirmed stories enter facts and matching; size truncation keeps complete stories',()=>{
 const draft=story({id:'d',status:'draft',title:'Secret draft'});assert.doesNotMatch(storyFacts([draft,story()]),/Secret draft/);assert.deepEqual(rankStories('stakeholder disagreement',[draft,story()]).map(s=>s.id),['s']);assert.equal(storyFacts([story()],5),'[]');
});
test('story fields and IDs are bounded; an unknown outcome may remain empty',()=>{
 assert.throws(()=>story({action:'x'.repeat(1801)}));assert.throws(()=>story({title:''}));assert.equal(story({outcome:''}).outcome,'');assert.equal(story({status:'trusted'}).status,'draft');
});
test('speech previews reconcile overlaps; finals replace previews; stale revisions cannot rewrite them',()=>{
 const l=new SpeechLedger();l.add({utteranceId:1,revision:1,text:'We had a disagreement with our sponsor'});l.add({utteranceId:1,revision:2,text:'with our sponsor about the scope'});assert.equal(l.text(),'We had a disagreement with our sponsor about the scope');l.add({utteranceId:1,revision:3,text:'We disagreed about scope.',final:true});l.add({utteranceId:1,revision:2,text:'WRONG'});l.add({utteranceId:2,text:'I cut the scope.',final:true});assert.equal(l.text(),'We disagreed about scope. I cut the scope.');
});
test('speech history is bounded even during a long session',()=>{const l=new SpeechLedger();for(let i=0;i<1000;i++)l.add({utteranceId:i,text:'word '.repeat(500),final:true});assert.equal(l.turns.size,40);assert.ok(l.text().length<=18000);});
test('coverage requires evidence from the spoken answer and keeps the original plan',()=>{
 const r=validateCoach(map({steps:[{label:'Changed',covered:true,evidence:'I chose the smaller launch.'},{label:'Invented',covered:true,evidence:'We doubled revenue.'},{label:'Result',covered:false,evidence:''}]}),{...base,said:'I chose the smaller launch.',plan:[{label:'Context'},{label:'Decision'},{label:'Outcome'}]});assert.equal(r.steps[0].covered,true);assert.equal(r.steps[0].label,'Context');assert.equal(r.steps[1].covered,false);
});
test('private corrections need both a spoken quote and a confirmed source quote',()=>{
 const checks=[{heard:'40 crore revenue',reference:'40 crore GMV',message:'GMV, not revenue.',confidence:.98},{heard:'Never spoken',reference:'40 crore GMV',message:'Bad',confidence:1},{heard:'40 crore revenue',reference:'Invented fact',message:'Bad',confidence:1},{heard:'40 crore revenue',reference:'40 crore GMV',message:'Uncertain',confidence:.6}];
 const r=validateCoach(map({checks,storyId:'made-up'}),{...base,said:'It was 40 crore revenue.'});assert.equal(r.checks.length,1);assert.equal(r.storyId,'');
});
test('draft stories and unconfirmed profile fields cannot justify corrections',()=>{
 const r=validateCoach(map({checks:[{heard:'ten users',reference:'twenty users',message:'Bad',confidence:1}]}),{...base,profile:'Confirmed context.\nSTILL TO CONFIRM\ntwenty users',stories:[story({status:'draft',outcome:'twenty users'})],said:'ten users'});assert.equal(r.checks.length,0);
});
test('extraction drops episodes without a verbatim source quote and can only produce drafts',()=>{
 const result=validateResult('extract',{stories:[story({sourceQuote:'I cut the scope.'}),story({sourceQuote:'Not present in notes.'})]},{notes:'I cut the scope. We shipped.'});assert.equal(result.stories.length,1);assert.equal(result.stories[0].status,'draft');
});
test('practice feedback cannot quote things the candidate never said',()=>{
 const r=validateResult('practice',{question:'What did you decide?',feedback:[{quote:'We delivered.',comment:'Who owned the decision?'},{quote:'I doubled revenue.',comment:'Invented'}],nextFocus:'Name your decision.'},{said:'We delivered.'});assert.equal(r.feedback.length,1);
});
test('coaching input rejects overlong notes, malformed plans and unsupported modes',()=>{
 for(const [mode,data] of [['extract',{...base,notes:'x'.repeat(60001)}],['live',{...base,plan:[]}],['other',base],['live',{...base,stories:[null]}]])assert.throws(()=>validateInput(mode,data));
});
test('late coaching responses cannot replace a new question',async()=>{
 const a=defer(),b=defer(),frames=[];let n=0;const c=new LiveCoach({getFacts:()=>base,render:s=>frames.push(s),request:()=>++n===1?a.promise:b.promise});c.begin('Original?');c.begin('Challenge?');a.resolve(map({nudge:'Old'}));await tick();assert.notEqual(c.map?.nudge,'Old');b.resolve(map({nudge:'New'}));await tick();assert.equal(c.map.nudge,'New');c.stop();
});
test('continuous speech coalesces into bounded updates instead of waiting for silence',async()=>{
 const seen=[];const c=new LiveCoach({delay:10,getFacts:()=>base,render(){},request:async(_mode,data)=>{seen.push(data.said);return map();}});c.begin('Question?');await tick();for(let i=0;i<5;i++){c.hear({text:'Spoken words '+i,utteranceId:i});await sleep(6);}await sleep(20);assert.ok(seen.length>=2);assert.ok(seen.length<7);assert.match(seen.at(-1),/Spoken words 4/);c.stop();
});
test('bookmark restores answer map and speech; Stop ignores in-flight replies',async()=>{
 const c=new LiveCoach({getFacts:()=>base,render(){},request:async()=>map()});c.begin('Original?');await tick();c.hear({text:'My actual decision',final:true});const saved=c.snapshot();c.begin('Challenge?');await tick();c.restore(saved);assert.equal(c.question,'Original?');assert.equal(c.ledger.text(),'My actual decision');c.stop();assert.equal(c.running,false);
});
test('microphone cancellation during permission prompt releases the late stream',async()=>{
 const d=defer();let stops=0,texts=[];const v=new VoiceNotes({getSettings:()=>({}),onText:t=>texts.push(t),acquire:()=>d.promise});const p=v.start();v.cancel();d.resolve({stop(){stops++;}});await p;assert.equal(stops,1);assert.equal(v.active,false);assert.deepEqual(texts,[]);
});
test('memo Stop releases microphone before final transcription completes, retaining that text',async()=>{
 const d=defer(),texts=[];let stopped=false;const node={port:{},connect(n){return n;},disconnect(){}};const v=new VoiceNotes({getSettings:()=>({}),onText:t=>texts.push(t),transcribe:()=>d.promise,makeNode:()=>node,acquire:async()=>({stop(){stopped=true;},inputs:[{analyser:node}],context:{audioWorklet:{addModule:async()=>{}},createGain:()=>({gain:{},connect(){}}),destination:{}}})});await v.start();for(let i=0;i<5;i++)v.segmenter.push(new Float32Array(1600).fill(.1));const finished=v.finish();assert.equal(stopped,true);d.resolve('A real incident.');await finished;assert.deepEqual(texts,['A real incident.']);v.cancel();
});

async function serverFixture(t,coach){const server=createApp({coach,coachRelease(){},local:{capabilities:()=>({})}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const origin='http://127.0.0.1:'+server.address().port;const cookie=(await fetch(origin+'/api/config')).headers.get('set-cookie').split(';')[0];return (mode,data,extra={})=>fetch(origin+'/api/coach/'+mode,{method:'POST',headers:{Origin:origin,'X-Cue-Client':'1',Cookie:cookie,'Content-Type':'application/json',...extra.headers},body:JSON.stringify(data),signal:extra.signal});}
test('coach API works without API key, validates input and rejects foreign origins',async t=>{let calls=0;const call=await serverFixture(t,async()=>{calls++;return map();});assert.equal((await call('live',base)).status,200);assert.equal((await call('live',{...base,question:''})).status,400);assert.equal((await call('live',base,{headers:{Origin:'https://foreign.test'}})).status,403);assert.equal(calls,1);});
test('coaching modes are independent; duplicate same-mode jobs are bounded',async t=>{const d=defer();let entered;const ready=new Promise(r=>entered=r);const call=await serverFixture(t,async mode=>{if(mode==='live'){entered();return d.promise;}return {question:'Practice?'};});const first=call('live',base);await ready;assert.equal((await call('live',base)).status,429);assert.equal((await call('practice',base)).status,200);d.resolve(map());assert.equal((await first).status,200);});
test('closing a coaching request aborts its provider job',async t=>{let started,aborted;const ready=new Promise(r=>started=r),ended=new Promise(r=>aborted=r);const call=await serverFixture(t,(_mode,_data,signal)=>new Promise(resolve=>{started();signal.addEventListener('abort',()=>{aborted();resolve(map());});}));const controller=new AbortController();const pending=call('live',base,{signal:controller.signal}).catch(()=>{});await ready;controller.abort();await pending;await ended;});

test('story review saves draft until explicitly confirmed; edits require reconfirmation',async t=>{
 const a=await renderer();t.after(()=>a.close());a.el('story_title').value='A real story';a.el('story_situation').value='We disagreed.';a.el('story_action').value='I proposed a smaller launch.';a.run('studio.saveStory()');assert.equal(a.run('studio.stories[0].status'),'draft');assert.doesNotMatch(a.run('effectiveProfile()'),/A real story/);a.el('confirmStory').checked=true;a.run('studio.saveStory()');assert.equal(a.run('studio.stories[0].status'),'confirmed');assert.match(a.run('effectiveProfile()'),/A real story/);assert.equal(a.el('confirmStory').checked,false);a.run('studio.saveStory()');assert.equal(a.run('studio.stories[0].status'),'draft');
});
test('opening practice stops the live interview and prevents keyboard answer generation',async t=>{const a=await renderer();t.after(()=>a.close());await a.run('connect()');a.el('practiceButton').click();assert.equal(a.run('connected'),false);assert.equal(a.el('practiceDialog').open,true);});
test('microphone paraphrases reach the coach even when voice-follow matches',async t=>{
 const a=await renderer({fetch:async url=>url==='/api/coach/live'?Response.json(map()):undefined});t.after(()=>a.close());a.run('settings.source="both";raw="ANSWER: I chose the smaller launch.";render();coach.toggle(true);coach.begin("Tell me about a disagreement.");');await tick();a.run('onSpeechText({text:"I chose the smaller launch.",source:"mic",final:true,utteranceId:1,revision:1})');assert.match(a.run('coach.ledger.text()'),/smaller launch/);
});
test('speech from the previous question cannot contaminate current coaching',async t=>{const a=await renderer({fetch:async url=>url==='/api/coach/live'?Response.json(map()):undefined});t.after(()=>a.close());a.run('coach.toggle(true);coach.toggle(true);coach.begin("A?");var oldEpoch=coach.epoch;coach.toggle(true);coach.begin("B?");onSpeechText({text:"Old answer words",source:"mic",final:true,coachEpoch:oldEpoch})');assert.equal(a.run('coach.ledger.text()'),'');});
test('a live interviewer challenge preserves original reading position and map',async t=>{
 const stream=channel();const a=await renderer({fetch:async url=>url==='/api/answer'?stream.response:url==='/api/coach/live'?Response.json(map()):undefined});t.after(()=>a.close());await a.run('connect()');a.run('settings.source="both";raw="ANSWER: Original answer available.";render();$("question").textContent="Original question?";reader.cursor=7;$("answerFrame").scrollTop=120;coach.toggle(true);coach.begin("Original question?");candidateSpeaking=true;onSpeechText({text:"But why did you not compromise?",source:"system",final:true})');await tick();assert.equal(a.run('bookmarks.length'),1);stream.send({type:'answer',text:'ANSWER: The challenge response.',streaming:false});stream.send({type:'done'});stream.close();await tick();assert.match(a.el('answer').textContent,/challenge/);await a.run('returnToAnswer()');assert.match(a.el('answer').textContent,/Original answer/);assert.equal(a.run('reader.cursor'),7);assert.equal(a.el('answerFrame').scrollTop,120);assert.equal(a.run('coach.question'),'Original question?');
});

test('unsupported coverage cannot leave a misleading stop-speaking nudge',()=>{const r=validateCoach(map({steps:['Context','Decision','Outcome'].map(label=>({label,covered:true,evidence:'Invented quote'})),nudge:'Stop speaking.'}),base);assert.doesNotMatch(r.nudge,/Stop speaking/);});
test('malformed practice history is rejected before reaching the model',()=>{assert.throws(()=>validateInput('practice',{...base,history:[null]}));assert.throws(()=>validateInput('practice',{...base,history:[{question:123,answer:'x'}]}));});
test('an interrupted microphone utterance is preserved when it belongs to the current coach question',async t=>{const a=await renderer();t.after(()=>a.close());a.run('var resets=0;coach.question="Current?";candidateSpeaking=true;segmenters=[{source:"mic",active:true,coachEpoch:coach.epoch,reset(){resets++;this.active=false;}}];resetReading()');assert.equal(a.run('resets'),0);assert.equal(a.run('candidateSpeaking'),true);a.run('segmenters=[]');});
test('practice UI keeps the question while displaying evidence-specific feedback and follows up',async t=>{
 let n=0;const a=await renderer({fetch:async(url)=>url==='/api/coach/practice'?Response.json(++n===1?{question:'What did you personally decide?',feedback:[],nextFocus:'Use a real experience.'}:{question:'What tradeoff did that create?',feedback:[{quote:'I aligned the team',comment:'What did you actually change?'}],nextFocus:'Name your decision.'}):undefined});t.after(()=>a.close());await a.run('studio.practice(true)');assert.equal(a.el('practiceQuestion').textContent,'What did you personally decide?');a.el('practiceAnswer').value='I aligned the team';await a.run('studio.practice(false)');assert.equal(a.el('practiceQuestion').textContent,'What did you personally decide?');assert.equal(a.el('practiceNext').hidden,false);a.el('practiceNext').click();assert.equal(a.el('practiceQuestion').textContent,'What tradeoff did that create?');assert.equal(a.el('practiceAnswer').value,'');assert.equal(a.run('studio.history.length'),1);
});

test('structured coaching schema is scoped to its turn and leaves answer streaming intact',async t=>{
 const {CodexSession}=await import('../codex-stream.mjs');const calls=[];let turn=0;
 const session=new CodexSession({command:'mock',connectionFactory:()=>{const rpc={closed:false,close(){this.closed=true;},send(){},call:async(method,params)=>{calls.push({method,params});if(method==='config/read')return {config:{}};if(method==='thread/start')return {thread:{id:'thread'}};if(method==='turn/start'){const id='t'+ ++turn;rpc.onNotification('item/agentMessage/delta',{threadId:'thread',turnId:id,itemId:id,delta:params.outputSchema?' {"question":"Why?"}':'ANSWER: A supported answer.'});rpc.onNotification('turn/completed',{threadId:'thread',turn:{id,status:'completed'}});return {turn:{id}};}return {};}};return rpc;}});t.after(()=>session.close());
 const options={cwd:'/tmp',key:'test',writingInstructions:'No tools.',prompt:'Test',emit(){}};const outputSchema={type:'object',properties:{question:{type:'string'}},required:['question'],additionalProperties:false};assert.equal(JSON.parse(await session.run({...options,outputSchema})).question,'Why?');assert.match(await session.run(options),/^ANSWER:/);const turns=calls.filter(x=>x.method==='turn/start');assert.deepEqual(turns[0].params.outputSchema,outputSchema);assert.equal('outputSchema' in turns[1].params,false);
});

test('Stop while memo permission is pending prevents recording after permission returns',async()=>{const d=defer();let stops=0;const v=new VoiceNotes({getSettings:()=>({}),onText(){},acquire:()=>d.promise});const opening=v.start();await v.finish();d.resolve({stop(){stops++;}});await opening;assert.equal(v.active,false);assert.equal(stops,1);assert.equal(v.pipeline,null);});

test('large libraries prioritise relevant confirmed stories without oversized model requests',async()=>{const {contextStories}=await import('../public/story-core.js');const list=Array.from({length:29},(_,i)=>story({id:'other'+i,title:'Other experience',situation:'x'.repeat(1700),decision:'y'.repeat(1700),action:'z'.repeat(1700),outcome:'q'.repeat(1700),tags:[]}));list.push(story({id:'relevant'}));const selected=contextStories(list,'stakeholder disagreement');assert.equal(selected[0].id,'relevant');assert.ok(JSON.stringify(selected).length<15000);assert.ok(selected.every(s=>s.status==='confirmed'));});
test('a challenge recognised after the candidate pauses still uses its captured interruption flag',async t=>{const s=channel();const a=await renderer({fetch:async url=>url==='/api/answer'?s.response:url==='/api/coach/live'?Response.json(map()):undefined});t.after(()=>a.close());await a.run('connect()');a.run('settings.source="both";raw="ANSWER: Original.";render();candidateSpeaking=false;onSpeechText({text:"But why not compromise?",source:"system",final:true,interrupting:true})');await tick();assert.equal(a.run('bookmarks.length'),1);s.send({type:'answer',text:'ANSWER: Challenge.',streaming:false});s.send({type:'done'});s.close();await tick();});

test('a delayed interview Stop cannot cancel a newly opened practice session',async t=>{
 const releases=[];const server=createApp({coachRelease:(...args)=>releases.push(args),local:{capabilities:()=>({}),check:async()=>{},prepare:async()=>{},release(){}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const origin='http://127.0.0.1:'+server.address().port;const cookie=(await fetch(origin+'/api/config')).headers.get('set-cookie').split(';')[0];const post=(path,data)=>fetch(origin+path,{method:'POST',headers:{Origin:origin,'X-Cue-Client':'1','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(data)});const {sessionId}=await(await post('/api/codex/check',{})).json();await post('/api/codex/stop',{sessionId});assert.equal(releases.length,1);assert.equal(releases[0][1],'live');
});

test('empty model check placeholders do not become visible warnings',async()=>{const {parseResponse}=await import('../public/core.js');assert.equal(parseResponse('ANSWER: Supported.\nCHECK: None.').check,'');assert.equal(parseResponse('ANSWER: Supported.\nCHECK: Omit if unnecessary.').check,'');assert.equal(parseResponse('ANSWER: Supported.\nCHECK: None of the proposed metrics is confirmed.').check,'None of the proposed metrics is confirmed.');});

test('the live coach is visibly unavailable in Realtime mode rather than silently pretending to listen',async t=>{const a=await renderer();t.after(()=>a.close());a.run('settings.provider="realtime";syncControls()');assert.equal(a.el('coachEnabled').disabled,true);assert.equal(a.el('coachCard').hidden,true);a.run('settings.provider="codex";syncControls()');assert.equal(a.el('coachEnabled').disabled,false);});
