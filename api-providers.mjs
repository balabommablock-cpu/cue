import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const origins={openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1'};
const labels={openai:'OpenAI',anthropic:'Claude'};
const failure=(code)=>Object.assign(new Error(code),{code});
const requireProvider=p=>{if(!Object.hasOwn(origins,p))throw failure('invalid_provider');return p;};
export function validateModel(model){
  if(typeof model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(model))throw failure('invalid_model');
  return model;
}
export function publicApiError(error){
  const code=String(error?.code||error?.name||'connection_failed');
  const messages={
    invalid_provider:'Choose OpenAI API or Claude API.',
    invalid_key:'That key was not accepted. Use an API key from the provider’s console.',
    invalid_workspace:'Enter a Claude workspace ID beginning with wrkspc_, or leave it blank.',
    unsupported_credential:'Use a Claude Console API key. A Claude subscription or Claude Code login is not an API key.',
    sign_in_required:'Open Your AI and connect your API key.',
    storage_unavailable:'macOS could not protect your API key. Reopen Cue and try again.',
    invalid_model:'Choose a text model or enter its exact model ID.',
    invalid_messages:'The question or context is too large or unreadable. Shorten it and retry.',
    permission_denied:'This key cannot access that operation or model. Check its permissions and selected workspace.',
    usage_limit:'The provider’s usage or credit limit was reached. Check billing, then retry.',
    model_unavailable:'That model is unavailable to this key. Refresh models or choose another text model.',
    invalid_request:'This model does not support the request. Choose another text model.',
    busy:'A connection is already being checked. Wait or close setup before trying again.',
    cancelled:'Request cancelled.',
    AbortError:'Request cancelled.',
    TimeoutError:'The provider took too long to respond. Retry or choose a faster model.',
    temporarily_unavailable:'The provider is temporarily unavailable. Your connection is still saved.',
    incomplete:'The answer was interrupted or hit the model’s limit. Retry or choose another model.',
    no_text:'The model returned no answer text. Choose a text model.',
  };
  return {code,message:messages[code]||'Could not reach the AI provider. Check your internet connection and retry.'};
}
function httpFailure(status,kind=''){
  if(status===401||kind==='authentication_error')return failure('invalid_key');
  if(status===402||status===429||kind==='rate_limit_error')return failure('usage_limit');
  if(status===403||kind==='permission_error')return failure('permission_denied');
  if(status===404||kind==='not_found_error')return failure('model_unavailable');
  if(status>=500||kind==='overloaded_error')return failure('temporarily_unavailable');
  return failure('invalid_request');
}
function cleanMessages(messages){
  if(!Array.isArray(messages)||!messages.length||messages.length>32)throw failure('invalid_messages');
  let total=0;
  const clean=messages.map(m=>{
    if(!m||!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>50000)throw failure('invalid_messages');
    total+=m.content.length;return {role:m.role,content:m.content};
  });
  if(total>100000||!clean.some(m=>m.role==='user'))throw failure('invalid_messages');
  return clean;
}
async function* events(body,signal){
  if(!body?.getReader)throw failure('incomplete');
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='',data=[];
  function line(value){if(value.startsWith('data:'))data.push(value.slice(5).replace(/^ /,''));}
  try{
    for(;;){
      signal.throwIfAborted();
      const {value,done}=await reader.read();
      buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
      if(buffer.length>1048576)throw failure('incomplete');
      let index;
      while((index=buffer.indexOf('\n'))>=0){
        const value=buffer.slice(0,index).replace(/\r$/,'');buffer=buffer.slice(index+1);
        if(value===''){if(data.length){const text=data.join('\n');data=[];yield text;}}
        else line(value);
      }
      if(done){if(buffer)line(buffer.replace(/\r$/,''));if(data.length)yield data.join('\n');break;}
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function createApiConnections({directory,encryption,fetcher=fetch}){
  const file=join(directory,'providers.enc');let saved={version:1,providers:{}},loaded=false,loadPromise,writeQueue=Promise.resolve(),mutations=Promise.resolve();
  const chatModels=new Set(),pending=new Map(),requests=new Set(),versions={openai:0,anthropic:0};
  const protectedStorage=()=>{if(!encryption.isAvailable())throw failure('storage_unavailable');};
  async function load(){
    if(loaded)return;if(loadPromise)return loadPromise;
    loadPromise=(async()=>{protectedStorage();
    try{
      const value=JSON.parse(encryption.decrypt(await readFile(file)));
      if(value.version!==1||!value.providers||typeof value.providers!=='object')throw failure('storage_unavailable');
      for(const [provider,item] of Object.entries(value.providers)){
        requireProvider(provider);
        if(typeof item.key!=='string'||item.key.length<20||item.key.length>512||/\s/.test(item.key))throw failure('storage_unavailable');
        if(item.workspace!==undefined&&typeof item.workspace!=='string')throw failure('storage_unavailable');
      }
      saved=value;
    }catch(e){if(e.code!=='ENOENT')throw failure('storage_unavailable');}
    loaded=true;})().catch(e=>{loadPromise=null;throw e;});return loadPromise;
  }
  async function persist(next){
    protectedStorage();const encrypted=encryption.encrypt(JSON.stringify(next));
    writeQueue=writeQueue.catch(()=>{}).then(async()=>{
      await mkdir(directory,{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID();
      await writeFile(tmp,encrypted,{mode:0o600});await rename(tmp,file);
    });
    await writeQueue;
  }
  function update(transform){
    const job=mutations.catch(()=>{}).then(async()=>{
      const next=transform(saved);await persist(next);saved=next;
    });
    mutations=job;return job;
  }
  const headers=(provider,credential)=>({
    'Content-Type':'application/json',
    ...(provider==='openai'?{Authorization:'Bearer '+credential.key}:{'x-api-key':credential.key,'anthropic-version':'2023-06-01',...(credential.workspace?{'anthropic-workspace-id':credential.workspace}:{})}),
  });
  const cancel=provider=>{for(const r of requests)if(!provider||r.provider===provider)r.controller.abort();};
  async function fetchModels(provider,credential,signal){
    const values=[],seen=new Set();let cursor='';
    for(let page=0;page<20;page++){
      const query=provider==='anthropic'?'?limit=100'+(cursor?'&after_id='+encodeURIComponent(cursor):''):'';
      const response=await fetcher(origins[provider]+'/models'+query,{headers:headers(provider,credential),signal,redirect:'error'});
      if(!response.ok)throw httpFailure(response.status);
      const result=await response.json();
      if(!Array.isArray(result.data))throw failure('connection_failed');
      for(const m of result.data){
        if(typeof m?.id!=='string'||m.id.length>200||seen.has(m.id))continue;
        // Keep unknown future IDs and fine-tuned models; skip known nontext families.
        if(provider==='openai'&&/^(?:text-embedding|whisper|tts|dall-e|sora|omni-moderation)|(?:realtime|transcribe|image|audio)/i.test(m.id))continue;
        seen.add(m.id);values.push({id:m.id,name:typeof m.display_name==='string'?m.display_name.slice(0,160):m.id});
      }
      if(provider!=='anthropic'||!result.has_more)break;
      if(typeof result.last_id!=='string'||!result.last_id||result.last_id===cursor)throw failure('connection_failed');
      cursor=result.last_id;
      if(page===19)throw failure('connection_failed');
    }
    return provider==='openai'?values.sort((a,b)=>a.id.localeCompare(b.id)):values;
  }
  async function status(){
    await load();return {providers:Object.fromEntries(Object.keys(origins).map(p=>[p,{connected:!!saved.providers[p],workspace:saved.providers[p]?.workspace||''}]))};
  }
  async function connect({provider,key,workspace=''}={}){
    requireProvider(provider);await load();
    key=typeof key==='string'?key.trim():'';
    if(key.length<20||key.length>512||/\s/.test(key))throw failure('invalid_key');
    if(provider==='anthropic'&&/^sk-ant-oat/.test(key))throw failure('unsupported_credential');
    if(typeof workspace!=='string'||workspace&& !/^wrkspc_[A-Za-z0-9_-]{1,180}$/.test(workspace))throw failure('invalid_workspace');
    if(pending.has(provider))throw failure('busy');
    const controller=new AbortController(),revision=++versions[provider];pending.set(provider,controller);
    const credential={key,...(provider==='anthropic'&&workspace?{workspace}:{})};
    try{
      let models=[],warning='';
      try{models=await fetchModels(provider,credential,AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]));}
      catch(e){if(e.code!=='permission_denied')throw e;warning='Key saved. Model listing is restricted; enter the exact text model ID.';}
      controller.signal.throwIfAborted();
      if(revision!==versions[provider])throw failure('cancelled');
      await update(current=>{
        if(revision!==versions[provider])throw failure('cancelled');
        return {...current,providers:{...current.providers,[provider]:credential}};
      });
      if(revision!==versions[provider])throw failure('cancelled');
      cancel(provider);
      return {connected:true,models,warning};
    }finally{if(pending.get(provider)===controller)pending.delete(provider);}
  }
  async function disconnect(provider){
    requireProvider(provider);await load();versions[provider]++;pending.get(provider)?.abort();cancel(provider);
    await update(current=>{const next={...current,providers:{...current.providers}};delete next.providers[provider];return next;});return {connected:false};
  }
  async function models(provider){
    requireProvider(provider);await load();const credential=saved.providers[provider];if(!credential)throw failure('sign_in_required');
    return fetchModels(provider,credential,AbortSignal.timeout(20000));
  }
  async function answer({provider,model,messages},onDelta,signal){
    requireProvider(provider);validateModel(model);messages=cleanMessages(messages);await load();
    const credential=saved.providers[provider];if(!credential)throw failure('sign_in_required');
    const controller=new AbortController(),request={provider,controller};requests.add(request);
    const combined=AbortSignal.any([controller.signal,signal||new AbortController().signal,AbortSignal.timeout(90000)]);
    const payload=provider==='openai'?{model,input:messages,stream:true,store:false,max_output_tokens:4096}:{
      model,system:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n'),
      messages:messages.filter(m=>m.role!=='system'),stream:true,max_tokens:2048,
    };
    let text='',complete=false,stopReason='';
    try{
      combined.throwIfAborted();
      let chat=provider==='openai'&&chatModels.has(model);
      const chatPayload={model,messages,stream:true,store:false,...(/(?:^|:)o\d/.test(model)?{max_completion_tokens:4096}:{max_tokens:2048})};
      const send=async()=>fetcher(origins[provider]+(provider==='openai'?(chat?'/chat/completions':'/responses'):'/messages'),{method:'POST',headers:headers(provider,credential),body:JSON.stringify(chat?chatPayload:payload),signal:combined,redirect:'error'});
      let response=await send();
      // Some accessible text models predate Responses. Retry a rejected request
      // once using Chat Completions, before any generation has started.
      if(provider==='openai'&&!chat&&[400,404].includes(response.status)){
        await response.body?.cancel();combined.throwIfAborted();chat=true;response=await send();
        if(response.ok)chatModels.add(model);
      }
      if(!response.ok)throw httpFailure(response.status);
      for await(const raw of events(response.body,combined)){
        combined.throwIfAborted();if(raw==='[DONE]')continue;
        let event;try{event=JSON.parse(raw);}catch{throw failure('incomplete');}
        if(event.type==='error'||event.type==='response.failed')throw httpFailure(0,event.error?.type||event.response?.error?.code);
        let delta='';
        if(chat){
          const choice=event.choices?.[0];delta=choice?.delta?.content;
          if(choice?.finish_reason){if(choice.finish_reason!=='stop')throw failure('incomplete');complete=true;}
        }else if(provider==='openai'){
          if(event.type==='response.output_text.delta')delta=event.delta;
          if(event.type==='response.incomplete')throw failure('incomplete');
          if(event.type==='response.completed'){
            if(!text)delta=(event.response?.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
            complete=true;
          }
        }else{
          if(event.type==='content_block_start'&&event.content_block?.type==='text')delta=event.content_block.text;
          if(event.type==='content_block_delta'&&event.delta?.type==='text_delta')delta=event.delta.text;
          if(event.type==='message_delta')stopReason=event.delta?.stop_reason||stopReason;
          if(event.type==='message_stop'){if(stopReason&& !['end_turn','stop_sequence'].includes(stopReason))throw failure('incomplete');complete=true;}
        }
        if(typeof delta==='string'&&delta){text+=delta;if(text.length>60000)throw failure('incomplete');onDelta(text);}
        if(complete)break;
      }
      if(!complete)throw failure('incomplete');
      if(!text.trim())throw failure('no_text');
      return text;
    }finally{requests.delete(request);}
  }
  return {status,connect,disconnect,models,answer,cancelConnect(provider){requireProvider(provider);versions[provider]++;pending.get(provider)?.abort();},close(){for(const c of pending.values())c.abort();cancel();}};
}
