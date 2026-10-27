import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {writingInstructions as localInstructions} from './prompt.mjs';
import {WarmWriterPool} from './codex-stream.mjs';
import {SpeechWorker} from './speech-worker.mjs';
import {createHash} from 'node:crypto';
import {answerContext,answerPrompt} from './answer-context.mjs';
import {answerOptions} from './public/model-options.js';

export const codexPath=process.env.CUE_CODEX_PATH || ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex','/Applications/Codex.app/Contents/Resources/codex'].find(existsSync);
export const pythonPath=process.env.CUE_PYTHON_PATH || join(homedir(),'.local/share/cue/venv/bin/python');
export const localCapabilities=()=>({codexAvailable:!!codexPath,localAudioAvailable:existsSync(pythonPath)});
function child(command,args,{input='',signal,timeout=90000,onLine=()=>{}}={}){
  return new Promise((resolve,reject)=>{
    const p=spawn(command,args,{stdio:['pipe','pipe','pipe'],env:{...process.env,RUST_LOG:'error',HF_HUB_OFFLINE:'1'}});
    let buffer='',output='',finished=false;
    const finish=(error)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){p.kill('SIGKILL');reject(error);}else resolve(output);};
    const abort=()=>finish(new Error('Stopped.'));
    const timer=setTimeout(()=>finish(new Error('The local provider took too long. Try a shorter question.')),timeout);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    p.on('error',()=>finish(new Error('The local provider could not start.')));
    p.stderr.on('data',()=>{}); // Never expose diagnostics that could include personal context.
    p.stdout.on('data',b=>{output+=b;buffer+=b;if(output.length>1_000_000)return finish(new Error('Provider output exceeded the limit.'));let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{onLine(line);}catch(e){finish(e);return;}}});
    p.on('close',code=>{if(buffer){try{onLine(buffer);}catch(e){finish(e);return;}}finish(code===0?null:new Error('Codex or local speech recognition failed. Check your login and local setup.'));});
    p.stdin.on('error',()=>{});p.stdin.end(input);
  });
}
export async function checkCodex(){
  if(!codexPath)throw new Error('Codex is not installed. Use the API option or install and sign in to Codex.');
  // login status writes its status to stderr in some versions. Exit code verifies login.
  await child(codexPath,['login','status'],{timeout:10000});
  return localCapabilities();
}
const writer=new WarmWriterPool({command:codexPath});
const speech=new Map();let scriptPromise,workspacePromise,owner;
function workspace(){return workspacePromise??=mkdtemp(join(tmpdir(),'cue-text-'));}
async function decoder(lane='question'){
  if(!existsSync(pythonPath))throw new Error('Local speech recognition is not installed. Choose Typed questions only.');
  if(!['question','readback'].includes(lane))throw new Error('Invalid audio lane.');
  const script=await(scriptPromise??=readFile(new URL('./transcribe.py',import.meta.url),'utf8'));
  if(!speech.has(lane))speech.set(lane,new SpeechWorker({command:pythonPath,script}));
  return speech.get(lane);
}
export async function writingOptions({profile='',style='cues',autoDetect=false,sessionKey='local',answerModel,answerSpeed}){
  const selection=answerOptions({answerModel,answerSpeed});
  const cwd=await workspace();
  const writingInstructions=localInstructions(style);
  // Only generic rules reach this temporary file, never the profile or audio.
  const ruleKey=createHash('sha256').update(writingInstructions).digest('hex');
  const instructionPath=join(cwd,ruleKey+'.txt');
  await writeFile(instructionPath,writingInstructions,{mode:0o600});
  return {...selection,cwd,instructionPath,writingInstructions,warmPrompt:'Connection check only; no interview question yet. Personal evidence will be supplied only when relevant. Respond exactly WAIT: Ready.',key:createHash('sha256').update(JSON.stringify([sessionKey,profile,style])).digest('hex')};
}
export async function prepareLocal(options={},signal){
  if(!codexPath)throw new Error('Codex is not installed.');
  signal?.throwIfAborted();owner=options.sessionKey;
  const abort=()=>{if(owner!==options.sessionKey)return;writer.close(new DOMException('Stopped.','AbortError'));for(const worker of speech.values())worker.close();};
  signal?.addEventListener('abort',abort,{once:true});
  try{await Promise.all([
    writingOptions(options).then(value=>{signal?.throwIfAborted();return writer.warm({...value,signal});}),
    ...(options.audio?[decoder().then(worker=>{signal?.throwIfAborted();return worker.warm();})]:[]),
    ...(options.dual?[decoder('readback').then(worker=>{signal?.throwIfAborted();return worker.warm();})]:[]),
  ]);}finally{signal?.removeEventListener('abort',abort);}
  return localCapabilities();
}
export async function transcribePCM(pcm,signal,{lane='question'}={}){
  signal?.throwIfAborted();return (await decoder(lane)).transcribe(pcm,signal);
}
export async function answerWithCodex({question,profile,style,history=[],conversation=[],autoDetect=false,inputSource,sessionKey,knowledge,answerModel,answerSpeed},emit,signal){
  if(!codexPath)throw new Error('Codex is not installed.');
  signal?.throwIfAborted();
  owner=sessionKey;const options=await writingOptions({profile,style,autoDetect,sessionKey,answerModel,answerSpeed});
  const context=answerContext({question,profile,history,conversation,knowledge,autoDetect});
  const prompt=answerPrompt({...context,question,autoDetect,inputSource});
  emit({type:'context',mode:context.mode,records:context.knowledge.records.length,historyTurns:context.history.length});
  return writer.run({...options,prompt,signal,emit,allowWait:autoDetect,allowUnframed:true,firstTextMs:8000,totalTimeoutMs:20000});
}
export async function interruptLocal(sessionKey){return owner===sessionKey?writer.interrupt():false;}
export function releaseLocal(sessionKey){if(owner===sessionKey)closeLocal();}
export function closeLocal(){
  owner=undefined;
  writer.close();for(const worker of speech.values())worker.close();speech.clear();
  const previous=workspacePromise;workspacePromise=null;previous?.then(dir=>rm(dir,{recursive:true,force:true})).catch(()=>{});
}
