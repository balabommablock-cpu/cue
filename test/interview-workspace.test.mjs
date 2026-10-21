import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openInterviewWorkspace} from '../interview-workspace.mjs';
import {createApp} from '../server.mjs';
import {renderer,channel,tick} from '../test-support/renderer-harness.mjs';
const record=(id,text)=>({id,kind:'fact',source:'test',title:id,text,topics:'career interview budget company',note:''});
const pack=records=>({schemaVersion:1,sources:[{id:'test',title:'Synthetic fixture',detail:'Tests only'}],records,applicationFields:0,applicationSections:0});
function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'cue-interviews-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const dir of ['shared','interviews/personal','interviews/general'])mkdirSync(join(directory,dir),{recursive:true});
 const write=(file,value)=>writeFileSync(join(directory,file),typeof value==='string'?value:JSON.stringify(value));
 write('workspace.json',{defaultId:'personal'});write('shared/background.json',pack([record('shared','SHARED_CAREER evidence.')]));write('shared/profile.txt','Synthetic portable product career background.');
 for(const id of ['personal','general']){write('interviews/'+id+'/interview.json',{id,name:id,context:id==='personal'?'FOUNDER_ONLY_STIPEND':'GENERAL_ROLE_ONLY'});write('interviews/'+id+'/background.json',pack(id==='personal'?[record('application','FOUNDER_ONLY_SECRET')]:[]));write('interviews/'+id+'/Mock Interview.md',id);}
 return {directory,write,workspace:openInterviewWorkspace({directory})};
}
test('workspace retrieves shared plus selected records only; reload is atomic and read-free during answers',t=>{
 const {workspace,write,directory}=fixture(t);
 assert.equal(workspace.get('personal').view().records.length,2);assert.equal(workspace.get('general').view().records.length,1);
 assert.doesNotMatch(JSON.stringify(workspace.get('general').view()),/FOUNDER_ONLY/);
 for(const id of ['../personal','missing','',null])assert.throws(()=>workspace.get(id),/Choose an existing/);
 write('interviews/general/background.json','{broken');assert.match(workspace.reload().warning,/last valid/);assert.equal(workspace.get('general').view().records.length,1);
 rmSync(join(directory,'shared/background.json'));assert.equal(workspace.get('general').retrieve('career').records[0].text,'SHARED_CAREER evidence.');
});
test('new interview persists across restart, contains shared facts and its own notes, and opens only its own mock file',t=>{
 const {workspace,directory}=fixture(t);const result=workspace.create({name:'Acme · Product lead',context:'ACME_ONLY_NOTES'});
 const fresh=openInterviewWorkspace({directory}),entry=fresh.get(result.id);
 assert.match(entry.profile,/ACME_ONLY_NOTES/);assert.doesNotMatch(JSON.stringify(entry.view()),/FOUNDER_ONLY/);
 assert.equal(fresh.mockPath(result.id),join(directory,'interviews',result.id,'Mock Interview.md'));
 assert.throws(()=>fresh.mockPath('../../personal'));
 assert.throws(()=>fresh.create({name:' ',context:''}));
});
async function api(t,extra={}){
 const {workspace}=fixture(t);const calls=[];
 const server=createApp({workspace,apiKey:'synthetic-private-key',coachRelease(){},coach:async(mode,data,signal,key)=>{calls.push({mode,data,key});return {question:'Synthetic?',feedback:[],nextFocus:''};},local:{capabilities:()=>({}),check:async()=>{},prepare:async data=>calls.push({mode:'prepare',data}),release(){},answer:async(data,emit)=>{calls.push({mode:'answer',data});emit({type:'answer',text:'ANSWER: Synthetic.'});}},...extra});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const origin=`http://127.0.0.1:${server.address().port}`;let cookie='';
 async function request(path,data){const r=await fetch(origin+path,{method:data?'POST':'GET',headers:{Origin:origin,'X-Cue-Client':'1','Content-Type':'application/json',Cookie:cookie},body:data?JSON.stringify(data):undefined});cookie=r.headers.get('set-cookie')?.split(';')[0]||cookie;return r;}
 async function select(id){const r=await request('/api/interviews/select',{interviewId:id});assert.equal(r.status,200);const result=await r.json();return {interviewId:id,contextToken:result.contextToken,profile:result.background.profile,style:'script'};}
 return {request,select,calls};
}
test('answers, coach and Realtime instructions use selected scope; stale tokens cannot resurrect prior interviews',async t=>{
 const {request,select,calls}=await api(t);
 const old=await select('personal');await (await request('/api/answer',{...old,question:'Career?'})).text();assert.match(JSON.stringify(calls.at(-1)),/FOUNDER_ONLY_SECRET/);
 const current=await select('general');
 await (await request('/api/answer',{...current,question:'Career?',history:[],answerModel:'gpt-6-sol',answerSpeed:'priority'})).text();const answer=calls.at(-1);assert.doesNotMatch(JSON.stringify(answer),/FOUNDER_ONLY/);assert.equal(answer.data.answerSpeed,'priority');
 await request('/api/coach/practice',{...current,stories:[],said:'',question:''});assert.doesNotMatch(JSON.stringify(calls.at(-1)),/FOUNDER_ONLY/);
 const instructions=await (await request('/api/instructions',current)).json();assert.doesNotMatch(instructions.instructions,/FOUNDER_ONLY/);
 for(const path of ['/api/answer','/api/coach/practice','/api/codex/check','/api/instructions','/api/session'])assert.equal((await request(path,{...old,question:'Old?',stories:[]})).status,409,path);
 await select('personal');assert.equal((await request('/api/answer',{...old,question:'Old again?'})).status,409);
 assert.equal((await request('/api/background?interviewId=missing')).status,404);
});
test('Realtime upstream receives only selected material and bounded excerpts',async t=>{
 let session;const {request,select}=await api(t,{upstream:async(_url,options)=>{session=JSON.parse(options.body.get('session'));return new Response('v=0\r\n');}});
 const current=await select('general');const response=await request('/api/session',{...current,sdp:'v=0\r\n'});assert.equal(response.status,200);assert.doesNotMatch(session.instructions,/FOUNDER_ONLY/);assert.match(session.instructions,/SHARED_CAREER/);
});
test('switch while startup awaits login cancels old preparation before it reaches the model',async t=>{
 let unlock,prepared=0;const wait=new Promise(r=>unlock=r);
 const {request,select}=await api(t,{local:{capabilities:()=>({}),check:()=>wait,prepare:async()=>prepared++,release(){}}});
 const old=await select('personal');const pending=request('/api/codex/check',old);await new Promise(r=>setTimeout(r,20));await select('general');unlock();await pending;assert.equal(prepared,0);
});
function scopedFetch(){let token=0;return async(url,init)=>{
 if(url==='/api/interviews')return Response.json({defaultId:'personal',interviews:[{id:'personal',name:'Example Program'},{id:'general',name:'General'}]});
 if(url==='/api/interviews/select'){const id=JSON.parse(init.body).interviewId;return Response.json({contextToken:'token-'+(++token),background:{...pack(id==='personal'?[record('application','FOUNDER_ONLY_SECRET')]:[record('shared','SHARED_CAREER')]),profile:id==='personal'?'FOUNDER_ONLY_STIPEND and application context.':'GENERAL_ROLE_ONLY with portable career facts.',interviewName:id}});}
 };}
