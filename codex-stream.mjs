import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import {turnDecision} from './public/turn-decision.js';

function validJSON(text){try{const v=JSON.parse(text);return !!v&&typeof v==='object'&&!Array.isArray(v);}catch{return false;}}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};};
const WRITING_FEATURES={shell_tool:false,unified_exec:false,shell_snapshot:false,multi_agent:false,multi_agent_v2:false,apps:false,browser_use:false,browser_use_external:false,in_app_browser:false,computer_use:false,code_mode:false,code_mode_host:false,hooks:false,memories:false,skill_mcp_dependency_install:false};

// A stdio connection to the official Codex app-server. Authentication stays
// inside Codex; this application never reads or copies its credential files.
export class CodexConnection {
  constructor(command,{cwd,signal,spawnProcess=spawn,timeout=90000}={}){
    this.pending=new Map();this.nextId=0;this.buffer='';this.bytes=0;this.closed=false;this.decoder=new StringDecoder('utf8');
    this.onNotification=()=>{};this.onFailure=()=>{};
    this.process=spawnProcess(command,['app-server','--stdio',...Object.entries(WRITING_FEATURES).flatMap(([key,value])=>['-c',`features.${key}=${value}`]),'-c','web_search="disabled"','-c','analytics.enabled=false','-c','otel.log_user_prompt=false','-c','notify=[]'],{cwd,stdio:['pipe','pipe','pipe'],env:{...process.env,RUST_LOG:'error'}});
    this.abort=()=>this.fail(new Error('Stopped.'));
    this.signal=signal;signal?.addEventListener('abort',this.abort,{once:true});
    this.timer=timeout?setTimeout(()=>this.fail(new Error('Codex took too long. Check your connection and try again.')),timeout):null;
    this.process.on('error',()=>this.fail(new Error('Codex could not start. Check its installation.')));
    this.process.on('close',()=>{if(!this.closed)this.fail(new Error('The Codex connection ended early. Try again.'));});
    this.process.stderr.on('data',()=>{});
    this.process.stdin.on('error',()=>{});
    this.process.stdout.on('data',chunk=>this.receive(chunk));
    if(signal?.aborted)this.abort();
  }
  send(message){if(this.closed)throw this.error||new Error('Codex is disconnected.');this.process.stdin.write(JSON.stringify(message)+'\n');}
  call(method,params){
    if(this.closed)return Promise.reject(this.error||new Error('Codex is disconnected.'));
    const id=++this.nextId,job=deferred();this.pending.set(id,job);
    try{this.send({id,method,params});}catch(e){this.pending.delete(id);job.reject(e);}
    return job.promise;
  }
  receive(chunk){
    if(this.closed)return;this.bytes+=chunk.length;
    if(this.bytes>2_000_000)return this.fail(new Error('Codex returned too much data. Try a shorter question.'));
    this.buffer+=this.decoder.write(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));let n;
    while((n=this.buffer.indexOf('\n'))>=0){
      const line=this.buffer.slice(0,n);this.buffer=this.buffer.slice(n+1);let message;
      try{message=JSON.parse(line);}catch{continue;}
      if(!message||typeof message!=='object'||Array.isArray(message))continue;
      if(message.method&&message.id!==undefined){
        // This is a writing-only client. Never approve or execute a requested tool.
        this.send({id:message.id,error:{code:-32601,message:'Cue does not provide tools or approvals.'}});
        this.fail(new Error('Codex requested an unsupported action. No action was approved.'));return;
      }
      if(message.id!==undefined){
        const job=this.pending.get(message.id);if(!job)continue;this.pending.delete(message.id);
        if(message.error)job.reject(new Error('Codex could not start this request. Check model access and usage limits.'));
        else job.resolve(message.result);
      }else if(message.method){try{this.onNotification(message.method,message.params||{});}catch(e){this.fail(e);return;}}
    }
  }
  fail(error){if(this.closed)return;this.error=error;this.onFailure(error);this.close(error);}
  close(error=new Error('Stopped.')){
    if(this.closed)return;this.closed=true;clearTimeout(this.timer);this.signal?.removeEventListener('abort',this.abort);
    for(const job of this.pending.values())job.reject(error);this.pending.clear();
    this.process.kill('SIGKILL');
  }
}

