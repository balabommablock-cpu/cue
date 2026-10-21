// Independent implementation of OpenAI's public Sign in with ChatGPT protocol.
// Spec: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
import {createServer} from 'node:http';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createRemoteJWKSet,jwtVerify} from 'jose';
const ISSUER='https://auth.openai.com',RESOURCE='https://api.openai.com/v1';
const SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const error=(code,message)=>Object.assign(new Error(message),{code});
export function publicError(e){
  const code=String(e?.code||'connection_failed');
  const messages={cancelled:'Sign-in cancelled. You can try again.',access_denied:'ChatGPT access was not granted. Try again or use local AI.',sign_in_required:'Connect your ChatGPT account to continue.',sharing_not_enabled:'Enable ChatGPT plan usage when you connect your account.',invalid_grant:'Your ChatGPT connection expired. Sign in again.',usage_limit:'ChatGPT usage limit reached. Open Manage usage to check your allowance.',not_eligible:'ChatGPT plan usage is unavailable for this account or workspace. Choose local AI or another eligible account.',temporarily_unavailable:'ChatGPT is temporarily unavailable. Keep this account connected and retry shortly.',permission_denied:'ChatGPT did not permit this request. Check your account access in Manage usage.',model_unavailable:'That model is unavailable for this account. Choose another in Your AI.',storage_unavailable:'macOS could not protect your account credentials. Reopen Cue and try again.',incomplete:'The answer was interrupted. Please retry.',identity_mismatch:'The account did not match this connection. Add it as a separate account.',busy:'Finish or cancel the current connection first.'};
  return {code,message:messages[code]||'Could not connect to ChatGPT. Check your internet connection and try again.'};
}
function responseError(code,status){
  if(code==='subscription_sharing_usage_limit_exceeded'||status===429)return error('usage_limit');
  if(code==='subscription_sharing_user_not_eligible')return error('not_eligible');
  if(/(?:usage|user)_unavailable$/.test(code||'')||status===503)return error('temporarily_unavailable');
  if(status===401)return error('sign_in_required');
  if(status===403)return error('permission_denied');
  if(status===404||code==='model_not_found')return error('model_unavailable');
  return error(status?'connection_failed':'incomplete');
}
export async function createChatGPTConnection({directory,encryption,openBrowser,fetcher=fetch,verifyIdentity,onState=()=>{}}){
  let saved,metadata,keys,pending,refreshing,writeQueue=Promise.resolve();
  const requests=new Set();
  const file=join(directory,'account.enc');
  const requireEncryption=()=>{if(!encryption.isAvailable())throw error('storage_unavailable');};
  async function persist(){requireEncryption();const encrypted=encryption.encrypt(JSON.stringify(saved));writeQueue=writeQueue.catch(()=>{}).then(async()=>{await mkdir(directory,{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID();await writeFile(tmp,encrypted,{mode:0o600});await rename(tmp,file);});await writeQueue;}
  async function load(){requireEncryption();try{saved=JSON.parse(encryption.decrypt(await readFile(file)));if(saved.version!==1||!Array.isArray(saved.accounts)||typeof saved.host!=='string')throw error('storage_unavailable');}catch(e){if(e.code!=='ENOENT')throw error('storage_unavailable');saved={version:1,host:'urn:uuid:'+randomUUID(),accounts:[]};await persist();}}
  await load();
  const account=()=>saved.accounts.find(a=>a.id===saved.active);
  const safe=a=>({id:a.id,label:a.label,email:a.email||'',name:a.name||'',status:a.access?'connected':'disconnected',sharing:!!a.access&&a.scopes?.includes('chatgpt.tokens.use.direct')});
  const status=()=>({...(account()?safe(account()):{status:'disconnected',sharing:false}),connecting:!!pending,accounts:saved.accounts.map(safe)});
  const publish=()=>{const s=status();onState(s);return s;};
  const cancelAnswers=()=>{for(const c of requests)c.abort();};
  async function discovery(){
    if(metadata)return metadata;
    const r=await fetcher(ISSUER+'/.well-known/openid-configuration',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw error('connection_failed');const d=await r.json();
    if(d.issuer!==ISSUER||['jwks_uri','revocation_endpoint'].some(k=>!d[k]||new URL(d[k]).origin!==ISSUER))throw error('connection_failed');
    metadata=d;return d;
  }
  async function verify(token,client,nonce,at){
    let p;
    if(verifyIdentity)p=await verifyIdentity(token,client,nonce,at);
    else{const d=await discovery();keys??=createRemoteJWKSet(new URL(d.jwks_uri));p=(await jwtVerify(token,keys,{issuer:ISSUER,audience:client,requiredClaims:['exp','sub'],...(at?{currentDate:new Date(at)}:{})})).payload;}
    if(typeof p.sub!=='string'||!p.sub||nonce!==undefined&&p.nonce!==nonce)throw error('identity_mismatch');return p;
  }
  async function token(form,signal){
    const r=await fetcher(ISSUER+'/api/accounts/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...form,resource:RESOURCE}),signal:signal||AbortSignal.timeout(20000)});
    const d=await r.json();if(!r.ok)throw error(d.error==='invalid_grant'?'invalid_grant':'connection_failed');
    if(typeof d.access_token!=='string'||!d.access_token||d.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(d.expires_in)||d.expires_in<=0)throw error('connection_failed');return d;
  }
  function applyTokens(a,d,identity){a.access=d.access_token;a.refresh=d.refresh_token||a.refresh;a.expires=Date.now()+d.expires_in*1000;a.earliest=d.earliest_refresh_at;a.scopes=d.scope===undefined?(a.scopes||[]):String(d.scope).split(/\s+/);if(d.id_token)a.idToken=d.id_token;if(identity){a.subject=identity.sub;a.email=identity.email||'';a.name=identity.name||'';}delete a.pendingRefresh;}
  async function refresh(a){
    if(refreshing){await refreshing;return;}
    refreshing=(async()=>{
      if(!a.pendingRefresh){
        if(!a.refresh)throw error('sign_in_required');
        const earliest=typeof a.earliest==='number'?a.earliest*1000:Date.parse(a.earliest||'');if(earliest>Date.now())throw error('connection_failed');
        const d=await token({grant_type:'refresh_token',client_id:a.client,refresh_token:a.refresh});
        // Preserve rotating credentials before verification, including through an offline JWKS retry.
        a.pendingRefresh={data:d,at:Date.now()};await persist();
      }
      const {data:d,at}=a.pendingRefresh;
      if(typeof d.id_token!=='string')throw error('sign_in_required');
      const identity=await verify(d.id_token,a.client,undefined,at);if(identity.sub!==a.subject)throw error('identity_mismatch');
      applyTokens(a,d,identity);await persist();publish();
    })().catch(async e=>{if(['invalid_grant','identity_mismatch','sign_in_required'].includes(e.code)){delete a.access;delete a.refresh;delete a.idToken;delete a.pendingRefresh;await persist();publish();}throw e;}).finally(()=>{refreshing=null;});
    await refreshing;
  }
  async function credentials(){const a=account();if(!a?.access)throw error('sign_in_required');if(a.pendingRefresh||a.expires<Date.now()+60000)await refresh(a);if(!a.scopes?.includes('chatgpt.tokens.use.direct'))throw error('sharing_not_enabled');return a;}
  async function signIn({newAccount=false,reconsent=false}={}){
    if(pending||refreshing)throw error('busy');cancelAnswers();
    const prior=newAccount?null:(account()||saved.accounts.find(a=>!a.subject)),state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
    const controller=new AbortController();let finish,callbackServer,timer,consumed=false;
    const callback=new Promise((resolve,reject)=>{finish=(e,v)=>e?reject(e):resolve(v);});callback.catch(()=>{});
    const abort=()=>finish(error('cancelled'));controller.signal.addEventListener('abort',abort,{once:true});
    pending={controller};publish();
    try{
      callbackServer=createServer((req,res)=>{
        res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Referrer-Policy','no-referrer');
        const url=new URL(req.url,'http://127.0.0.1');const value=url.searchParams.get('state')||'';
        if(req.method!=='GET'||url.pathname!=='/auth/callback'||consumed||Buffer.byteLength(value)!==Buffer.byteLength(state)||!timingSafeEqual(Buffer.from(value),Buffer.from(state))){res.writeHead(400);res.end('This sign-in link is invalid. Return to Cue.');return;}
        consumed=true;
        if(url.searchParams.has('error')){res.end('Sign-in was not completed. Return to Cue.');finish(error(url.searchParams.get('error')==='access_denied'?'access_denied':'connection_failed'));return;}
        const client=url.searchParams.get('client_id')||prior?.client,code=url.searchParams.get('code');
        if(!code||!client||client==='dynamic_agent_client'||client.length>300||prior&&client!==prior.client){res.writeHead(400);res.end('Could not verify this connection. Return to Cue.');finish(error('identity_mismatch'));return;}
        res.end('You can return to Cue. Cue is verifying your connection.');finish(null,{client,code});
      });
      await new Promise((resolve,reject)=>{callbackServer.once('error',reject);callbackServer.listen(0,'127.0.0.1',resolve);});
      const redirect='http://127.0.0.1:'+callbackServer.address().port+'/auth/callback';
      const url=new URL(ISSUER+'/api/accounts/authorize');url.search=new URLSearchParams({client_id:prior?.client||'dynamic_agent_client',...(!prior?{agent_name_hint:'Cue'}:{}),ext_agent_host_id:saved.host,response_type:'code',redirect_uri:redirect,scope:SCOPES,...(reconsent?{prompt:'consent'}:{}),resource:RESOURCE,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),...(prior?.idToken?{id_token_hint:prior.idToken}:{}),...(prior?.email?{login_hint:prior.email}:{})}).toString();
      timer=setTimeout(()=>controller.abort(),300000);await openBrowser(url.href);
      const result=await callback;controller.signal.throwIfAborted();
      const a=prior||{id:randomUUID(),client:result.client,label:'Account '+(saved.accounts.length+1),scopes:[]};
      if(!prior){saved.accounts.push(a);await persist();}
      const d=await token({grant_type:'authorization_code',client_id:result.client,code:result.code,code_verifier:verifier,redirect_uri:redirect},controller.signal);
      const identity=await verify(d.id_token,result.client,nonce);controller.signal.throwIfAborted();
      if(a.subject&&a.subject!==identity.sub)throw error('identity_mismatch');
      applyTokens(a,d,identity);saved.active=a.id;await persist();return status();
    }finally{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);callbackServer?.closeAllConnections();callbackServer?.close();pending=null;publish();}
  }
  async function models(){const a=await credentials();const r=await fetcher(RESOURCE+'/models',{headers:{Authorization:'Bearer '+a.access},signal:AbortSignal.timeout(15000)});if(!r.ok)throw error(r.status===401?'sign_in_required':'connection_failed');const d=await r.json();return (d.models||[]).filter(m=>m.visibility==='list'&&typeof m.slug==='string').map(m=>({id:m.slug,name:m.display_name||m.slug}));}
  async function answer({model,messages},onDelta,externalSignal){
    if(typeof model!=='string'||model.length>150||!Array.isArray(messages)||messages.length>8||messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>20000)||JSON.stringify(messages).length>50000)throw error('invalid_input');
    const controller=new AbortController();requests.add(controller);const signal=AbortSignal.any([controller.signal,externalSignal||new AbortController().signal,AbortSignal.timeout(60000)]);
    try{const a=await credentials();signal.throwIfAborted();const r=await fetcher(RESOURCE+'/responses',{method:'POST',headers:{Authorization:'Bearer '+a.access,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,stream:true,instructions:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),input:messages.filter(m=>m.role!=='system').map(m=>({...m,content:m.content.replace(/\n\/(?:no_)?think$/,'')}))}),signal});
      if(!r.ok){let d;try{d=await r.json();}catch{}throw responseError(d?.error?.code,r.status);}
      let buffer='',result='',completed=false;const decoder=new TextDecoder();
      const processEvent=line=>{if(!line.startsWith('data:'))return;let e;try{e=JSON.parse(line.slice(5).trim());}catch{return;}
        if(e.type==='response.output_text.delta'){result+=e.delta||'';if(result.length>50000)throw error('incomplete');onDelta(result);}
        if(e.type==='response.completed')completed=true;
        if(e.type==='response.failed'||e.type==='error')throw responseError(e.response?.error?.code||e.error?.code||e.code,0);
        if(e.type==='response.incomplete')throw error('incomplete');};
      for await(const chunk of r.body){signal.throwIfAborted();buffer+=decoder.decode(chunk,{stream:true});if(buffer.length>2000000)throw error('incomplete');let i;while((i=buffer.indexOf('\n'))>=0){processEvent(buffer.slice(0,i));buffer=buffer.slice(i+1);}}
      buffer+=decoder.decode();if(buffer.trim())processEvent(buffer);if(!completed||!result.trim())throw error('incomplete');return result;
    }finally{requests.delete(controller);}
  }
  async function select(id){if(pending)throw error('busy');await refreshing;cancelAnswers();if(!saved.accounts.some(a=>a.id===id))throw error('sign_in_required');saved.active=id;await persist();return publish();}
  async function disconnect(){if(pending)throw error('busy');await refreshing;cancelAnswers();const a=account();if(!a)return status();let revoked=true;
    try{const refreshToken=a.pendingRefresh?.data?.refresh_token||a.refresh;if(refreshToken){const d=await discovery();let ok=false;for(let attempt=0;attempt<2;attempt++){const r=await fetcher(d.revocation_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:a.client,token:refreshToken,token_type_hint:'refresh_token'}),signal:AbortSignal.timeout(6000)});if(r.status===200){ok=true;break;}if(r.status<500)break;await new Promise(r=>setTimeout(r,400));}revoked=ok;}}
    catch{revoked=false;}finally{for(const k of ['access','refresh','idToken','pendingRefresh','expires','earliest'])delete a[k];a.scopes=[];await persist();publish();}return {...status(),revoked};
  }
  return {status,signIn,cancelSignIn:()=>pending?.controller.abort(),models,answer,select,disconnect,cancelAnswers,close(){pending?.controller.abort();cancelAnswers();}};
}
