import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openKnowledgeBank} from '../knowledge-bank.mjs';
import {createKnowledge,knowledge} from '../knowledge.mjs';
import {createApp} from '../server.mjs';
import {answerOptions} from '../public/model-options.js';
import {renderer} from '../test-support/renderer-harness.mjs';
const seed={schemaVersion:1,id:'test-bank',sources:[{id:'owner',title:'Confirmed notes',detail:'Synthetic'}],applicationSections:12,applicationFields:55,records:[{id:'example',source:'owner',kind:'fact',title:'Example',text:'Built a scheduling tool.',topics:'scheduling',note:''}]};
function folder(t){const directory=mkdtempSync(join(tmpdir(),'cue-knowledge-test-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));return directory;}
test('saved knowledge survives a new app instance and is never overwritten by a bundled update',t=>{
 const directory=folder(t);openKnowledgeBank({directory,seed});
 const user=structuredClone(seed);user.records[0].text='Owner correction: built a calendar.';writeFileSync(join(directory,'background.json'),JSON.stringify(user));
 const upgraded=structuredClone(seed);upgraded.records[0].text='Older bundled answer.';
 const bank=openKnowledgeBank({directory,seed:upgraded});assert.equal(bank.view().records[0].text,user.records[0].text);assert.equal(bank.summary().persistent,true);
});
test('retrieval uses the in-memory index without reading modified or deleted files',t=>{
 const directory=folder(t),bank=openKnowledgeBank({directory,seed});
 rmSync(join(directory,'background.json'));assert.equal(bank.retrieve('scheduling').records[0].text,'Built a scheduling tool.');
});
test('explicit reload atomically adopts a valid update and preserves the last valid index on malformed updates',t=>{
 const directory=folder(t),bank=openKnowledgeBank({directory,seed}),file=join(directory,'background.json');
 const changed=structuredClone(seed);changed.records[0].text='Built a calendar.';writeFileSync(file,JSON.stringify(changed));
 assert.equal(bank.retrieve('scheduling').records[0].text,'Built a scheduling tool.');
 assert.equal(bank.reload().warning,'');assert.equal(bank.retrieve('scheduling').records[0].text,'Built a calendar.');
 writeFileSync(file,'{broken');assert.match(bank.reload().warning,/last valid/);assert.equal(bank.view().records[0].text,'Built a calendar.');assert.equal(readFileSync(file,'utf8'),'{broken');
 writeFileSync(file,JSON.stringify(changed));assert.equal(bank.reload().warning,'');
});
test('invalid on-disk schema falls back visibly without destroying the saved file',t=>{
 const directory=folder(t),file=join(directory,'background.json');writeFileSync(file,JSON.stringify({schemaVersion:99,records:[]}));
 const bank=openKnowledgeBank({directory,seed});assert.match(bank.view().warning,/could not be loaded/);assert.equal(bank.view().records[0].id,'example');assert.equal(JSON.parse(readFileSync(file)).schemaVersion,99);
});
test('persistent storage keeps exactly the same retrieval output and character limits for a given pack',t=>{
 const bank=openKnowledgeBank({directory:folder(t),seed:knowledge.view()}),reference=createKnowledge(knowledge.view());
 for(const q of ['Why Example Program?','What was the 24% comparison lift?','How did you measure that?','What happened at Example Mobility?']){
  assert.deepEqual(bank.retrieve(q),reference.retrieve(q));const result=bank.retrieve(q);assert.ok(result.records.length<=9);assert.ok(result.records.reduce((s,r)=>s+JSON.stringify(r).length,0)<=11000);
 }
 assert.deepEqual(answerOptions(),{model:'gpt-6-sol',serviceTier:'priority',effort:'low'});
});
test('an answer request with persistent knowledge invokes the provider exactly once and keeps speed settings',async t=>{
 const bank=openKnowledgeBank({directory:folder(t),seed});let calls=0,received;
 const server=createApp({knowledge:bank,local:{capabilities:()=>({}),answer:async(data,emit)=>{calls++;received=data;emit({type:'answer',text:'ANSWER: I built a scheduling tool.'});}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const origin=`http://127.0.0.1:${server.address().port}`;
 const r=await fetch(origin+'/api/answer',{method:'POST',headers:{Origin:origin,'X-Cue-Client':'1','Content-Type':'application/json'},body:JSON.stringify({profile:'Synthetic candidate background facts.',style:'script',question:'What scheduling tool did you build?',answerModel:'gpt-6-sol',answerSpeed:'priority'})});
 assert.match(await r.text(),/I built a scheduling tool/);assert.equal(calls,1);assert.equal(received.knowledge.records[0].id,'example');assert.equal(received.answerSpeed,'priority');assert.equal(received.answerModel,'gpt-6-sol');
});
const nativeBase={protectCapture:async()=>true,status:async()=>({platform:'darwin',shareView:{state:'stopped'}}),onAction(){},onShareState(){}};
test('reload is blocked during a live session and cannot change model or speed',async t=>{
 let reloads=0;const ui=await renderer({prefs:{answerModel:'gpt-6-sol'},native:{...nativeBase,openKnowledge:async()=>{},reloadKnowledge:async()=>{reloads++;return {warning:''};}}});t.after(()=>ui.close());
 await ui.run('connect()');await ui.el('reloadKnowledge').onclick();assert.equal(reloads,0);assert.match(ui.el('knowledgeMessage').textContent,/Stop listening/);assert.equal(ui.run('connected'),true);
 ui.run('stop()');await ui.el('reloadKnowledge').onclick();assert.equal(reloads,1);assert.equal(ui.run('settings.answerModel'),'gpt-6-sol');assert.equal(ui.run('settings.answerSpeed'),'priority');
});
test('saved files and mock handoff buttons use only the declared native destinations',async t=>{
 const opened=[];const ui=await renderer({native:{...nativeBase,openKnowledge:async kind=>opened.push(kind)}});t.after(()=>ui.close());
 assert.equal(ui.el('knowledgeActions').hidden,false);await ui.el('openKnowledge').onclick();await ui.el('openMockContext').onclick();assert.deepEqual(opened,['folder','mock']);
});
