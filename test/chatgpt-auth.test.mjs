import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {createChatGPTConnection} from '../chatgpt-auth.mjs';
function encryption(){const key=randomBytes(32);return {isAvailable:()=>true,encrypt:s=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(s),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]);},decrypt:b=>{const d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString();}};}
async function fixture(t,options={}){
 const directory=await mkdtemp(join(tmpdir(),'cue-auth-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));const crypt=encryption();const calls=[];let url,nonce,client,refreshes=0;
 const config={directory,encryption:crypt,openBrowser:async u=>{url=new URL(u);nonce=url.searchParams.get('nonce');await options.open?.(url);},verifyIdentity:async()=>({sub:options.subject||'synthetic-subject',email:'synthetic@example.test',nonce:options.badNonce?'bad':nonce}),fetcher:async(u,init)=>{
 calls.push({url:u,method:init?.method,body:init?.body?.toString()});
 if(u.includes('openid-configuration'))return Response.json({issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/jwks',revocation_endpoint:'https://auth.openai.com/revoke'});
 if(u.endsWith('/revoke'))return new Response('',{status:options.revokeFail?500:200});
 if(u.endsWith('/token')){const form=new URLSearchParams(init.body);if(form.get('grant_type')==='refresh_token')refreshes++;
 return Response.json({token_type:'Bearer',access_token:'secret-access',refresh_token:'secret-refresh-'+refreshes,id_token:'secret-id',expires_in:options.shortExpiry&&refreshes===0?1:3600,scope:options.noSharing?'openid email':'openid email chatgpt.tokens.use.direct'});}
 if(u.endsWith('/models'))return Response.json({models:[{slug:'test-model',display_name:'Test model',visibility:'list'},{slug:'hidden',visibility:'hidden'}]});
 if(u.endsWith('/responses')){const events=options.stream||[{type:'response.output_text.delta',delta:'A useful answer.'},{type:'response.completed'}];return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));}
 throw new Error('Unexpected test request');}};
 client=await createChatGPTConnection(config);t.after(()=>client.close());
 async function signin(extra={}){const promise=client.signIn(extra);promise.catch(()=>{});while(!url)await new Promise(r=>setImmediate(r));const callback=new URL(url.searchParams.get('redirect_uri'));callback.search=new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic-code',client_id:url.searchParams.get('client_id')==='dynamic_agent_client'?'issued-'+Date.now():url.searchParams.get('client_id')});await fetch(callback);const result=await promise;url=null;return result;}
 return {client,calls,config,directory,signin,getURL:()=>url,getRefreshes:()=>refreshes};
}
test('OAuth uses loopback, PKCE, validates state and protects stored credentials; restart retains registration',async t=>{
 const f=await fixture(t);const attempt=f.client.signIn();while(!f.getURL())await new Promise(r=>setImmediate(r));const u=f.getURL();assert.equal(u.origin,'https://auth.openai.com');assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.equal(u.searchParams.get('client_id'),'dynamic_agent_client');assert.ok(u.searchParams.get('ext_agent_host_id').startsWith('urn:uuid:'));
 const cb=new URL(u.searchParams.get('redirect_uri'));assert.equal(cb.hostname,'127.0.0.1');cb.search=new URLSearchParams({state:'😀'.repeat(43),code:'wrong',client_id:'wrong'});assert.equal((await fetch(cb)).status,400);assert.equal(f.calls.length,0);
 cb.search=new URLSearchParams({state:u.searchParams.get('state'),code:'synthetic',client_id:'issued-test'});await fetch(cb);await attempt;
 const bytes=await readFile(join(f.directory,'account.enc'));assert.equal(bytes.includes(Buffer.from('secret-access')),false);assert.equal((await stat(join(f.directory,'account.enc'))).mode&0o777,0o600);
 assert.equal(JSON.stringify(f.client.status()).includes('secret'),false);const restored=await createChatGPTConnection(f.config);assert.equal(restored.status().sharing,true);restored.close();
});
test('denied access and cancelled sign-in leave no usable account',async t=>{
 const f=await fixture(t);let attempt=f.client.signIn();attempt.catch(()=>{});while(!f.getURL())await new Promise(r=>setImmediate(r));let u=f.getURL(),cb=new URL(u.searchParams.get('redirect_uri'));cb.search=new URLSearchParams({state:u.searchParams.get('state'),error:'access_denied'});await fetch(cb);await assert.rejects(attempt,{code:'access_denied'});assert.equal(f.client.status().sharing,false);
 attempt=f.client.signIn();f.client.cancelSignIn();await assert.rejects(attempt);assert.equal(f.client.status().sharing,false);
});
test('identity nonce mismatch never connects',async t=>{const f=await fixture(t,{badNonce:true});await assert.rejects(f.signin(),{code:'identity_mismatch'});assert.equal(f.client.status().sharing,false);});
test('identity-only grant cannot make model or inference requests',async t=>{const f=await fixture(t,{noSharing:true});await f.signin();await assert.rejects(f.client.models(),{code:'sharing_not_enabled'});assert.equal(f.calls.some(c=>c.url.endsWith('/models')),false);});
test('concurrent requests refresh once; request constraints and completed streaming are enforced',async t=>{const f=await fixture(t,{shortExpiry:true});await f.signin();const [a,b]=await Promise.all([f.client.models(),f.client.models()]);assert.equal(f.getRefreshes(),1);assert.deepEqual(a,b);assert.equal(a.length,1);let text='';await f.client.answer({model:'test-model',messages:[{role:'system',content:'Helpful'},{role:'user',content:'Hello\n/no_think'}]},s=>text=s);assert.equal(text,'A useful answer.');const sent=JSON.parse(f.calls.find(c=>c.url.endsWith('/responses')).body);assert.equal(sent.store,false);assert.equal(sent.stream,true);assert.equal(sent.input[0].content,'Hello');assert.equal(sent.instructions,'Helpful');assert.equal('temperature'in sent,false);});
test('late usage error does not mark a streamed partial answer complete',async t=>{const f=await fixture(t,{stream:[{type:'response.output_text.delta',delta:'Partial'},{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}]});await f.signin();await assert.rejects(f.client.answer({model:'test',messages:[{role:'user',content:'Hi'}]},()=>{}),{code:'usage_limit'});});
test('truncated streams fail; local signout clears credentials and reports failed revocation',async t=>{const f=await fixture(t,{stream:[{type:'response.output_text.delta',delta:'Partial'}],revokeFail:true});await f.signin();await assert.rejects(f.client.answer({model:'test',messages:[{role:'user',content:'Hi'}]},()=>{}),{code:'incomplete'});const result=await f.client.disconnect();assert.equal(result.revoked,false);assert.equal(result.sharing,false);assert.equal(result.accounts.length,1);await assert.rejects(f.client.models(),{code:'sign_in_required'});});
test('sign-in refuses unprotected credential storage',async t=>{const directory=await mkdtemp(join(tmpdir(),'cue-unsafe-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));await assert.rejects(createChatGPTConnection({directory,encryption:{isAvailable:()=>false},openBrowser:()=>{}}),{code:'storage_unavailable'});});
