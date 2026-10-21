import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {instructions,sessionConfig} from '../prompt.mjs';
import {parseResponse,completedText} from '../public/core.js';
import {QuestionSegmenter,pcmBase64} from '../public/local-audio.js';

async function fixture(t,options={}){
  const server=createApp(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const first=await fetch(origin+'/api/config');const cookie=first.headers.get('set-cookie').split(';')[0];
  return {origin,cookie,call:(path,data,extra={})=>fetch(origin+path,{method:'POST',headers:{Origin:origin,'X-Cue-Client':'1','Content-Type':'application/json',Cookie:cookie,...extra.headers},body:JSON.stringify(data),...Object.fromEntries(Object.entries(extra).filter(([k])=>k!=='headers'))})};
}
test('session requires a key and never silently simulates an AI response',async t=>{const f=await fixture(t,{apiKey:''});const r=await f.call('/api/session',{sdp:'v=0\r\n',profile:'A candidate fact sheet with enough context.',style:'script'});assert.equal(r.status,503);assert.match((await r.json()).error,/key/i);});
test('foreign origins cannot store credentials or create sessions',async t=>{const f=await fixture(t);const r=await f.call('/api/key',{key:'x'.repeat(24)},{headers:{Origin:'https://other.example'}});assert.equal(r.status,403);});
test('key is scoped to a local browser session and not exposed by config',async t=>{const f=await fixture(t,{apiKey:''});await f.call('/api/key',{key:'x'.repeat(24)});const own=await(await fetch(f.origin+'/api/config',{headers:{Cookie:f.cookie}})).json();assert.equal(own.keyConfigured,true);assert.equal(JSON.stringify(own).includes('x'.repeat(24)),false);const stranger=await(await fetch(f.origin+'/api/config')).json();assert.equal(stranger.keyConfigured,false);});
test('session forwards SDP, grounded profile and text-only configuration',async t=>{let sent;const f=await fixture(t,{apiKey:'test-server-key',upstream:async(url,init)=>{sent={url,init};return new Response('v=0\r\nmock answer');}});const r=await f.call('/api/session',{sdp:'v=0\r\noffer',profile:'Eight years in product. No customer count known.',style:'cues',auto:true});assert.equal(r.status,200);assert.equal(sent.url,'https://api.openai.com/v1/realtime/calls');const s=JSON.parse(sent.init.body.get('session'));assert.deepEqual(s.output_modalities,['text']);assert.equal(s.audio.input.turn_detection.create_response,true);assert.match(s.instructions,/Never invent/);assert.match(s.instructions,/No customer count known/);assert.equal(sent.init.headers.Authorization,'Bearer test-server-key');});
test('upstream failure details and credentials are not echoed',async t=>{const f=await fixture(t,{apiKey:'secret-value',upstream:async()=>new Response('secret-value debug dump',{status:401})});const r=await f.call('/api/session',{sdp:'v=0\r\n',profile:'Enough background to make this a valid profile.',style:'script'});assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/secret-value/);});
test('only allowlisted assets can be served',async t=>{const f=await fixture(t);for(const p of ['/server.mjs','/package.json','/.env','/test/app.test.mjs'])assert.equal((await fetch(f.origin+p)).status,404);});
test('every renderer module import resolves through the real server asset allowlist',async t=>{
  const f=await fixture(t),seen=new Set(),pending=['/app.js'];
  while(pending.length){const path=pending.pop();if(seen.has(path))continue;seen.add(path);const r=await fetch(f.origin+path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-type'),/javascript/,path);const text=await r.text();for(const match of text.matchAll(/from\s*['"]\.\/([^'"]+)['"]/g))pending.push('/'+match[1]);}
  assert.ok(seen.has('/audio-routing.js'));
});
test('platform guidance is served without confusing documented features with verified support',async t=>{
  const f=await fixture(t);const r=await fetch(f.origin+'/platforms.json');assert.equal(r.status,200);const {platforms}=await r.json();assert.ok(platforms.some(p=>p.id==='meet'));assert.ok(platforms.some(p=>p.id==='mercor'));assert.equal(new Set(platforms.map(p=>p.id)).size,platforms.length);
  for(const p of platforms){assert.equal(p.verification,'not tested');assert.ok(p.sources.every(s=>s.startsWith('https://')));}
  for(const id of ['chakra','hackerearth','talview','codesignal'])assert.match(platforms.find(p=>p.id===id).route,/restricted|entire_screen/);
});
test('oversized fact sheet rejected before the API call',async t=>{const f=await fixture(t);const r=await f.call('/api/instructions',{profile:'a'.repeat(40001),style:'script'});assert.equal(r.status,400);});
test('stream parser keeps unknown-fact checks outside the speakable answer',()=>{assert.deepEqual(parseResponse('QUESTION: What happened?\nANSWER:\nI led the launch.\nCHECK: Add the verified date.'),{question:'What happened?',answer:'I led the launch.',check:'Add the verified date.'});assert.equal(parseResponse('QUESTION: Incom').answer,'');assert.equal(completedText({output:[{content:[{type:'text',text:'Hello.'}]}]}),'Hello.');});
test('manual mode disables automatic generation and prompt excludes invented facts',()=>{const s=sessionConfig({profile:'Facts only.',style:'script',auto:false});assert.equal(s.audio.input.turn_detection.create_response,false);assert.match(instructions('Facts only.'),/earlier assistant drafts are not evidence/);});
test('Codex mode runs without an API key and uses the real provider boundary',async t=>{
  let received;const f=await fixture(t,{apiKey:'',local:{capabilities:()=>({codexAvailable:true}),check:async()=>({}),transcribe:async()=>'',answer:async(data,emit)=>{received=data;emit({type:'answer',text:'QUESTION: Why?\nANSWER: Because.'});}}});
  const r=await f.call('/api/answer',{question:'Why?',profile:'Confirmed candidate background.',style:'script',history:[]});const events=(await r.text()).trim().split('\n').map(JSON.parse);
  assert.equal(r.status,200);assert.equal(received.question,'Why?');assert.equal(events.at(-1).type,'done');assert.equal(events.find(e=>e.type==='answer').text.includes('Because'),true);
});
test('audio is transcribed before Codex receives its question',async t=>{
  let got;const f=await fixture(t,{local:{capabilities:()=>({}),transcribe:async()=> 'A spoken question?',answer:async(data,emit)=>{got=data.question;emit({type:'answer',text:'ANSWER: Supported response.'});}}});
  const r=await f.call('/api/answer',{pcm:Buffer.alloc(12000).toString('base64'),profile:'Confirmed candidate background.',style:'script'});await r.text();assert.equal(got,'A spoken question?');
});
test('reading transcription stays local and never invokes the answer model',async t=>{
 let answered=false;const f=await fixture(t,{local:{capabilities:()=>({}),transcribe:async()=> 'I built the product with one developer.',answer:async()=>{answered=true;}}});
 const r=await f.call('/api/transcribe',{pcm:Buffer.alloc(12000).toString('base64')});assert.equal(r.status,200);assert.match((await r.json()).text,/one developer/);assert.equal(answered,false);
 assert.equal((await f.call('/api/transcribe',{pcm:'invalid'})).status,400);
 assert.equal((await f.call('/api/transcribe',{pcm:Buffer.alloc(12000).toString('base64')},{headers:{Origin:'https://untrusted.example'}})).status,403);
});
test('conversation mode and physical input labels are validated before answering',async t=>{
 const f=await fixture(t);const base={profile:'Confirmed candidate background.',style:'script',question:'A question?'};
 assert.equal((await f.call('/api/answer',{...base,autoDetect:'yes'})).status,400);
 assert.equal((await f.call('/api/answer',{...base,inputSource:'untrusted-source'})).status,400);
});
test('shared room speech reaches the provider without a candidate-only label',async t=>{
 let received;const f=await fixture(t,{local:{answer:async(data,emit)=>{received=data;emit({type:'answer',text:'WAIT: Candidate response.'});}}});
 const r=await f.call('/api/answer',{profile:'Confirmed candidate background.',style:'script',question:'I built a smaller first version.',inputSource:'shared',autoDetect:true});
 assert.equal(r.status,200);await r.text();assert.equal(received.inputSource,'shared');assert.equal(received.autoDetect,true);
});
test('empty recognition does not ask the model to invent a question',async t=>{
  let called=false;const f=await fixture(t,{local:{capabilities:()=>({}),transcribe:async()=>'',answer:async()=>{called=true;}}});
  const r=await f.call('/api/answer',{pcm:Buffer.alloc(12000).toString('base64'),profile:'Confirmed candidate background.',style:'script'});assert.match(await r.text(),/"type":"empty"/);assert.equal(called,false);
});
test('invalid audio and oversized history are rejected',async t=>{
  const f=await fixture(t);const base={profile:'Confirmed candidate background.',style:'script'};
  assert.equal((await f.call('/api/answer',{...base,pcm:'not audio'})).status,400);
  assert.equal((await f.call('/api/answer',{...base,question:'Hi',history:Array(7).fill({question:'Q',answer:'A'})})).status,400);
});
test('question segmentation ignores silence and brief clicks, emits after speech stops',()=>{
  const questions=[];let heard=0;const v=new QuestionSegmenter(s=>questions.push(s),()=>heard++);
  for(let i=0;i<30;i++)v.push(new Float32Array(1600));assert.equal(questions.length,0);
  v.push(new Float32Array(1600).fill(.1));for(let i=0;i<13;i++)v.push(new Float32Array(1600));assert.equal(questions.length,0);
  for(let i=0;i<5;i++)v.push(new Float32Array(1600).fill(.1));for(let i=0;i<12;i++)v.push(new Float32Array(1600));assert.equal(questions.length,1);assert.equal(heard,2);
  assert.equal(Buffer.from(pcmBase64(questions[0]),'base64').length,questions[0].length*2);
});
test('pausing segmentation discards unfinished speech',()=>{const out=[];const v=new QuestionSegmenter(s=>out.push(s));for(let i=0;i<5;i++)v.push(new Float32Array(1600).fill(.1));v.reset();for(let i=0;i<20;i++)v.push(new Float32Array(1600));assert.equal(out.length,0);});
test('disconnect cancels inference; duplicate work is rejected and the session recovers',async t=>{
  let finishCancel,started;const cancelled=new Promise(r=>finishCancel=r),running=new Promise(r=>started=r);let attempt=0;
  const f=await fixture(t,{local:{capabilities:()=>({}),answer:async(_data,emit,signal)=>{
    if(++attempt===1){started();await new Promise(resolve=>signal.addEventListener('abort',()=>{resolve();finishCancel();},{once:true}));}
    else emit({type:'answer',text:'ANSWER: Recovered.'});
  }}});
  const controller=new AbortController(),data={question:'Question?',profile:'Confirmed candidate background.',style:'script'};
  const first=await f.call('/api/answer',data,{signal:controller.signal});await running;
  assert.equal((await f.call('/api/answer',data)).status,429);
  controller.abort();await assert.rejects(first.text());await Promise.race([cancelled,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Inference did not cancel')),1000);timer.unref();})]);
  const next=await f.call('/api/answer',data);assert.equal(next.status,200);assert.match(await next.text(),/Recovered/);
});
test('provider failure is streamed explicitly and the session is reusable',async t=>{
  let calls=0;const f=await fixture(t,{local:{capabilities:()=>({}),answer:async(_data,emit)=>{if(++calls===1)throw new Error('Provider unavailable.');emit({type:'answer',text:'ANSWER: A fresh answer.'});}}});
  const data={question:'Question?',profile:'Confirmed candidate background.',style:'script'};
  const failed=(await(await f.call('/api/answer',data)).text()).trim().split('\n').map(JSON.parse);
  assert.equal(failed.at(-1).type,'error');assert.equal(failed.some(x=>x.type==='done'),false);
  assert.match(await(await f.call('/api/answer',data)).text(),/A fresh answer/);
});

for(const path of ['/api/answer','/api/transcribe','/api/instructions','/api/key','/api/session'])test('malformed object shapes return 400 at '+path,async t=>{
 const f=await fixture(t);for(const data of [null,[],true,42,'text'])assert.equal((await f.call(path,data)).status,400);
});
test('null and invalid history entries are rejected before inference',async t=>{
 const f=await fixture(t),base={profile:'Synthetic candidate facts only.',style:'script',question:'Why?'};
 for(const history of [[null],[true],[{}],[{question:'a',answer:5}],['text']])assert.equal((await f.call('/api/answer',{...base,history})).status,400);
});
test('invalid decoded PCM and noncanonical base64 are rejected at both routes',async t=>{
 const f=await fixture(t),base={profile:'Synthetic candidate facts only.',style:'script'};
 for(const pcm of [Buffer.alloc(12001).toString('base64'),'A'.repeat(10669),Buffer.alloc(7998).toString('base64'),Buffer.alloc(12000).toString('base64')+'='])for(const path of ['/api/transcribe','/api/answer'])assert.equal((await f.call(path,{...base,pcm})).status,400);
});
test('a combined audio answer cannot start a second decoder while readback transcription is running',async t=>{
 let release,begin;const started=new Promise(r=>begin=r);const f=await fixture(t,{local:{capabilities:()=>({}),transcribe:async()=>{begin();return await new Promise(r=>release=r);},answer:async()=>{}}});
 const pcm=Buffer.alloc(12000).toString('base64'),first=f.call('/api/transcribe',{pcm});await started;
 const second=await f.call('/api/answer',{pcm,profile:'Synthetic candidate facts only.',style:'script'});assert.equal(second.status,429);release('Speech.');assert.equal((await first).status,200);
});
test('audio answer locks the decoder but still allows a separate text request after completion',async t=>{
 let release,begin;const started=new Promise(r=>begin=r);const f=await fixture(t,{local:{capabilities:()=>({}),transcribe:async()=>{begin();return await new Promise(r=>release=r);},answer:async(_d,emit)=>emit({type:'answer',text:'ANSWER: Done.'})}});
 const pcm=Buffer.alloc(12000).toString('base64'),base={profile:'Synthetic candidate facts only.',style:'script'};
 const first=await f.call('/api/answer',{pcm,...base});await started;assert.equal((await f.call('/api/transcribe',{pcm})).status,429);release('A question?');await first.text();const next=await f.call('/api/answer',{question:'Next?',...base});assert.match(await next.text(),/Done/);
});
test('question and readback audio use independent server slots without invoking the model',async t=>{
 let release,started;const running=new Promise(r=>started=r),lanes=[];const f=await fixture(t,{local:{capabilities:()=>({}),transcribe:async(_pcm,_signal,{lane})=>{lanes.push(lane);if(lane==='readback'){started();await new Promise(r=>release=r);}return lane+' transcript';},answer:()=>assert.fail('No model call for transcription')}});
 const pcm=Buffer.alloc(12000).toString('base64');const mic=f.call('/api/transcribe',{pcm,lane:'readback'});await running;
 assert.equal((await f.call('/api/transcribe',{pcm,lane:'readback'})).status,429);
 const question=await f.call('/api/transcribe',{pcm,lane:'question'});assert.equal(question.status,200);assert.equal((await question.json()).text,'question transcript');
 release();assert.equal((await mic).status,200);assert.deepEqual(lanes,['readback','question']);assert.equal((await f.call('/api/transcribe',{pcm,lane:'arbitrary'})).status,400);
});
test('Start prewarms with the validated profile and binds answers to the same browser session',async t=>{
 let prepared,answered;const f=await fixture(t,{local:{capabilities:()=>({}),check:async()=>({}),prepare:async data=>prepared=data,answer:async(data,emit)=>{answered=data;emit({type:'answer',text:'ANSWER: Supported.'});}}});
 const data={profile:'Synthetic candidate facts only.',style:'script',audio:true,dual:true,autoDetect:true,sessionKey:'untrusted'};
 assert.equal((await f.call('/api/codex/check',data)).status,200);await(await f.call('/api/answer',{...data,question:'Why?'})).text();
 assert.equal(prepared.profile,data.profile);assert.equal(prepared.audio,true);assert.equal(prepared.sessionKey,answered.sessionKey);assert.notEqual(prepared.sessionKey,'untrusted');
 assert.equal((await f.call('/api/codex/check',{...data,profile:'short'})).status,400);assert.equal((await f.call('/api/codex/check',{...data,audio:'yes'})).status,400);
});
test('Stop during startup cancels the model warm-up before capture becomes ready',async t=>{
 let started,cancelled;const running=new Promise(r=>started=r),ended=new Promise(r=>cancelled=r);
 const f=await fixture(t,{local:{capabilities:()=>({}),check:async()=>({}),prepare:async(_data,signal)=>{started();await new Promise(resolve=>signal.addEventListener('abort',()=>{cancelled();resolve();},{once:true}));}}});
 const controller=new AbortController();const request=f.call('/api/codex/check',{}, {signal:controller.signal});const rejection=assert.rejects(request);await running;controller.abort();await rejection;await ended;
});
test('a fresh Start creates fresh model context and a late Stop cannot kill the replacement session',async t=>{
 const prepared=[],released=[];const f=await fixture(t,{local:{capabilities:()=>({}),check:async()=>({}),prepare:async data=>prepared.push(data.sessionKey),release:key=>released.push(key)}});
 const a=await(await f.call('/api/codex/check',{})).json(),b=await(await f.call('/api/codex/check',{})).json();assert.notEqual(a.sessionId,b.sessionId);
 await f.call('/api/codex/stop',{sessionId:a.sessionId});assert.equal(released.length,0);await f.call('/api/codex/stop',{sessionId:b.sessionId});assert.deepEqual(released,[b.sessionId]);assert.deepEqual(prepared,[a.sessionId,b.sessionId]);
 assert.equal((await f.call('/api/codex/stop',{sessionId:null})).status,400);
});