// A bounded, reusable writing conversation. Reuse preserves the provider's warm
// transport/prompt prefix. Full fact/context snapshots remain authoritative.
// Profile/session changes and Stop discard the conversation. A confirmed turn
// interruption keeps the warm transport available for a corrected question.
export class CodexSession {
  constructor({command,connectionFactory=(...args)=>new CodexConnection(...args),idleMs=300000,maxTurns=6,interruptMs=2500,isolatedTurns=false}={}){
    Object.assign(this,{command,connectionFactory,idleMs,maxTurns,interruptMs,isolatedTurns});this.busy=false;
  }
  prepare(options){if(this.busy)throw new Error('An answer is already in progress.');return this.ensure(options);}
  async warm(options){
    await this.prepare(options);
    if(this.turns)return;
    // Establish the model-side connection before the first interview question.
    // This small, explicit startup request is never shown as an interview answer.
    await this.run({...options,prompt:options.warmPrompt||'Connection check only; no interview question yet. Respond exactly WAIT: Ready.',allowWait:true,emit:()=>{}});
  }
  ensure(options){
    const key=JSON.stringify([options.cwd,options.key,options.writingInstructions,options.model||'gpt-6-luna',options.effort||'low',options.serviceTier||'default']);
    clearTimeout(this.idle);
    if(this.ready&&this.rpc&&!this.rpc.closed&&this.key===key&&this.turns<this.maxTurns&&(this.isolatedTurns||this.contextSize<100000)){
      if(this.isolatedTurns&&this.threadUsed){
        this.threadUsed=false;
        // Keep the initialized transport but never carry a previous answer's
        // hidden model context into this request. History is explicitly scoped.
        this.ready=this.ready.then(session=>this.startThread(session.rpc,options,session.inherited));
        this.ready.catch(()=>{});
      }
      return this.ready;
    }
    this.close();this.key=key;this.turns=0;this.contextSize=0;this.threadUsed=false;
    this.ready=this.open(options);this.ready.catch(()=>{});return this.ready;
  }
  async open({cwd,instructionPath,writingInstructions,model='gpt-6-luna',effort='low',serviceTier='default'}){
    const rpc=this.connectionFactory(this.command,{cwd,timeout:0});this.rpc=rpc;
    const setupTimer=setTimeout(()=>rpc.fail(new Error('Codex could not warm up. Check your connection and retry.')),20000);
    try{
      await rpc.call('initialize',{clientInfo:{name:'cue_local',title:'Cue',version:'1.23.0'},capabilities:{experimentalApi:true}});
      rpc.send({method:'initialized'});
      const {config:inherited={}}=await rpc.call('config/read',{includeLayers:false,cwd});
      return await this.startThread(rpc,{cwd,instructionPath,writingInstructions,model,effort,serviceTier},inherited);
    }catch(e){if(this.rpc===rpc)this.close(e);throw e;}finally{clearTimeout(setupTimer);}
  }
  async startThread(rpc,{cwd,instructionPath,writingInstructions,model='gpt-6-luna',effort='low',serviceTier='default'},inherited={}){
    const startedAt=performance.now();
    const config={model_instructions_file:instructionPath,developer_instructions:'',web_search:'disabled',project_doc_max_bytes:0,include_environment_context:false,include_apps_instructions:false,model_reasoning_effort:effort,service_tier:serviceTier,features:{...WRITING_FEATURES,fast_mode:serviceTier!=='default'},memories:{generate_memories:false,use_memories:false},mcp_servers:Object.fromEntries(Object.keys(inherited.mcp_servers||{}).map(name=>[name,{enabled:false}])),plugins:Object.fromEntries(Object.keys(inherited.plugins||{}).map(name=>[name,{enabled:false}])),apps:{_default:{enabled:false}}};
    const started=await rpc.call('thread/start',{cwd,model,serviceTier,approvalPolicy:'never',sandbox:'read-only',ephemeral:true,config,baseInstructions:writingInstructions,developerInstructions:'Do not call tools. Only produce the requested answer text. Each new message supplies the authoritative fact sheet and recent conversation snapshot. That snapshot REPLACES all earlier conversation context, including previous API turns absent from it. Resolve short follow-ups only from the supplied current snapshot. Earlier generated answers are never evidence.'});
    if(rpc.closed||this.rpc!==rpc)throw new Error('Stopped.');
    const session={rpc,threadId:started.thread.id,model:started.model||model,serviceTier:started.serviceTier??'default',effort:started.reasoningEffort||effort,inherited,disabledPluginIds:Object.keys(inherited.plugins||{}),preparationMs:Math.round(performance.now()-startedAt)};
    if(started.model&&started.model!==model)throw new Error('Codex selected a different model. Choose an available model in Settings.');
    if(serviceTier==='ultrafast'&&session.serviceTier!=='ultrafast')throw new Error('Ultrafast is not available on this Codex connection.');
    this.armIdle();return session;
  }
  async interrupt(){
    const run=this.activeRun;if(!run)return false;
    if(!run.requested){
      run.requested=true;
      run.timer=setTimeout(()=>{const error=new DOMException('Question replaced.','AbortError');run.done.reject(error);this.close(error);},this.interruptMs);
      run.send?.();
    }
    await run.settled.promise;return true;
  }
  async run(options){
    if(this.busy)throw new Error('An answer is already in progress. Please wait.');
    options.signal?.throwIfAborted();this.busy=true;
    const done=deferred(),begin=performance.now();let rpc,text='',itemId,threadId;
    const run={done,settled:deferred(),requested:false,terminal:false};this.activeRun=run;
    let firstTextTimer;
    const phases={};const itemPhases=new Map();let turnId,acknowledged=false;const early=[];
    const abort=()=>{const error=new DOMException('Stopped.','AbortError');done.reject(error);this.close(error);};
    const timeout=setTimeout(()=>{const error=new Error('Codex took too long. Check your connection and try again.');done.reject(error);this.close(error);},options.totalTimeoutMs||90000);
    options.signal?.addEventListener('abort',abort,{once:true});
    try{
      const session=await this.ensure(options);({rpc,threadId}=session);
      options.signal?.throwIfAborted();clearTimeout(this.idle);rpc.bytes=0;
      phases.readyMs=Math.round(performance.now()-begin);this.activeDone=done;
      rpc.onFailure=error=>done.reject(error);
      const receive=(method,p)=>{
        if(turnId&&(p.turnId||p.turn?.id)&&(p.turnId||p.turn?.id)!==turnId)return;
        if(p.threadId!==threadId||options.signal?.aborted)return;
        if(run.requested&&method!=='turn/completed')return;
        if(method==='item/started'){
          if(p.item?.type==='agentMessage')itemPhases.set(p.item.id,p.item.phase);
          if(['commandExecution','fileChange','mcpToolCall','dynamicToolCall','webSearch','collabAgentToolCall'].includes(p.item?.type))throw new Error('Codex attempted a tool action. This writing-only session was stopped.');
        }
        if(method==='item/agentMessage/delta'&&!['commentary','analysis','reasoning'].includes(itemPhases.get(p.itemId))){
          if(itemId!==p.itemId){itemId=p.itemId;text='';}
          text+=p.delta;if(text.length>12000)throw new Error('The answer exceeded the length limit.');
          if(turnDecision(text)==='answer'||turnDecision(text)==='wait'||options.allowUnframed&&text.trim()&&!/^\s*(?:A|AN|ANS|ANSW|ANSWE|ANSWER|W|WA|WAI|C|CH|CHE|CHEC|CHECK)(?::|\s*)$/.test(text))clearTimeout(firstTextTimer);
          phases.firstDeltaMs??=Math.round(performance.now()-begin);options.emit({type:'answer',text,streaming:true});
        }
        if(method==='item/completed'&&p.item?.type==='agentMessage'&&!['commentary','analysis','reasoning'].includes(p.item.phase)){
          text=p.item.text||text;clearTimeout(firstTextTimer);if(typeof text!=='string'||text.length>12000)throw new Error('The answer exceeded the length limit.');options.emit({type:'answer',text,streaming:false});
        }
        if(method==='turn/completed'){
          run.terminal=['completed','interrupted'].includes(p.turn?.status);
          if(run.requested&&run.terminal){done.reject(new DOMException('Question replaced.','AbortError'));return;}
          // Exact-output tasks can legitimately produce bare JSON, code or a
          // translation despite the ANSWER envelope. Recover only a completed
          // final message; never reinterpret WAIT, empty protocol fields,
          // structured coaching output, or interrupted/failed generations.
          if(p.turn?.status==='completed'&&options.allowUnframed&&!options.outputSchema&&text.trim()&&!/^\s*(?:ANSWER|WAIT|CHECK|QUESTION)(?::|\s*$)/.test(text)){
            text='ANSWER:\n'+text.trim();
            if(text.length>12000)throw new Error('The answer exceeded the length limit.');
            options.emit({type:'answer',text,streaming:false});
          }
          if(p.turn?.status==='completed'&&(options.outputSchema?validJSON(text):(turnDecision(text)==='answer'||options.allowWait&&turnDecision(text)==='wait')))done.resolve(text);
          else done.reject(new Error('Codex did not complete an answer. Check your connection, model access and usage limits.'));
        }
      };
      rpc.onNotification=(method,p)=>{if(!acknowledged){if(early.length>=500)throw new Error('Codex sent too many early events.');early.push([method,p]);}else receive(method,p);};
      if(options.firstTextMs)firstTextTimer=setTimeout(()=>{const error=Object.assign(new Error('The model did not start an answer in time.'),{code:'FIRST_TEXT_TIMEOUT'});done.reject(error);this.close(error);},options.firstTextMs);
      const started=await rpc.call('turn/start',{threadId,input:[{type:'text',text:options.prompt}],effort:options.effort||'low',serviceTierForTurn:options.serviceTier||'default',disabledPluginIds:session.disabledPluginIds,...(options.outputSchema?{outputSchema:options.outputSchema}:{})});
      turnId=started?.turn?.id;acknowledged=true;for(const [method,p] of early)receive(method,p);early.length=0;
      run.send=()=>{
        if(run.terminal||run.sent||rpc.closed)return;run.sent=true;
        if(!turnId){const error=new DOMException('Question replaced.','AbortError');done.reject(error);this.close(error);return;}
        // The RPC acknowledgement is not the end of a turn. Only its matching
        // terminal notification makes reuse safe; the deadline closes failures.
        rpc.call('turn/interrupt',{threadId,turnId}).catch(error=>{if(this.activeRun===run&&!run.terminal){done.reject(error);this.close(error);}});
      };
      if(run.requested)run.send();
      phases.turnStartedMs=Math.round(performance.now()-begin);
      const result=await done.promise;this.threadUsed=true;this.turns++;this.contextSize+=(options.prompt||'').length+text.length;
      options.emit({type:'timing',selection:{model:session.model,serviceTier:session.serviceTier,effort:session.effort},phases:{...phases,totalMs:Math.round(performance.now()-begin)}});return result;
    }catch(e){
      if(run.requested&&run.terminal&&e.name==='AbortError'&&!options.signal?.aborted&&!rpc?.closed){this.threadUsed=true;this.turns++;this.contextSize+=(options.prompt||'').length+text.length;}
      else this.close(e);
      throw e;
    }
    finally{
      clearTimeout(timeout);clearTimeout(firstTextTimer);clearTimeout(run.timer);options.signal?.removeEventListener('abort',abort);this.activeDone=null;this.busy=false;
      if(this.activeRun===run)this.activeRun=null;run.settled.resolve();
      if(rpc){rpc.onNotification=()=>{};rpc.onFailure=()=>{};}
      if(this.rpc&&!this.rpc.closed)this.armIdle();
    }
  }
  armIdle(){clearTimeout(this.idle);if(this.idleMs>0){this.idle=setTimeout(()=>this.close(),this.idleMs);this.idle.unref?.();}}
  close(error=new Error('Stopped.')){
    clearTimeout(this.idle);this.activeDone?.reject(error);this.rpc?.close(error);this.rpc=null;this.ready=null;this.key=null;
  }
}