test('renderer switches facts, history, practice and bookmarks together; preserves model and speed and scoped edits',async t=>{
 const ui=await renderer({fetch:scopedFetch(),prefs:{profile:'Custom old Example Program facts, do not lose these.',answerModel:'gpt-6-sol'}});t.after(()=>ui.close());
 assert.match(ui.run('settings.profile'),/Custom old/);
 ui.run("answerArchive=[{question:'FOUNDER_ONLY_SECRET',raw:'ANSWER: Old.'}];localHistory=[{question:'Old?',answer:'Old'}];bookmarks.push({raw:'Old'});studio.history=[{question:'Old?',answer:'Old'}];studio.question='Old';studio.nextQuestion='Old follow-up';");
 await ui.run("selectInterview('general')");
 assert.doesNotMatch(ui.run('effectiveProfile()'),/Example Program|FOUNDER_ONLY|Custom old/);
 assert.equal(ui.run('answerArchive.length+localHistory.length+bookmarks.length+studio.history.length'),0);assert.equal(ui.run('studio.nextQuestion'),'');
 ui.run("settings.profile='General-only personal factual edit.';saveProfile()");
 await ui.run("selectInterview('personal')");assert.match(ui.run('settings.profile'),/Custom old/);
 await ui.run("selectInterview('general')");assert.equal(ui.run('settings.profile'),'General-only personal factual edit.');
 assert.equal(ui.run('settings.answerModel'),'gpt-6-sol');assert.equal(ui.run('settings.answerSpeed'),'priority');
});
test('renderer refuses switching while live and includes the selected context token on answer calls',async t=>{
 const stream=channel(),base=scopedFetch();const ui=await renderer({fetch:async(url,init)=>url==='/api/answer'?stream.response:base(url,init)});t.after(()=>ui.close());
 await ui.run("selectInterview('general')");await ui.run('connect()');assert.equal(ui.el('interviewPicker').disabled,true);
 await ui.run("selectInterview('personal')");assert.equal(ui.run('interviewId'),'general');
 const answering=ui.run("localAnswer({question:'Which career?'})");await tick();const sent=JSON.parse(ui.requests.find(x=>x.url==='/api/answer').init.body);
 assert.equal(sent.interviewId,'general');assert.ok(sent.contextToken);assert.doesNotMatch(sent.profile,/FOUNDER_ONLY/);assert.equal(sent.history.length,0);
 stream.send({type:'answer',text:'ANSWER: General career.'});stream.send({type:'done'});stream.close();await answering;
});
test('workspace startup failure does not quietly start with legacy Example Program facts',async t=>{
 const ui=await renderer({fetch:async url=>url==='/api/interviews'?new Response('unavailable',{status:503}):undefined});t.after(()=>ui.close());
 await ui.run('connect()');assert.equal(ui.run('connected'),false);assert.match(ui.el('notice').textContent,/loaded interview/);
});
test('selecting an invalid interview leaves the current valid context intact',async t=>{
 const {request,select,calls}=await api(t);const current=await select('general');
 assert.equal((await request('/api/interviews/select',{interviewId:'unknown'})).status,404);
 const response=await request('/api/answer',{...current,question:'Current career?'});assert.equal(response.status,200);await response.text();assert.doesNotMatch(JSON.stringify(calls.at(-1)),/FOUNDER_ONLY/);
});
