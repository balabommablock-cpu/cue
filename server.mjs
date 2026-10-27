import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {resolve,extname,sep} from 'node:path';
import {DEFAULT_MODEL, instructions, sessionConfig} from './prompt.mjs';
import {localCapabilities,checkCodex,transcribePCM,answerWithCodex,prepareLocal,closeLocal,releaseLocal,interruptLocal} from './local-provider.mjs';

import {coachRequest,releaseCoach,validateInput} from './coaching.mjs';
import {knowledge as defaultKnowledge,knowledgeText} from './knowledge.mjs';
import {answerOptions} from './public/model-options.js';
import {validateConversation} from './public/conversation.js';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const appVersion=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8')).version;
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ...['api-setup-ui.js','api-ui.js','preferences-ui.js','setup-ui.js','account-ui.js','story-core.js','coach-ui.js','story-ui.js','voice-notes.js','background-ui.js','model-options.js','progress-ui.js','question-joiner.js','conversation.js'].map(name=>['/'+name,[name,'text/javascript; charset=utf-8']]),
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/core.js', ['core.js', 'text/javascript; charset=utf-8']],
  ['/audio-capture.js', ['audio-capture.js', 'text/javascript; charset=utf-8']],
  ['/audio-routing.js', ['audio-routing.js', 'text/javascript; charset=utf-8']],
  ['/turn-decision.js', ['turn-decision.js', 'text/javascript; charset=utf-8']],
  ['/reader-ui.js', ['reader-ui.js', 'text/javascript; charset=utf-8']],
  ['/speech-pipeline.js', ['speech-pipeline.js', 'text/javascript; charset=utf-8']],
  ['/reading.js', ['reading.js', 'text/javascript; charset=utf-8']],
  ['/pending-turns.js', ['pending-turns.js', 'text/javascript; charset=utf-8']],
  ['/answer-stream.js', ['answer-stream.js', 'text/javascript; charset=utf-8']],
  ['/local-audio.js', ['local-audio.js', 'text/javascript; charset=utf-8']],
  ['/pcm-worklet.js', ['pcm-worklet.js', 'text/javascript; charset=utf-8']],
  ['/sample-question.wav', ['sample-question.wav', 'audio/wav']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/seed.json', ['seed.json', 'application/json; charset=utf-8']],
  ['/platforms.json', ['platforms.json', 'application/json; charset=utf-8']],
  ['/capture-check', ['capture-check.html', 'text/html; charset=utf-8']],
  ['/capture-check.js', ['capture-check.js', 'text/javascript; charset=utf-8']],
  ['/capture-check.css', ['capture-check.css', 'text/css; charset=utf-8']],
]);

function fail(message, status = 400) { return Object.assign(new Error(message), {status}); }
async function body(req,limit=150_000) {
  let size = 0; const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw fail('Request is too large.', 413);
    parts.push(part);
  }
  try { const data=JSON.parse(Buffer.concat(parts).toString());if(!data||typeof data!=='object'||Array.isArray(data))throw fail('Please send a JSON object.');return data; }
  catch { throw fail('Please send valid JSON.'); }
}
function validateProfile(data) {
  if (typeof data.profile !== 'string' || data.profile.trim().length < 20 || data.profile.length > 40_000)
    throw fail('Add a fact sheet between 20 and 40,000 characters.');
  if (!['script', 'cues'].includes(data.style)) throw fail('Choose script or cues.');
}
function validPCM(pcm){
  if(typeof pcm!=='string'||pcm.length<10668||pcm.length>2560000||pcm.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(pcm))return false;
  const bytes=Buffer.from(pcm,'base64');return bytes.length>=8000&&bytes.length<=1920000&&bytes.length%2===0&&bytes.toString('base64')===pcm;
}

