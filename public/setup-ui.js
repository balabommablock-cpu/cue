import {apiSetupUI} from './api-setup-ui.js';
import {unwrap} from './account-ui.js';
export function setupUI({$,native,read,write,getSettings,saveContext,chooseProvider,prepareLocal,prepareSpeech,localStatus,stopListening,tryQuestion,trySample,chooseSource}){
  let state={status:'disconnected',sharing:false,accounts:[]},selected='',models=[],busy=false,aborter,step='context',info,apiPanel,operation=0,localFailure=false,progressText='';
  const say=s=>{$('setupMessage').textContent=s;};
  const blocked=()=>busy||!!apiPanel?.busy();
  function testReady(){
    const s=getSettings(),local=localStatus();
    if(s.provider==='device')return !!local?.answer&&local.model===s.deviceModel;
    if(s.provider==='chatgpt')return state.sharing&&!!read('chatGPTModel','');
    if(s.provider==='openai'||s.provider==='anthropic')return apiPanel?.ready(s.provider)&&!!read('apiModel:'+s.provider,'');
    return s.provider==='codex';
  }
  function home(){
    const s=getSettings(),local=localStatus();$('contextShortcut').textContent=s.profile.trim()?'Your context ✓':'Add your context';
    $('aiShortcut').textContent=s.provider==='chatgpt'?'ChatGPT'+(state.sharing?' ✓':' · connect'):s.provider==='device'?'On this Mac'+(local?.loading?' · preparing…':local?.answer?' ✓':' · set up'):s.provider==='openai'?'OpenAI API'+(apiPanel?.ready('openai')?' ✓':' · connect'):s.provider==='anthropic'?'Claude API'+(apiPanel?.ready('anthropic')?' ✓':' · connect'):s.provider==='codex'?'Codex · change':'AI · change';
    $('aiShortcut').title=local?.loading?progressText:'Change your AI connection';
    $('usingPlan').hidden=s.provider!=='chatgpt';
  }
  function render(){
    const local=selected==='device',locked=blocked();
    $('aiChoiceLabel').textContent=({chatgpt:'ChatGPT',device:'On this Mac',openai:'OpenAI API',anthropic:'Claude API'})[selected]+' · Change AI';
    $('planWelcome').hidden=getSettings().provider!=='chatgpt'||read('chatGPTPlanWelcomed',false);
    for(const [id,provider] of [['chooseChatGPT','chatgpt'],['chooseLocal','device'],['chooseOpenAI','openai'],['chooseClaude','anthropic']]){$(id).setAttribute('aria-pressed',String(selected===provider));$(id).disabled=locked;}
    $('setupChatGPT').hidden=selected!=='chatgpt';$('setupLocal').hidden=!local;apiPanel?.render();
    for(const name of ['context','ai','test']){$('setupStep'+name).setAttribute('aria-current',step===name?'step':'false');$('setupStep'+name).disabled=locked;}
    $('setupContextPanel').hidden=step!=='context';$('setupAIPanel').hidden=step!=='ai';$('setupTestPanel').hidden=step!=='test';
    $('setupTitle').textContent=step==='context'?'A little context. Better answers.':step==='ai'?'Choose who does the thinking.':'Try it before your conversation.';
    const current=state.accounts.find(a=>a.id===state.id);
    $('accountIdentity').textContent=state.sharing?(current?.email||current?.name||'Your account')+' · ChatGPT plan usage enabled':state.status==='connected'?'Signed in · plan usage not enabled':'An eligible ChatGPT Plus or Pro plan is required. No API key.';
    $('connectChatGPT').textContent=state.connecting?'Waiting for browser sign-in…':state.sharing?'Reconnect account':state.status==='connected'?'Enable ChatGPT plan usage':'Continue with ChatGPT';
    $('connectChatGPT').disabled=locked;$('connectChatGPT').setAttribute('data-connected',String(state.sharing));$('cancelChatGPT').hidden=!state.connecting;$('accountActions').hidden=!state.accounts.length;
    const picker=$('chatGPTAccount');picker.replaceChildren();for(const a of state.accounts)picker.add(new Option((a.email||a.name||a.label)+' · '+a.label,a.id));picker.value=state.id||'';picker.disabled=locked;
    for(const id of ['addChatGPTAccount','disconnectChatGPT'])$(id).disabled=locked;
    $('chatGPTModelWrap').hidden=!state.sharing;$('chatGPTModel').disabled=locked;$('useChatGPT').disabled=locked||!state.sharing||!models.length;
    $('useLocal').disabled=locked||!!info&&info.arch!=='arm64';$('cancelLocalSetup').hidden=!busy||!aborter;$('cancelSpeechSetup').hidden=!busy||!aborter;$('simpleLocalModel').disabled=locked;
    $('useLocal').textContent=busy?'Preparing on this Mac…':localStatus()?.answer&&localStatus()?.model===$('simpleLocalModel').value?'Use local AI':'Download & use local AI';
    $('localCompatibility').textContent=info?(info.arch==='arm64'?`Apple silicon · ${info.memoryGB} GB memory. ${info.memoryGB>=16?'Your Mac is suitable for local AI.':'Start with Smallest and close memory-heavy apps.'}`:'Local AI needs an Apple silicon Mac in this release. Choose a cloud AI instead.'):native?.deviceInfo?'Checking this Mac…':'Mac preview · 16 GB memory recommended. Setup checks graphics support before downloading.';
    $('localRecommendation').textContent=info?.arch==='arm64'?'Recommended for this Mac: '+({strong:'Stronger',balanced:'Balanced',light:'Smallest'})[info.recommendedModel]+'. You can change this below.':'Not sure? Start with Balanced on a 16 GB Mac, or Smallest on an 8 GB Mac.';
    $('localRecovery').hidden=!localFailure;$('retrySmallLocal').disabled=locked||$('simpleLocalModel').value==='light';
    $('trySetupQuestion').disabled=locked||!testReady();$('trySetupVoice').disabled=locked||!testReady();
    $('setupChooseAI').hidden=testReady();$('setupTestStatus').textContent=testReady()?'Your AI is connected. Try text first, or test transcription with the included recording.':'Choose and prepare your AI before trying a question.';
    home();
  }
  function page(value){step=value;write('setupStep',value);say('');render();$('setupDialog').scrollTop=0;}
  async function refreshAccount(){
    if(!native?.accountStatus)return;
    state=unwrap(await native.accountStatus());render();
    if(state.sharing&&selected==='chatgpt'){
      models=unwrap(await native.accountModels());const picker=$('chatGPTModel');picker.replaceChildren();for(const m of models)picker.add(new Option(m.name,m.id));
      const wanted=read('chatGPTModel','');picker.value=models.some(m=>m.id===wanted)?wanted:(models.find(m=>/gpt-6\.1-sol$/.test(m.id))?.id||models[0]?.id||'');render();
    }
  }
  async function open(which='context'){
    if(!['context','ai','test'].includes(which))which='context';
    stopListening();$('simpleLocalModel').value=getSettings().deviceModel;$('profile').value=getSettings().profile;selected=['device','openai','anthropic'].includes(getSettings().provider)?getSettings().provider:'chatgpt';apiPanel.select(selected);
    $('aiChoices').open=false;$('setupAudioSource').value=getSettings().source;page(which);$('setupDialog').showModal();
    if(native?.deviceInfo)try{info=unwrap(await native.deviceInfo());if(!read('devicePrepared',false)&&!read('deviceChoiceMade',false))$('simpleLocalModel').value=info.recommendedModel;render();}catch{say('Could not read this Mac’s memory. Start with the smallest model.');}
    try{await refreshAccount();await apiPanel.refresh();if(step==='ai'&&['openai','anthropic'].includes(selected))void apiPanel.loadModels(selected);}catch(e){say(e.message);}
  }
  function cleanup(){
    operation++;if(aborter){aborter.abort();$('simpleDeviceDownload').hidden=true;$('simpleDeviceProgress').textContent='Setup stopped. Completed files stay cached for retry.';}aborter=null;busy=false;if(state.connecting)void native?.accountCancel?.();state.connecting=false;
    apiPanel.close();$('profile').value=getSettings().profile;render();
  }
  async function task(work,success,{download=false}={}){
    if(blocked())return;const token=++operation;busy=true;aborter=download?new AbortController():null;const signal=aborter?.signal;render();
    try{const result=await work(signal);if(token===operation&&!signal?.aborted)success?.(result);}
    catch(e){if(token===operation){localFailure=download&&selected==='device'&&!signal?.aborted;if(download){$('simpleDeviceDownload').hidden=true;$('simpleDeviceProgress').textContent=signal?.aborted?'Setup stopped. Completed files stay cached for retry.':'Setup could not finish. Try again or choose another AI.';}say(signal?.aborted?'Download cancelled. Completed files stay cached for retry.':e.message);}}
    finally{if(token===operation){busy=false;aborter=null;state.connecting=false;render();}else home();}
  }
  $('contextShortcut').onclick=()=>void open('context');$('aiShortcut').onclick=()=>void open('ai');
  $('closeSetup').onclick=()=>{cleanup();$('setupDialog').close();};$('setupDialog').addEventListener('cancel',cleanup);
  for(const name of ['context','ai','test'])$('setupStep'+name).onclick=()=>{if(!blocked())page(name);};
  $('savePersonalContext').onclick=()=>{const text=$('profile').value.trim();if(text.length>40000){say('Keep your context below 40,000 characters.');return;}saveContext(text);$('contextImportStatus').textContent='Saved on this Mac. You can update it whenever you like.';page('ai');};
  $('skipContext').onclick=()=>{$('profile').value=getSettings().profile;page('ai');};
  function pick(provider){if(blocked())return;selected=provider;$('aiChoices').open=false;apiPanel.select(provider);say('');render();if(['openai','anthropic'].includes(provider))void apiPanel.loadModels(provider);else if(provider==='chatgpt')void refreshAccount().catch(e=>say(e.message));}
  $('chooseChatGPT').onclick=()=>pick('chatgpt');$('chooseLocal').onclick=()=>pick('device');$('chooseOpenAI').onclick=()=>pick('openai');$('chooseClaude').onclick=()=>pick('anthropic');
  $('connectChatGPT').onclick=()=>{
    if(!native?.accountSignIn){say('ChatGPT sign-in is available in the installed Mac app.');return;}
    return task(async()=>{state.connecting=true;render();say('Finish sign-in in your browser, then return here.');unwrap(await native.accountSignIn({reconsent:state.status==='connected'&&!state.sharing}));await refreshAccount();},()=>say(state.sharing?'Connected. Use ChatGPT to finish setup.':'Sign-in finished, but ChatGPT plan usage is not enabled.'));
  };
  $('cancelChatGPT').onclick=()=>void native?.accountCancel();
  $('addChatGPTAccount').onclick=()=>task(async()=>{state.connecting=true;unwrap(await native.accountSignIn({newAccount:true}));await refreshAccount();});
  $('chatGPTAccount').onchange=()=>{const id=$('chatGPTAccount').value;return task(async()=>{unwrap(await native.accountSelect(id));await refreshAccount();});};
  $('disconnectChatGPT').onclick=()=>task(async()=>{const result=unwrap(await native.accountDisconnect());models=[];await refreshAccount();return result;},result=>say(result.revoked?'Signed out. Your context is still saved on this Mac.':'Signed out on this Mac. Remote sign-out was not confirmed; remove Cue in ChatGPT settings.'));
  $('manageUsage').onclick=$('homeManageUsage').onclick=()=>void native?.accountUsage();
  $('useChatGPT').onclick=()=>{const model=$('chatGPTModel').value;return task(async signal=>{say('Preparing English listening. First use downloads about 150 MB.');await prepareSpeech(signal);},()=>{write('chatGPTModel',model);chooseProvider('chatgpt');page('test');if(!read('chatGPTPlanWelcomed',false))$('planWelcome').hidden=false;},{download:true});};
  $('planGotIt').onclick=()=>{$('planWelcome').hidden=true;write('chatGPTPlanWelcomed',true);};
  $('simpleLocalModel').value=getSettings().deviceModel;
  $('simpleLocalModel').onchange=()=>{if(!blocked()){localFailure=false;$('simpleDeviceDownload').hidden=true;$('simpleDeviceProgress').textContent='Completed downloads are reused when available.';render();}};
  function useLocal(){const model=$('simpleLocalModel').value;localFailure=false;return task(async signal=>{write('deviceChoiceMade',true);say('Keep Cue open while setup downloads and checks your AI.');await prepareLocal(model,signal);},()=>{chooseProvider('device');page('test');},{download:true});}
  $('useLocal').onclick=useLocal;
  $('retrySmallLocal').onclick=()=>{if(!blocked()){$('simpleLocalModel').value='light';return useLocal();}};
  $('chooseOtherAI').onclick=()=>{$('aiChoices').open=true;$('aiChoiceLabel').focus();};
  $('cancelLocalSetup').onclick=$('cancelSpeechSetup').onclick=()=>{aborter?.abort();say('Stopping setup. Completed files stay cached.');};
  $('setupChooseAI').onclick=()=>page('ai');
  $('setupAudioSource').onchange=()=>chooseSource?.($('setupAudioSource').value);
  function finish(){cleanup();$('setupDialog').close();write('setupComplete',true);}
  $('trySetupQuestion').onclick=()=>{if(!testReady()||blocked())return;finish();void tryQuestion('How would you decide which feature to build first?');};
  $('trySetupVoice').onclick=()=>{if(!testReady()||blocked())return;finish();void trySample?.();};
  $('finishSetup').onclick=()=>{if(!blocked())finish();};
  apiPanel=apiSetupUI({$,native,read,write,getProvider:()=>selected,chooseProvider,page,say,render});
  native?.onAccountState?.(value=>{state=value;render();});
  return {open,home,refreshAccount,refreshApi:()=>apiPanel.refresh(),apiReady:p=>apiPanel.ready(p),readyApiModel:p=>apiPanel.readyModel(p),
    progress(p){
      const fraction=Number.isFinite(p.progress)?Math.max(0,Math.min(1,p.kind==='speech'?p.progress/100:p.progress)):null;
      progressText=p.kind==='ready'||p.kind==='speech-ready'?p.text:p.stage==='verify'?'Checking a real answer on this Mac…':p.kind==='speech'?'Preparing English listening…':'Preparing local AI'+(fraction!==null?' · '+Math.round(fraction*100)+'%':'…');
      $('simpleDeviceProgress').textContent=progressText;$('simpleSpeechProgress').textContent=p.kind==='ready'?(localStatus()?.speech?'English listening is ready on this Mac.':''):progressText;
      $('simpleDeviceDownload').hidden=false;
      if(p.kind==='ready'||p.kind==='speech-ready')$('simpleDeviceDownload').value=1;else if(fraction!==null&&p.kind!=='speech')$('simpleDeviceDownload').value=fraction;else $('simpleDeviceDownload').removeAttribute?.('value');
      home();
    },accountReady:()=>state.sharing,async readyModel(){await refreshAccount();if(!state.sharing)throw new Error('Open Your AI and connect your ChatGPT account.');return read('chatGPTModel','')||models[0]?.id;}};
}
