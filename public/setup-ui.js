import {unwrap} from './account-ui.js';
export function setupUI({$,native,read,write,getSettings,saveContext,chooseProvider,prepareLocal,prepareSpeech,localStatus,stopListening,tryQuestion}){
  let state={status:'disconnected',sharing:false,accounts:[]},selected='',models=[],busy=false,aborter,step='context',draftStart='',info;
  const say=s=>{$('setupMessage').textContent=s;};
  function home(){
    const s=getSettings();$('contextShortcut').textContent=s.profile.trim()?'Your context ✓':'Add your context';
    $('aiShortcut').textContent=s.provider==='chatgpt'?'ChatGPT'+(state.sharing?' ✓':' · connect'):s.provider==='device'?'On this Mac'+(localStatus()?.answer?' ✓':' · set up'):s.provider==='codex'?'Codex · change':'AI · change';
    $('usingPlan').hidden=s.provider!=='chatgpt';
  }
  function render(){
    const local=selected==='device';$('planWelcome').hidden=getSettings().provider!=='chatgpt'||read('chatGPTPlanWelcomed',false);
    $('chooseChatGPT').setAttribute('aria-pressed',String(!local));$('chooseLocal').setAttribute('aria-pressed',String(local));
    $('setupChatGPT').hidden=local;$('setupLocal').hidden=!local;
    $('setupContextPanel').hidden=step!=='context';$('setupAIPanel').hidden=step!=='ai';$('setupTestPanel').hidden=step!=='test';
    for(const name of ['context','ai','test'])$('setupStep'+name).setAttribute('aria-current',step===name?'step':'false');
    $('setupTitle').textContent=step==='context'?'A little context. Better answers.':step==='ai'?'Choose who does the thinking.':'Try it before your conversation.';
    const current=state.accounts.find(a=>a.id===state.id);
    $('accountIdentity').textContent=state.sharing?(current?.email||current?.name||'Your account')+' · ChatGPT plan usage enabled':state.status==='connected'?'Signed in · plan usage not enabled':'An eligible ChatGPT Plus or Pro plan is required. No API key.';
    $('connectChatGPT').textContent=state.connecting?'Waiting for browser sign-in…':state.sharing?'Reconnect account':state.status==='connected'?'Enable ChatGPT plan usage':'Continue with ChatGPT';
    $('connectChatGPT').disabled=busy;$('connectChatGPT').setAttribute('data-connected',String(state.sharing));$('cancelChatGPT').hidden=!state.connecting;$('accountActions').hidden=!state.accounts.length;
    const picker=$('chatGPTAccount');picker.replaceChildren();for(const a of state.accounts)picker.add(new Option((a.email||a.name||a.label)+' · '+a.label,a.id));picker.value=state.id||'';
    $('chatGPTModelWrap').hidden=!state.sharing;$('useChatGPT').disabled=busy||!state.sharing||!models.length;
    $('useLocal').disabled=busy;$('cancelLocalSetup').hidden=!busy||!aborter;$('cancelSpeechSetup').hidden=!busy||!aborter;$('useLocal').textContent=busy?'Preparing on this Mac…':localStatus()?.answer?'Use local AI':'Download & use local AI';
    $('localCompatibility').textContent=info?(info.arch==='arm64'?`Apple silicon · ${info.memoryGB} GB memory. ${info.memoryGB>=16?'Your Mac is suitable for local AI.':'The lighter model is safer with this amount of memory.'}`:'Local AI needs an Apple silicon Mac in this release.'):'Checking this Mac…';
    home();
  }
  function page(value){step=value;say('');render();$('setupDialog').scrollTop=0;}
  async function refreshAccount(){if(!native?.accountStatus)return;state=unwrap(await native.accountStatus());render();if(state.sharing){models=unwrap(await native.accountModels());const picker=$('chatGPTModel');picker.replaceChildren();for(const m of models)picker.add(new Option(m.name,m.id));const wanted=read('chatGPTModel','');picker.value=models.some(m=>m.id===wanted)?wanted:(models.find(m=>/gpt-6\.1-sol$/.test(m.id))?.id||models[0]?.id||'');render();}}
  async function open(which='context'){
    stopListening();draftStart=getSettings().profile;$('profile').value=draftStart;selected=getSettings().provider==='device'?'device':'chatgpt';page(which);$('setupDialog').showModal();
    if(native?.deviceInfo)try{info=unwrap(await native.deviceInfo());if(!read('devicePrepared',false)&&!read('deviceChoiceMade',false))$('simpleLocalModel').value=info.recommendedModel;render();}catch{say('Could not read this Mac’s details.');}
    try{await refreshAccount();}catch(e){say(e.message);}
  }
  $('contextShortcut').onclick=()=>void open('context');$('aiShortcut').onclick=()=>void open('ai');
  $('closeSetup').onclick=()=>{$('profile').value=getSettings().profile;$('setupDialog').close();};
  $('setupDialog').addEventListener('cancel',()=>{$('profile').value=getSettings().profile;});
  for(const name of ['context','ai','test'])$('setupStep'+name).onclick=()=>page(name);
  $('savePersonalContext').onclick=()=>{const text=$('profile').value.trim();if(text.length>40000){say('Keep your context below 40,000 characters.');return;}saveContext(text);draftStart=text;$('contextImportStatus').textContent='Saved on this Mac. You can update it whenever you like.';say('Context saved.');page('ai');};
  $('skipContext').onclick=()=>{$('profile').value=getSettings().profile;page('ai');};
  $('chooseChatGPT').onclick=()=>{if(busy)return;selected='chatgpt';say('');render();};$('chooseLocal').onclick=()=>{if(busy)return;selected='device';say('');render();};
  $('connectChatGPT').onclick=async()=>{if(!native?.accountSignIn){say('ChatGPT sign-in is available in the installed Mac app.');return;}busy=true;state.connecting=true;render();say('Finish sign-in in your browser, then return here.');try{unwrap(await native.accountSignIn({reconsent:state.status==='connected'&&!state.sharing}));await refreshAccount();say(state.sharing?'Connected. Use ChatGPT to finish setup.':'Sign-in finished, but ChatGPT plan usage is not enabled.');}catch(e){say(e.message);}finally{busy=false;state.connecting=false;render();}};
  $('cancelChatGPT').onclick=()=>void native?.accountCancel();
  $('addChatGPTAccount').onclick=async()=>{busy=true;render();try{unwrap(await native.accountSignIn({newAccount:true}));await refreshAccount();}catch(e){say(e.message);}finally{busy=false;render();}};
  $('chatGPTAccount').onchange=async()=>{const id=$('chatGPTAccount').value;busy=true;render();try{unwrap(await native.accountSelect(id));await refreshAccount();}catch(e){say(e.message);}finally{busy=false;render();}};
  $('disconnectChatGPT').onclick=async()=>{busy=true;render();try{const result=unwrap(await native.accountDisconnect());models=[];await refreshAccount();say(result.revoked?'Signed out. Your context is still saved on this Mac.':'Signed out on this Mac. Remote sign-out was not confirmed; remove Cue in ChatGPT settings.');}catch(e){say(e.message);}finally{busy=false;render();}};
  $('manageUsage').onclick=$('homeManageUsage').onclick=()=>void native?.accountUsage();
  $('useChatGPT').onclick=async()=>{busy=true;aborter=new AbortController();render();say('Preparing listening on this Mac. First use downloads about 150 MB.');try{await prepareSpeech(aborter.signal);write('chatGPTModel',$('chatGPTModel').value);chooseProvider('chatgpt');page('test');if(!read('chatGPTPlanWelcomed',false)){$('planWelcome').hidden=false;}}catch(e){say(e.message);}finally{busy=false;aborter=null;render();}};
  $('planGotIt').onclick=()=>{$('planWelcome').hidden=true;write('chatGPTPlanWelcomed',true);};
  $('simpleLocalModel').value=getSettings().deviceModel;
  $('useLocal').onclick=async()=>{busy=true;aborter=new AbortController();render();say('Downloading once. Keep Cue open; progress appears below.');try{write('deviceChoiceMade',true);await prepareLocal($('simpleLocalModel').value,aborter.signal);chooseProvider('device');page('test');}catch(e){say(e.name==='AbortError'?'Download cancelled. Retry to reuse cached files.':e.message);}finally{busy=false;aborter=null;render();}};
  $('cancelLocalSetup').onclick=$('cancelSpeechSetup').onclick=()=>aborter?.abort();
  $('trySetupQuestion').onclick=()=>{$('setupDialog').close();write('setupComplete',true);void tryQuestion('How would you decide which feature to build first?');};
  $('finishSetup').onclick=()=>{$('setupDialog').close();write('setupComplete',true);};
  native?.onAccountState?.(value=>{state=value;render();});
  return {open,home,refreshAccount,progress(p){const text=p.kind==='ready'||p.kind==='speech-ready'?p.text:p.kind==='answer'?'Preparing your local AI'+(Number.isFinite(p.progress)?' · '+Math.round(p.progress*100)+'%':'…'):p.kind==='speech'?'Preparing English listening'+(Number.isFinite(p.progress)?' · '+Math.round(p.progress)+'%':'…'):'Preparing…';$('simpleDeviceProgress').textContent=text;$('simpleSpeechProgress').textContent=p.kind==='ready'?(localStatus()?.speech?'English listening is ready on this Mac.':''):text;if(Number.isFinite(p.progress)){$('simpleDeviceDownload').hidden=false;$('simpleDeviceDownload').value=p.kind==='answer'?p.progress:p.progress/100;}home();},accountReady:()=>state.sharing,async readyModel(){await refreshAccount();if(!state.sharing)throw new Error('Open Your AI and connect your ChatGPT account.');return read('chatGPTModel','')||models[0]?.id;}};
}