export function createApp({workspace=null,knowledge=defaultKnowledge,coach=coachRequest,coachRelease=releaseCoach,apiKey = process.env.OPENAI_API_KEY || '', upstream = fetch, model = process.env.OPENAI_REALTIME_MODEL || DEFAULT_MODEL, local={capabilities:localCapabilities,check:checkCodex,transcribe:transcribePCM,answer:answerWithCodex,prepare:prepareLocal,close:closeLocal,release:releaseLocal,interrupt:interruptLocal}} = {}) {
  const clients = new Map();
  function scope(client,data){
    if(!workspace)return knowledge;
    if(!client.contextToken||data.interviewId!==client.interviewId||data.contextToken!==client.contextToken)throw fail('Interview context changed. Select your interview and start again.',409);
    return workspace.get(client.interviewId);
  }
  function clientFor(req, res) {
    const id = /(?:^|;\s*)cue_session=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (id && clients.has(id)) return clients.get(id);
    if (clients.size > 50) clients.delete(clients.keys().next().value);
    const token = randomBytes(24).toString('hex');
    const c = {key: '', busy: false,sessionKey:token}; clients.set(token, c);
    res.setHeader('Set-Cookie', `cue_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
    return c;
  }
  const server=createServer(async (req, res) => {
    const json = (code, data) => {res.writeHead(code, {'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json(403, {error:'This app is local-only.'});
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(403, {error:'Unexpected request origin.'});
    const path = new URL(req.url, `http://${host}`).pathname;
    if (req.method !== 'GET' && (req.headers.origin !== `http://${host}` || req.headers['x-cue-client'] !== '1'))
      return json(403, {error:'Open the local Cue app to make this request.'});
    const client = clientFor(req, res);
    try {
      if (req.method === 'GET' && path === '/api/config')
        return json(200, {version:appVersion,keyConfigured: !!(client.key || apiKey), keySource: client.key ? 'session' : apiKey ? 'environment' : 'none', model,...local.capabilities(),background:workspace?(client.interviewId?workspace.get(client.interviewId).summary():{}):knowledge.summary()});
      if(req.method==='GET'&&path==='/api/interviews')return json(200,workspace?workspace.list():{legacy:true,interviews:[]});
      if(req.method==='POST'&&path==='/api/interviews'){
        if(!workspace)throw fail('An interview workspace has not been configured.',503);
        return json(201,workspace.create(await body(req)));
      }
      if(req.method==='POST'&&path==='/api/interviews/select'){
        const data=await body(req);if(!workspace)throw fail('An interview workspace has not been configured.',503);
        const chosen=workspace.get(data.interviewId);
        client.prepareController?.abort();client.realtimeController?.abort();client.answerJob?.controller.abort();if(client.conversationKey)local.release?.(client.conversationKey);
        client.conversationKey=null;
        for(const controller of client.coachJobs?.values()||[])controller.abort();
        if(client.contextToken)coachRelease(client.contextToken);
        client.interviewId=data.interviewId;client.contextToken=randomBytes(24).toString('hex');
        return json(200,{contextToken:client.contextToken,background:chosen.view()});
      }
      if(req.method==='GET'&&path==='/api/background')return json(200,workspace?workspace.get(new URL(req.url,`http://${host}`).searchParams.get('interviewId')).view():knowledge.view());
      if(req.method==='POST'&&path==='/api/codex/check'){
        const data=await body(req);scope(client,data);
        if(data.profile!==undefined)validateProfile(data);
        try{answerOptions(data);}catch(e){throw fail(e.message);}
        if(data.audio!==undefined&&typeof data.audio!=='boolean'||data.dual!==undefined&&typeof data.dual!=='boolean'||data.autoDetect!==undefined&&typeof data.autoDetect!=='boolean')throw fail('Invalid preparation options.');
        client.conversationKey=randomBytes(24).toString('hex');const sessionId=client.conversationKey;
        const controller=new AbortController();client.prepareController=controller;res.once('close',()=>{if(!res.writableEnded)controller.abort();});
        try{await local.check();controller.signal.throwIfAborted();await local.prepare?.({...data,sessionKey:sessionId},controller.signal);if(!res.destroyed)return json(200,{...local.capabilities(),sessionId});}catch(e){if(!controller.signal.aborted)throw fail(e.message,503);}finally{if(client.prepareController===controller)client.prepareController=null;if(controller.signal.aborted&&!res.writableEnded)res.end();}return;
      }
      if(req.method==='POST'&&path==='/api/codex/stop'){
        const data=await body(req);if(typeof data.sessionId!=='string'||data.sessionId.length>100)throw fail('Invalid session.');
        if(data.sessionId===client.conversationKey){local.release?.(data.sessionId);client.conversationKey=null;client.coachJobs?.get('live')?.abort();coachRelease(client.contextToken||client.sessionKey,'live');}return json(200,{});
      }
      if(req.method==='POST'&&path.startsWith('/api/coach/')){
        const mode=path.slice('/api/coach/'.length),data=await body(req,250000),activeKnowledge=scope(client,data);const coachKey=client.contextToken||client.sessionKey;
        try{validateInput(mode,data);}catch(e){throw fail(e.message);}
        if(client.coachJobs?.has(mode))throw fail('This coach request is still running. Try again shortly.',429);
        const controller=new AbortController();(client.coachJobs??=new Map()).set(mode,controller);
        res.once('close',()=>{if(!res.writableEnded)controller.abort();});
        try{const result=await coach(mode,{...data,knowledge:mode==='extract'?{records:[]}:activeKnowledge.retrieve(data.question||data.said||'Background career strengths',data.history||[])},controller.signal,coachKey);if(!res.destroyed)json(200,result);}
        catch(e){if(!controller.signal.aborted)throw fail(e.message,503);}
        finally{if(client.coachJobs.get(mode)===controller)client.coachJobs.delete(mode);}return;
      }
      if(req.method==='POST'&&path==='/api/transcribe'){
        const data=await body(req,2_700_000);
        if(!validPCM(data.pcm))throw fail('Valid audio is required.');
        const lane=data.lane??'question';if(!['question','readback'].includes(lane))throw fail('Invalid audio lane.');
        const busyKey=lane==='readback'?'reading':'transcribing';
        if(client[busyKey])throw fail('Speech recognition is busy.',429);
        client[busyKey]=true;const controller=new AbortController();
        res.once('close',()=>{if(!res.writableEnded)controller.abort();});
        try{const text=await local.transcribe(data.pcm,controller.signal,{lane});if(!res.destroyed)json(200,{text:String(text||'').slice(0,4000)});}
        finally{client[busyKey]=false;}
        return;
      }
      if(req.method==='POST'&&path==='/api/answer/interrupt'){
        const data=await body(req);
        if(typeof data.requestId!=='string'||data.requestId.length>100||typeof data.sessionId!=='string')throw fail('Invalid answer reference.');
        const job=client.answerJob;
        if(!job||job.id!==data.requestId||job.sessionKey!==data.sessionId)return json(200,{interrupted:false});
        if(!job.cancelling)job.cancelling=(async()=>{
          job.superseded=true;
          const deadline=setTimeout(()=>job.controller.abort(),3000);
          try{if(!await local.interrupt?.(job.sessionKey))job.controller.abort();await job.settled;}
          catch{job.controller.abort();await job.settled;}
          finally{clearTimeout(deadline);}
        })();
        await job.cancelling;return json(200,{interrupted:true});
      }
      if(req.method==='POST'&&path==='/api/answer'){
        const data=await body(req,2_800_000);const activeKnowledge=scope(client,data);validateProfile(data);
        try{answerOptions(data);}catch(e){throw fail(e.message);}
        if(data.requestId!==undefined&&(typeof data.requestId!=='string'||!data.requestId||data.requestId.length>100))throw fail('Invalid answer reference.');
        if(data.autoDetect!==undefined&&typeof data.autoDetect!=='boolean')throw fail('Invalid conversation mode.');
        if(data.inputSource!==undefined&&!['mic','system','shared'].includes(data.inputSource))throw fail('Invalid audio source.');
        const question=typeof data.question==='string'?data.question.trim():'';
        if(question.length>4000)throw fail('Keep the question under 4,000 characters.');
        if(!question&&!validPCM(data.pcm))throw fail('A question or valid audio is required.');
        if(data.history!==undefined&&(!Array.isArray(data.history)||data.history.length>6||data.history.some(x=>!x||typeof x.question!=='string'||typeof x.answer!=='string'||x.question.length>4000||x.answer.length>6000)))throw fail('Conversation context is too large.');
        try{data.conversation=validateConversation(data.conversation);}catch(e){throw fail(e.message);}
        if(!question&&client.transcribing)throw fail('Speech recognition is busy. Try again in a moment.',429);
        if(client.busy)throw fail('An answer is already in progress. Please wait.',429);
        client.busy=true;const controller=new AbortController();
        let settle;const job={id:data.requestId,sessionKey:client.conversationKey||client.contextToken||client.sessionKey,controller,settled:new Promise(r=>settle=r)};client.answerJob=job;
        res.once('close',()=>{if(!res.writableEnded)controller.abort();});
        res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'});res.flushHeaders();
        const started=performance.now();
        const emit=event=>{if(!res.destroyed&&!job.superseded)res.write(JSON.stringify({...event,elapsedMs:Math.round(performance.now()-started)})+'\n');};
        try{
          emit({type:'accepted',requestId:job.id});
          let q=question;
          if(!q){client.transcribing=true;try{emit({type:'stage',text:'Transcribing on your Mac…'});q=await local.transcribe(data.pcm,controller.signal);}finally{client.transcribing=false;}}
          controller.signal.throwIfAborted();
          if(!q){emit({type:'empty'});return;}
          q=q.slice(0,4000);emit({type:'question',text:q});emit({type:'stage',step:'match',text:'Selecting useful context…'});
          const background=activeKnowledge.retrieve(q,data.history||[]);
          emit({type:'stage',step:'draft',text:'Preparing your answer…'});
          await local.answer({...data,knowledge:background,question:q,sessionKey:job.sessionKey},emit,controller.signal);emit({type:'done'});
        }catch(e){if(!controller.signal.aborted)emit({type:'error',message:e.message});}
        finally{if(client.answerJob===job){client.busy=false;client.answerJob=null;}res.end();settle();}
        return;
      }
      if (req.method === 'POST' && path === '/api/key') {
        const data = await body(req);
        if (typeof data.key !== 'string' || data.key.length < 20 || data.key.length > 512 || /\s/.test(data.key)) throw fail('Enter a valid OpenAI API key.');
        client.key = data.key;
        return json(200, {keyConfigured:true});
      }
      if (req.method === 'DELETE' && path === '/api/key') {client.key='';return json(200,{keyConfigured:!!apiKey});}
      if (req.method === 'POST' && path === '/api/instructions') {
        const data=await body(req); const activeKnowledge=scope(client,data);validateProfile(data);
        return json(200,{instructions:instructions(data.profile,data.style)+knowledgeText(workspace?activeKnowledge.retrieve('Career strengths experience '+data.profile,[],16000):{records:knowledge.view().records})});
      }
      if (req.method === 'POST' && path === '/api/session') {
        const data=await body(req); const activeKnowledge=scope(client,data);validateProfile(data);
        if (typeof data.sdp !== 'string' || !data.sdp.startsWith('v=0') || data.sdp.length > 50_000) throw fail('The browser did not provide a valid audio connection offer.');
        if (!(client.key || apiKey)) throw fail('Add an OpenAI API key in Connection first.',503);
        if (client.busy) throw fail('A connection is already being created. Please wait.',429);
        client.busy=true;const sessionController=new AbortController();client.realtimeController=sessionController;
        try {
          const fd=new FormData(); fd.set('sdp',data.sdp);
          const session=sessionConfig({...data,model});
          session.instructions+=knowledgeText(workspace?activeKnowledge.retrieve('Career strengths experience '+data.profile,[],16000):{records:knowledge.view().records});
          fd.set('session',JSON.stringify(session));
          const result=await upstream('https://api.openai.com/v1/realtime/calls',{
            method:'POST', headers:{Authorization:`Bearer ${client.key || apiKey}`},body:fd,signal:AbortSignal.any([sessionController.signal,AbortSignal.timeout(25_000)]),
          });
          const text=await result.text();
          if (!result.ok) {
            const messages={401:'OpenAI rejected the API key. Check Connection.',403:'This API project does not have access. Check the project permissions.',429:'OpenAI rate limit or API credit limit reached. Check your API billing and limits.'};
            throw fail(messages[result.status] || `OpenAI could not start the session (HTTP ${result.status}). Check model access and try again.`,502);
          }
          if (!text.startsWith('v=0')) throw fail('OpenAI returned an unexpected connection response.',502);
          res.writeHead(200,{'Content-Type':'application/sdp'});return res.end(text);
        } finally {client.busy=false;if(client.realtimeController===sessionController)client.realtimeController=null;}
      }
      if(req.method==='GET'&&path.startsWith('/device/')){
        const base=resolve(root,'device'),file=resolve(base,decodeURIComponent(path.slice('/device/'.length)));
        if(!file.startsWith(base+sep))return json(403,{error:'Invalid asset path.'});
        const type={'.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.json':'application/json'}[extname(file)];
        if(!type)return json(404,{error:'Not found.'});
        try{const bytes=await readFile(file);res.writeHead(200,{'Content-Type':type});return res.end(bytes);}catch{return json(404,{error:'Local model assets unavailable. Reinstall this build.'});}
      }
      if (req.method === 'GET' && files.has(path)) {
        const [name,type]=files.get(path);res.writeHead(200,{'Content-Type':type});return res.end(await readFile(resolve(root,name)));
      }
      return json(404,{error:'Not found.'});
    } catch(e) {
      if (!res.headersSent) json(e.status || 500,{error:e.status ? e.message : e.name === 'TimeoutError' ? 'OpenAI took too long to respond. Try again.' : 'The local server could not complete this request.'});
      else res.end();
    }
  });
  server.disposeLocal=()=>{local.close?.();coachRelease();};server.once('close',server.disposeLocal);return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT || 4329);
  const server=createApp();
  server.on('error',err=>{console.error(err.code==='EADDRINUSE' ? `Port ${port} is in use. Set PORT to another number.` : 'Could not start the local server.');process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`Cue is ready at http://127.0.0.1:${port} — audio starts only when you connect.`));
}
