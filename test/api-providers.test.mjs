import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {createApiConnections,publicApiError,validateModel} from '../api-providers.mjs';
import {installApiProviders} from '../api-desktop.cjs';

const key='unit-'+ 'x'.repeat(28),otherKey='unit-'+ 'y'.repeat(28);
const messages=[{role:'system',content:'Answer concisely.'},{role:'user',content:'What is two plus two?'}];
function encryption(){
 const secret=randomBytes(32);
 return {isAvailable:()=>true,encrypt(text){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);return Buffer.concat([iv,cipher.update(text),cipher.final(),cipher.getAuthTag()]);},
 decrypt(data){const b=Buffer.from(data),cipher=createDecipheriv('aes-256-gcm',secret,b.subarray(0,12));cipher.setAuthTag(b.subarray(-16));return Buffer.concat([cipher.update(b.subarray(12,-16)),cipher.final()]).toString();}};
}
function sse(events,{crlf=false,split=13}={}){
 const bytes=new TextEncoder().encode(events.map(x=>'data: '+JSON.stringify(x)+(crlf?'\r\n\r\n':'\n\n')).join(''));
 let at=0;return new Response(new ReadableStream({pull(c){if(at>=bytes.length){c.close();return;}c.enqueue(bytes.slice(at,at+split));at+=split;}}));
}
async function fixture(t,fetcher=async()=>Response.json({data:[{id:'text-model',display_name:'Text model'}]})){
 const directory=await mkdtemp(join(tmpdir(),'cue-api-test-')),crypto=encryption();
 const c=await createApiConnections({directory,encryption:crypto,fetcher});
 t.after(async()=>{c.close();await rm(directory,{recursive:true,force:true});});
 return {c,directory,crypto};
}
test('API keys persist encrypted, with private file permissions and no key returned in status',async t=>{
 const f=await fixture(t);await f.c.connect({provider:'openai',key});
 const file=await readFile(join(f.directory,'providers.enc'));assert.equal(file.includes(Buffer.from(key)),false);
 assert.equal((await stat(join(f.directory,'providers.enc'))).mode&0o777,0o600);
 const reopened=await createApiConnections({directory:f.directory,encryption:f.crypto});
 assert.equal((await reopened.status()).providers.openai.connected,true);assert.equal(JSON.stringify(await reopened.status()).includes(key),false);
 reopened.close();
});
test('parallel provider connections preserve both keys, and removing one preserves the other',async t=>{
 const f=await fixture(t);
 await Promise.all([f.c.connect({provider:'openai',key}),f.c.connect({provider:'anthropic',key:otherKey})]);
 let state=await f.c.status();assert.equal(state.providers.openai.connected,true);assert.equal(state.providers.anthropic.connected,true);
 await f.c.disconnect('openai');
 const reopened=await createApiConnections({directory:f.directory,encryption:f.crypto});state=await reopened.status();
 assert.equal(state.providers.openai.connected,false);assert.equal(state.providers.anthropic.connected,true);reopened.close();
});
test('failed key replacement retains the working credential',async t=>{
 let reject=false;const f=await fixture(t,async()=>reject?new Response('',{status:401}):Response.json({data:[]}));
 await f.c.connect({provider:'openai',key});reject=true;
 await assert.rejects(f.c.connect({provider:'openai',key:otherKey}),{code:'invalid_key'});
 assert.equal((await f.c.status()).providers.openai.connected,true);
 assert.equal(JSON.parse(f.crypto.decrypt(await readFile(join(f.directory,'providers.enc')))).providers.openai.key,key);
});
test('missing native encryption never writes a plaintext credential',async t=>{
 const f=await fixture(t);const c=await createApiConnections({directory:f.directory,encryption:{isAvailable:()=>false}});
 await assert.rejects(c.connect({provider:'openai',key}),{code:'storage_unavailable'});
 await assert.rejects(readFile(join(f.directory,'providers.enc')),{code:'ENOENT'});
});
test('restricted model listing permits an exact custom model ID without disclosing the key',async t=>{
 const f=await fixture(t,async()=>new Response('',{status:403}));
 const result=await f.c.connect({provider:'openai',key});
 assert.equal(result.connected,true);assert.match(result.warning,/restricted/);assert.deepEqual(result.models,[]);
});
test('Claude model listing follows cursors and sends the selected workspace only to Claude',async t=>{
 const calls=[];const f=await fixture(t,async(url,options)=>{
  calls.push({url,options});return Response.json(calls.length===1?{data:[{id:'claude-a'}],has_more:true,last_id:'claude-a'}:{data:[{id:'claude-b'}],has_more:false});
 });
 const result=await f.c.connect({provider:'anthropic',key,workspace:'wrkspc_example'});
 assert.deepEqual(result.models.map(x=>x.id),['claude-a','claude-b']);
 assert.match(calls[1].url,/after_id=claude-a/);
 assert.equal(calls[0].options.headers['anthropic-workspace-id'],'wrkspc_example');assert.equal(calls[0].options.redirect,'error');
});
test('OpenAI model listing keeps new and fine-tuned text IDs while excluding known media models',async t=>{
 const f=await fixture(t,async()=>Response.json({data:[{id:'gpt-next'},{id:'ft:custom:example'},{id:'whisper-1'},{id:'text-embedding-example'},{id:'gpt-realtime'},{id:'gpt-next'}]}));
 const r=await f.c.connect({provider:'openai',key});assert.deepEqual(r.models.map(x=>x.id),['ft:custom:example','gpt-next']);
});
test('OpenAI streams fragmented UTF-8/CRLF text and honors an exact custom model',async t=>{
 let sent;const f=await fixture(t,async(url,options)=>{
  if(url.endsWith('/models'))return Response.json({data:[]});sent={url,options};
  return sse([{type:'response.reasoning_text.delta',delta:'hidden'},{type:'response.output_text.delta',delta:'Four '},{type:'response.output_text.delta',delta:'🙂'},{type:'response.completed',response:{output:[]}}],{crlf:true,split:1});
 });
 await f.c.connect({provider:'openai',key});const partial=[];
 const answer=await f.c.answer({provider:'openai',model:'ft:custom:example',messages},t=>partial.push(t));
 assert.equal(answer,'Four 🙂');assert.deepEqual(partial,['Four ','Four 🙂']);
 const payload=JSON.parse(sent.options.body);assert.equal(payload.model,'ft:custom:example');assert.equal(payload.store,false);assert.equal(payload.stream,true);
 assert.equal(sent.options.headers.Authorization,'Bearer '+key);assert.equal(sent.url,'https://api.openai.com/v1/responses');
});
test('Claude separates system instructions, streams only answer text, and honors the model ID',async t=>{
 let payload;const f=await fixture(t,async(url,options)=>{
  if(url.includes('/models'))return Response.json({data:[]});payload=JSON.parse(options.body);
  return sse([{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'hidden'}},{type:'content_block_delta',delta:{type:'text_delta',text:'Four.'}},{type:'message_delta',delta:{stop_reason:'end_turn'}},{type:'message_stop'}]);
 });
 await f.c.connect({provider:'anthropic',key});const result=await f.c.answer({provider:'anthropic',model:'claude-custom',messages},()=>{});
 assert.equal(result,'Four.');assert.equal(payload.system,'Answer concisely.');assert.equal(payload.messages.some(m=>m.role==='system'),false);assert.equal(payload.model,'claude-custom');
});
test('an interrupted stream never reports a partial answer as complete',async t=>{
 const f=await fixture(t,async url=>url.endsWith('/models')?Response.json({data:[]}):sse([{type:'response.output_text.delta',delta:'Partial'}]));
 await f.c.connect({provider:'openai',key});
 await assert.rejects(f.c.answer({provider:'openai',model:'text-model',messages},()=>{}),{code:'incomplete'});
});
test('Claude token truncation is reported as incomplete',async t=>{
 const f=await fixture(t,async url=>url.includes('/models')?Response.json({data:[]}):sse([{type:'content_block_delta',delta:{type:'text_delta',text:'Partial'}},{type:'message_delta',delta:{stop_reason:'max_tokens'}},{type:'message_stop'}]));
 await f.c.connect({provider:'anthropic',key});await assert.rejects(f.c.answer({provider:'anthropic',model:'claude-test',messages},()=>{}),{code:'incomplete'});
});
test('provider failures are mapped to safe messages without reflecting upstream secrets',async t=>{
 const f=await fixture(t,async url=>url.endsWith('/models')?Response.json({data:[]}):new Response(key,{status:429}));
 await f.c.connect({provider:'openai',key});
 try{await f.c.answer({provider:'openai',model:'text-model',messages},()=>{});assert.fail('Expected error');}
 catch(e){assert.equal(e.code,'usage_limit');assert.equal(JSON.stringify(publicApiError(e)).includes(key),false);}
 assert.equal(publicApiError(new Error(key)).message.includes(key),false);
});
test('cancelled key setup cannot resurrect a disconnected credential',async t=>{
 let release;const gate=new Promise(r=>release=r);const f=await fixture(t,async()=>{await gate;return Response.json({data:[]});});
 const connecting=f.c.connect({provider:'openai',key});await new Promise(r=>setImmediate(r));await f.c.disconnect('openai');release();
 await assert.rejects(connecting);assert.equal((await f.c.status()).providers.openai.connected,false);
});
test('repeated setup requests are coalesced with a bounded busy error',async t=>{
 let release;const gate=new Promise(r=>release=r);const f=await fixture(t,async()=>{await gate;return Response.json({data:[]});});
 const one=f.c.connect({provider:'openai',key});await new Promise(r=>setImmediate(r));
 await assert.rejects(f.c.connect({provider:'openai',key:otherKey}),{code:'busy'});release();await one;
});
test('model IDs, malformed input and subscription OAuth tokens fail before network access',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return Response.json({data:[]});});
 assert.throws(()=>validateModel('model\nInjected: key'));assert.throws(()=>validateModel(''));assert.equal(validateModel('ft:gpt-test:example:variant'),'ft:gpt-test:example:variant');
 await assert.rejects(f.c.connect({provider:'__proto__',key}),{code:'invalid_provider'});
 await assert.rejects(f.c.connect({provider:'anthropic',key:'sk-ant-oat-'+ 'x'.repeat(24)}),{code:'unsupported_credential'});
 await assert.rejects(f.c.answer({provider:'openai',model:'text-model',messages:[{role:'user',content:'x'.repeat(100001)}]},()=>{}),{code:'invalid_messages'});
 assert.equal(calls,0);
});
test('pre-aborted answers never reach a provider',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return Response.json({data:[]});});
 await f.c.connect({provider:'openai',key});const c=new AbortController();c.abort();
 await assert.rejects(f.c.answer({provider:'openai',model:'text-model',messages},()=>{},c.signal));assert.equal(calls,1);
});
test('credential IPC rejects foreign windows and subframes',async t=>{
 const handlers=new Map(),directory=await mkdtemp(join(tmpdir(),'cue-ipc-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const frame={url:'http://127.0.0.1:4329/'},webContents={mainFrame:frame,send(){}},win={webContents,isDestroyed:()=>false};
 const bridge=installApiProviders({app:{getPath:()=>directory},win,ipcMain:{handle:(n,f)=>handlers.set(n,f)},safeStorage:{isEncryptionAvailable:()=>true},shell:{openExternal:async()=>{}},origin:'http://127.0.0.1:4329'});t.after(()=>bridge.close());
 const status=handlers.get('cue:api-status');
 assert.equal((await status({sender:{},senderFrame:frame})).ok,false);
 assert.equal((await status({sender:webContents,senderFrame:{url:frame.url}})).ok,false);
 assert.equal((await status({sender:webContents,senderFrame:frame})).ok,true);
});
test('older OpenAI text models use Chat Completions compatibility and remember the working endpoint',async t=>{
 const paths=[];const f=await fixture(t,async(url,options)=>{
  paths.push(url);
  if(url.endsWith('/models'))return Response.json({data:[]});
  if(url.endsWith('/responses'))return new Response('',{status:400});
  assert.equal(JSON.parse(options.body).model,'gpt-3.5-example');
  return sse([{choices:[{delta:{content:'Four.'},finish_reason:null}]},{choices:[{delta:{},finish_reason:'stop'}]}]);
 });
 await f.c.connect({provider:'openai',key});
 for(let i=0;i<2;i++)assert.equal(await f.c.answer({provider:'openai',model:'gpt-3.5-example',messages},()=>{}),'Four.');
 assert.equal(paths.filter(p=>p.endsWith('/responses')).length,1);
 assert.equal(paths.filter(p=>p.endsWith('/chat/completions')).length,2);
});