// One-shot compatibility for isolated callers and protocol tests.
export async function streamCodex(options){
  const session=new CodexSession(options);
  try{return await session.run(options);}finally{session.close();}
}

// Each slot sees only a generic connection check and ONE real question. Prime
// its replacement while the user reads, so history isolation needs no cold
// model connection on the normal answer path. Two ready slots plus one active
// request is the strict maximum; preparation overlaps the current answer.
// The active pool owns their lifetime: Stop or a setting change closes them.
// Do not expire ready workers midway through a long spoken answer.
export class WarmWriterPool {
  constructor({command,sessionFactory=()=>new CodexSession({command,maxTurns:2,idleMs:0}),size=2}={}){
    Object.assign(this,{sessionFactory,size});this.slots=[];this.epoch=0;this.busy=false;
  }
  identity(options){return JSON.stringify([options.cwd,options.key,options.writingInstructions,options.model,options.effort,options.serviceTier]);}
  prime(options){
    const controller=new AbortController(),worker=this.sessionFactory(),slot={worker,controller};
    slot.ready=worker.warm({...options,firstTextMs:12000,totalTimeoutMs:20000,signal:controller.signal}).then(()=>{slot.state='ready';return slot;},error=>{slot.state='failed';throw error;});slot.ready.catch(()=>{});
    return slot;
  }
  setup(options){
    const key=this.identity(options);
    if(this.key!==key){this.close();this.key=key;this.options=options;this.slots=Array.from({length:this.size},()=>this.prime(options));}
  }
  async warm(options){
    this.setup(options);
    const stop=()=>this.close(new DOMException('Stopped.','AbortError'));
    options.signal?.addEventListener('abort',stop,{once:true});
    try{options.signal?.throwIfAborted();await Promise.any(this.slots.map(s=>s.ready));}
    catch(error){this.close(error);throw error.errors?.[0]||error;}
    finally{options.signal?.removeEventListener('abort',stop);}
  }
  async run(options){
    if(this.busy)throw new Error('An answer is already in progress.');
    options.signal?.throwIfAborted();this.setup(options);this.busy=true;
    const epoch=this.epoch;let slot;
    const stop=()=>this.close(new DOMException('Stopped.','AbortError'));
    options.signal?.addEventListener('abort',stop,{once:true});
    try{
      const begin=performance.now();
      this.slots=this.slots.filter(s=>s.state!=='failed');
      while(this.slots.length<this.size)this.slots.push(this.prime(this.options));
      slot=this.slots.find(s=>s.state==='ready')||await Promise.any(this.slots.map(s=>s.ready));
      options.signal?.throwIfAborted();
      if(epoch!==this.epoch)throw new DOMException('Stopped.','AbortError');
      this.slots=this.slots.filter(s=>s!==slot);this.active=slot;
      this.slots.push(this.prime(this.options));
      const readyWaitMs=Math.round(performance.now()-begin);
      return await slot.worker.run({...options,emit:event=>options.emit(event.type==='timing'?{...event,phases:{...event.phases,readyWaitMs}}:event)});
    }catch(error){throw error.errors?.[0]||error;}
    finally{
      options.signal?.removeEventListener('abort',stop);slot?.worker.close();
      if(this.active===slot)this.active=null;this.busy=false;
    }
  }

  interrupt(){return this.active?.worker.interrupt()??Promise.resolve(false);}
  close(error=new Error('Stopped.')){
    this.epoch++;this.key=null;
    for(const slot of [this.active,...this.slots].filter(Boolean)){slot.controller.abort();slot.worker.close(error);}
    this.slots=[];this.active=null;
  }
}
