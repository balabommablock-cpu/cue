import {apiResponse} from './api-ui.js';
import {preferencesUI} from './preferences-ui.js';
import {setupUI} from './setup-ui.js';
import {unwrap,accountResponse} from './account-ui.js';
import {parseResponse,completedText} from './core.js';
import {ProgressView} from './progress-ui.js';
import {QuestionJoiner,InterviewTurn,caseSetup} from './question-joiner.js';
import {ConversationLedger} from './conversation.js';
import {QuestionSegmenter,pcmBase64} from './local-audio.js';
import {acquireAudio,inputLevel} from './audio-capture.js';
import {dualAudio,sharedMicrophone,speechSourceFor,transcriptionLane,CrossSourceEcho} from './audio-routing.js';
import {turnDecision} from './turn-decision.js';
import {sameUtterance,explicitQuestion,turnRoute,questionReplacement,sharedMicIntent,interviewerRequest} from './reading.js';
import {SpeechPipeline,transcribeRequest} from './speech-pipeline.js';
import {VoiceReader} from './reader-ui.js';
import {PendingTurns} from './pending-turns.js';
import {consumeAnswer} from './answer-stream.js';
import {LiveCoach,renderCoach} from './coach-ui.js';
import {StoryStudio} from './story-ui.js';
import {storyFacts,confirmedProfile} from './story-core.js';
import {reconcileProfile,backgroundFacts,renderBackground} from './background-ui.js';
import {ANSWER_MODELS,DEFAULT_ANSWER_MODEL,DEFAULT_ANSWER_SPEED,answerOptions} from './model-options.js';
const $=id=>document.getElementById(id);
const native=window.cueDesktop;
let deviceRuntime,deviceModule,deviceLoading=null,personalSetup,warmAbort=null;
function cancelWarmup(){if(!warmAbort)return;warmAbort.abort();warmAbort=null;if($('notice').textContent==='Loading your saved local AI…')notice('');}
const apiProvider=()=>['openai','anthropic'].includes(settings.provider);
const providerName=()=>({device:'local AI',chatgpt:'ChatGPT',openai:'OpenAI',anthropic:'Claude',codex:'Codex'})[settings.provider]||'AI';
const usesText=()=>['codex','device','chatgpt','openai','anthropic'].includes(settings.provider);
function deviceProgress(p){
  personalSetup?.progress(p);
  const text=p.text||(p.kind==='speech'?`Listening model: ${p.file||p.status||'loading'}${p.progress===undefined?'':' · '+Math.round(p.progress)+'%'}`:'Preparing local AI…');
  $('deviceProgress').textContent=text;
  if(p.kind==='answer'&&Number.isFinite(p.progress)){$('deviceDownload').hidden=false;$('deviceDownload').value=p.progress;}
}
async function localDevice(){
  if(!deviceModule){deviceLoading??=import('/device/runtime.js');try{deviceModule=await deviceLoading;}catch(e){deviceLoading=null;throw new Error('Local AI files could not load. Reinstall the latest Cue build.');}}
  deviceRuntime??=deviceModule.createRuntime({progress:deviceProgress});return deviceRuntime;
}
async function prepareDevice(signal,audio=true){
  const runtime=await localDevice();await runtime.prepare({model:settings.deviceModel,audio},signal);signal?.throwIfAborted();write('devicePrepared',true);return runtime;
}
const transcribeSpeech=async(pcm,signal,options)=>['device','chatgpt','openai','anthropic'].includes(settings.provider)?(await localDevice()).transcribe(pcm,signal):transcribeRequest(pcm,signal,options);

const flow=new ProgressView({$,onChange:()=>refreshView()});
if(!native){document.body.classList.add('browser');$('pinButton').hidden=true;$('closeButton').hidden=true;}
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem('cue.'+key))??fallback;}catch{return fallback;}};
const write=(key,value)=>{try{localStorage.setItem('cue.'+key,JSON.stringify(value));}catch{notice('Your browser could not save preferences. They will last for this session only.');}};
let background,backgroundLoad;
let interviewId='',contextToken='',interviewCatalog=null,interviewLoading=false,interviewsReady=false;
function scoped(data){return interviewId&&!data?.contextToken?{...data,interviewId,contextToken}:data;}
function saveProfile(){write(interviewId?'profile:'+interviewId:'profile',settings.profile);}
function clearInterviewConversation(){
  stop();studio?.resetPractice();coach?.cancel();answerArchive=[];archiveIndex=-1;bookmarks.length=0;
  resetDisplay();$('question').textContent='';$('typedQuestion').value='';$('historyList').replaceChildren();syncArchive();
}
function renderInterviewChoices(){
  $('interviewPicker').replaceChildren();for(const item of interviewCatalog.interviews)$('interviewPicker').add(new Option(item.name,item.id));$('interviewPicker').value=interviewId;
}
async function selectInterview(id){
  if(connected||connecting||interviewLoading){$('interviewPicker').value=interviewId;notice('Stop listening before changing interview.');return;}
  interviewLoading=true;interviewsReady=false;syncControls();clearInterviewConversation();
  try{
    const result=await request('/api/interviews/select',{interviewId:id});
    interviewId=id;contextToken=result.contextToken;write('interviewId',id);
    background=result.background;
    settings.profile=read('profile:'+id,background.profile);$('profile').value=settings.profile;
    $('interviewPicker').value=id;applyBackground(background);interviewsReady=true;
    notice('');flow.set('idle','Ready for '+background.interviewName+'. Recording is off.');
  }catch(e){contextToken='';settings.profile='';$('profile').value='';background=null;notice(e.message);flow.set('error','Choose your interview again before starting.');}
  finally{interviewLoading=false;syncControls();}
}
async function loadInterviews(){
  const r=await fetch('/api/interviews');if(!r.ok)throw new Error('Interview list unavailable');
  interviewCatalog=await r.json();
  if(interviewCatalog.legacy){$('interviewBar').hidden=true;interviewsReady=true;return false;}
  const saved=read('interviewId',interviewCatalog.defaultId);
  const selected=interviewCatalog.interviews.some(x=>x.id===saved)?saved:interviewCatalog.defaultId;
  const legacy=read('profile',null);
  if(legacy&&legacy!==seed.profile&&read('profile:'+selected,null)===null)write('profile:'+selected,legacy);
  renderInterviewChoices();await selectInterview(selected);return true;
}
function applyBackground(value){
  background=value;const hasContext=!!(value.records.length||settings.profile.trim());$('backgroundButton').textContent=hasContext?'Background loaded':'Add your context';$('homeBackground').textContent=hasContext?'✓ '+(value.interviewName||'Your background')+' is ready':'+ Add your CV or context';
  $('backgroundStatus').textContent=`${value.interviewName||'Your background'} · ${value.applicationFields||0} fields captured · ${value.records.length} indexed entries`;
  renderBackground($,value);$('backgroundSources').textContent=value.sources.map(s=>s.title+' — '+s.detail).join('\n');$('backgroundNote').textContent=value.note||'';
  if(value.warning)$('knowledgeMessage').textContent=value.warning;
}

let capture,seed,config,pc,dc,stream,audioCtx,analyser,meterFrame,connectTimer,disconnectTimer,aborter;
let connected=false,connecting=false,paused=false,activeResponse=null,raw='',lastFinished=0,firstTextAt=0,startAt=0,scrollFrame=0,demoTimer;
let generation=0,filterStale=false,historyCount=0,pinned=true;
let processors=[],segmenters=[],speechPipeline,lastTurn=null,answerArchive=[],archiveIndex=-1,lastQuestionAt=0,latestSpeechText='';
const pendingQuestions=new PendingTurns();
const questionJoiner=new QuestionJoiner();
const sharedQuestionJoiner=new QuestionJoiner();
const crossSourceEcho=new CrossSourceEcho();
const interviewerTurn=new InterviewTurn();
const conversation=new ConversationLedger();
let retryInput=null,readyAnswer=null,candidateSpeaking=false,quietTimer,answerRevision=0;
let sourceBeforeText=null;
let processor,segmenter,pendingPCM,localSessionId,localBusy=false,localAbort,localHistory=[],audioHeard=false;
let advancingFollowup=false;
let localJob=null,requestSequence=0,replacementRevision=0,editingQuestion=false,editHold=null,lastHeardQuestion='';
let platforms=[],shareState={state:'stopped',message:'Share View is off.'},shareStarting=false;
function renderShareState(value){if(!value)return;const previous=shareState.message;shareState=value;$('shareState').textContent=value.message||'Share View is off.';$('shareButton').textContent=['starting','live','permission_required','error'].includes(value.state)?'Close share view':'Share view';if(['live','permission_required','error'].includes(value.state))notice(value.message);else if(value.state==='stopped'&&$('notice').textContent===previous)notice('');}
function platformHelp(){const p=platforms.find(x=>x.id===$('meetingPlatform').value);$('platformHelp').textContent=p?`${p.guidance} Cue verification: ${p.verification}.`:'Choose a specific window or tab if your platform allows it. No platform has a universal invisibility guarantee.';write('platform',$('meetingPlatform').value);}
const settings={profile:'',style:read('style','cues'),source:read('source','both'),microphone:read('microphone','default'),echoCancellation:read('echoCancellation',true),auto:read('auto',true),provider:read('provider','codex'),deviceModel:read('deviceModel','balanced'),answerModel:read('answerModel',DEFAULT_ANSWER_MODEL),answerSpeed:read('answerSpeed',DEFAULT_ANSWER_SPEED)};
try{answerOptions(settings);}catch{settings.answerModel=DEFAULT_ANSWER_MODEL;settings.answerSpeed=DEFAULT_ANSWER_SPEED;}
function audioSourceUI(){
  const source=$('audioSource').value;$('microphoneSetting').hidden=!['both','mic','hybrid'].includes(source);
  $('audioHelp').textContent=source==='hybrid'?'Hears questions from this Mac and from a phone or person near your microphone. Your own answers stay as context. Keep speakers near the mic and take turns; overlapping room voices cannot be reliably separated.':source==='both'?'For a call playing on this Mac. Computer audio hears the interviewer; your microphone follows your answer. For a phone on speaker, choose Phone or in-person.':source==='mic'?'Hears the whole conversation through your microphone, including a phone on speaker. Questions trigger answers; matching speech follows your reading. Speak one at a time. Voice separation is based on the words, not voice identity.':source==='system'?'Hears audio playing on your Mac, including the interviewer. Your microphone is not included.':'No recording. Type a question to get an answer.';
  $('echoCancellation').disabled=source==='mic';
}
async function refreshMicrophones(){
  const select=$('microphoneDevice');select.replaceChildren(new Option('System default microphone','default'));
  try{for(const d of await navigator.mediaDevices.enumerateDevices())if(d.kind==='audioinput'&&d.deviceId&&d.deviceId!=='default')select.add(new Option(d.label||'Microphone '+select.options.length,d.deviceId));}catch{}
  if(settings.microphone!=='default'&&!Array.from(select.options).some(o=>o.value===settings.microphone))select.add(new Option('Previously selected microphone (unavailable)',settings.microphone));
  select.value=settings.microphone;
}
let studio,coach;const bookmarks=[];
function effectiveProfile(){const profile=confirmedProfile(settings.profile);const facts=storyFacts(studio?.stories||[],Math.max(0,39500-profile.length));return profile+(facts==='[]'?'':'\nCONFIRMED STORY LIBRARY:\n'+facts);}
function beginCoaching(question){if(settings.provider==='codex')coach?.begin(question);}
function bookmarkAnswer(){if(!raw)return;bookmarks.push({raw,question:$('question').textContent,cursor:reader.cursor,scroll:$('answerFrame').scrollTop,coach:coach.snapshot()});if(bookmarks.length>3)bookmarks.shift();$('returnAnswer').hidden=false;}
async function returnToAnswer(){interviewerTurn.clear();const saved=bookmarks[bookmarks.length-1];if(!saved)return;await replaceQuestion(null);if(bookmarks[bookmarks.length-1]!==saved)return;bookmarks.pop();resetReading();raw=saved.raw;render();$('question').textContent=saved.question;$('questionLabel').textContent='ORIGINAL ANSWER';reader.cursor=saved.cursor;$('answerFrame').scrollTop=saved.scroll;reader.describe();coach.restore(saved.coach,{running:connected&&!paused});$('returnAnswer').hidden=!bookmarks.length;}
const reader=new VoiceReader({frame:$('answerFrame'),answer:$('answer'),state:$('readingState'),resume:$('resumeFollow'),getMode:()=>$('scrollMode').value,getSpeed:()=>Number($('scrollSpeed').value)||18,canScroll:()=>!paused&&!editingQuestion&&(connected||$('statusText').textContent==='Demo')&&flow.stage!=='speech'&&!['settings','displayDialog','historyDialog','storiesDialog','practiceDialog','backgroundDialog','setupDialog'].some(id=>$(id).open),getHint:()=>settings.source==='text'?'Typed session · recording off':!usesText()?'Use steady scroll in Realtime mode':!['both','mic','hybrid'].includes(settings.source)?'Voice follow needs your microphone · choose it in Settings':''});
function providerUI(){
  const provider=$('provider').value,device=provider==='device',codex=provider==='codex';
  $('apiSettings').hidden=provider!=='realtime';$('codexSettings').hidden=!codex;$('deviceSettings').hidden=!device;
  $('sampleButton').hidden=provider==='realtime';$('sampleHelp').hidden=provider==='realtime';
  const model=ANSWER_MODELS.find(m=>m.id===$('answerModel').value)?.label.replace(' · recommended','')||'the selected model';
  $('providerHelp').textContent=['openai','anthropic'].includes(provider)?'Using your own '+(provider==='openai'?'OpenAI':'Claude')+' API key and selected text model. Manage it in Your AI. Speech is transcribed on this Mac.':provider==='chatgpt'?'Using your ChatGPT plan. Connect or switch accounts in Your AI. Speech stays on this Mac; questions and relevant context go to OpenAI.':device?'Qwen3 answers and Whisper transcribes on this Mac. No API key, Codex account or cloud fallback. First setup downloads about 1–5 GB depending on your model. Small local models are less capable than leading cloud models.':codex?`Uses your Codex login and plan limits. Speech stays local; relevant context and questions go to ${model}.`:'Realtime sends selected audio to OpenAI and needs an API key with credit.';
  $('speedHelp').textContent=$('answerSpeed').value==='priority'?'Fast requests priority processing and consumes more Codex allowance.':'Standard uses regular Codex processing.';
}

function notice(message=''){$('notice').textContent=message;$('notice').hidden=!message;}
function status(text,kind=''){$('statusText').textContent=text;$('status').className='status '+kind;}
async function request(path,data,method='POST',signal){
  if(apiProvider()){
    if(path==='/api/codex/check'){await personalSetup.readyApiModel(settings.provider);if(data.audio)await(await localDevice()).prepareSpeech(signal);return {sessionId:settings.provider+'-'+Date.now(),localAudioAvailable:true};}
    if(path==='/api/codex/stop'||path==='/api/answer/interrupt'){await native?.apiInterrupt();return {interrupted:true};}
    if(path.startsWith('/api/coach/'))throw new Error('AI coaching and story extraction currently require Codex. Your CV and manual stories work with this AI.');
  }
  if(settings.provider==='chatgpt'){
    if(path==='/api/codex/check'){await personalSetup.readyModel();if(data.audio)await(await localDevice()).prepareSpeech(signal);return {sessionId:'chatgpt-'+Date.now(),localAudioAvailable:true};}
    if(path==='/api/codex/stop'||path==='/api/answer/interrupt'){await native?.accountInterrupt();return {interrupted:true};}
    if(path.startsWith('/api/coach/'))throw new Error('AI coaching and story extraction currently require the advanced Codex connection. Your CV and manual stories work with either AI.');
  }
  if(settings.provider==='device'){
    if(path==='/api/codex/check'){await prepareDevice(signal,data.audio);return {sessionId:'device-'+Date.now(),localAudioAvailable:true};}
    if(path==='/api/codex/stop'){deviceRuntime?.stop();return {};}
    if(path==='/api/answer/interrupt')return deviceRuntime?deviceRuntime.interrupt():{interrupted:false};
    if(path.startsWith('/api/coach/'))throw new Error('Live coaching and AI story extraction use Codex. Local mode supports answers, voice following, imported context and manually added stories.');
  }

  const r=await fetch(path,{method,signal,headers:{'Content-Type':'application/json','X-Cue-Client':'1'},body:data===undefined?undefined:JSON.stringify(path.startsWith('/api/interviews')?data:scoped(data))});
  let payload;try{payload=await r.json();}catch{throw new Error('The local app did not return a readable response.');}
  if(!r.ok){const error=new Error(payload.error||'Request failed.');error.status=r.status;throw error;}return payload;
}
async function refreshConfig(signal){const r=await fetch('/api/config',{signal:signal||AbortSignal.timeout(12000)});if(!r.ok)throw new Error('Could not reach the local app. Reopen Cue.');config=await r.json();$('keyState').textContent=config.keyConfigured?'Key ready':'Add a key';$('forgetKey').hidden=config.keySource!=='session';$('settingsVersion').textContent='Cue'+(config.version?' '+config.version:' preview')+' · Open from Applications or your Dock';}
function syncControls(){
  personalSetup?.home();
  $('interviewPicker').disabled=connected||connecting||interviewLoading;$('addInterview').disabled=connected||connecting||interviewLoading;
  $('startButton').disabled=!interviewsReady||interviewLoading;

  $('coachEnabled').disabled=settings.provider!=='codex';$('coachEnabled').title=settings.provider==='codex'?'Follows your microphone speech using Codex.':'Live coaching requires Codex mode.';if(settings.provider!=='codex'){coach?.cancel();$('coachCard').hidden=true;}
  $('startButton').textContent=connecting?'Cancel':connected?'Stop':settings.source==='text'?'Connect':'Start listening';
  $('startButton').classList.toggle('stop',connected||connecting);
  $('pauseButton').hidden=!connected||settings.source==='text';
  $('pauseButton').textContent=paused?'Resume listening':'Pause listening';
  $('answerButton').hidden=!connected||settings.auto||settings.source==='text';
  $('answerMode').textContent=settings.source==='text'?'Typed questions':paused?'Listening paused':settings.auto?'Answers automatically':'Manual answers';
  $('answerMode').hidden=connecting;
  $('dualSignals').hidden=!dualAudio(settings.source);$('mainSignal').hidden=dualAudio(settings.source);$('micSourceLabel').textContent=settings.source==='hybrid'?'Room / phone':'You';
  $('quickAudio').value=sourceBeforeText??settings.source;$('quickAudio').disabled=connected||connecting;
  $('sourceLabel').textContent=settings.source==='hybrid'?'Mac + room microphone':settings.source==='both'?'Computer + microphone':settings.source==='system'?(native?'Computer audio':'Shared audio'):settings.source==='mic'?'Room microphone':'Typed questions';
  $('roomHint').hidden=!sharedMicrophone(settings.source)||!!raw;
  $('demoButton').hidden=connected||connecting;
  refreshView();
}
function refreshView(){
  const hasAnswer=!!parseResponse(raw).answer.trim();
  document.body.setAttribute('data-session',connecting?'connecting':connected?'live':'idle');
  document.body.classList.toggle('has-answer',hasAnswer);
  $('welcome').hidden=hasAnswer||connecting||connected;$('answerFrame').hidden=!hasAnswer;
  $('questionBlock').hidden=!hasAnswer&&!lastHeardQuestion;
  $('readingBar').hidden=!(hasAnswer&&connected||readyAnswer||retryInput);
  $('historyButton').hidden=!answerArchive.length;
  $('roomHint').hidden=!sharedMicrophone(settings.source)||hasAnswer;
  $('correctQuestion').hidden=!connected||!lastHeardQuestion||!$('incomingQuestionBlock').hidden;
  const title=connecting?'Getting ready…':flow.stage==='error'?'Let’s get this working.':connected?(paused?'Listening is paused.':flow.stage==='transcribe'?'Turning speech into text…':lastHeardQuestion?'Your answer is on its way.':settings.source==='text'?'What’s the question?':'Listening for the first question.'):'Stay in the conversation.';
  const detail=connecting?(settings.source==='text'?'Connecting your answer model. Recording stays off.':'Connecting your answer model and audio. You can cancel at any time.'):flow.stage==='error'?'The message above explains what needs attention.':connected?(paused?'Choose Resume listening when you’re ready.':flow.stage==='transcribe'?'Your AI will answer after the speech is transcribed.':lastHeardQuestion?'The suggestion will appear here as it is written.':settings.source==='text'?'Type or paste a question below.':'Speak naturally. Answers appear here automatically.'):'Start listening. Cue hears the questions and helps you answer in your own words. ';
  $('welcomeTitle').textContent=title;$('welcomeDetail').textContent=detail;
  reader.update();
}
async function startTextSession(){
  if(connected)return true;
  if(connecting)return false;
  sourceBeforeText=settings.source;settings.source='text';
  await connect();
  if(!connected&&connecting&&dc){
    const channel=dc;
    await new Promise(resolve=>{
      const finish=()=>{clearTimeout(timer);channel.removeEventListener('open',finish);channel.removeEventListener('close',finish);resolve();};
      const timer=setTimeout(()=>{stop('Connection timed out');finish();},35000);
      channel.addEventListener('open',finish,{once:true});channel.addEventListener('close',finish,{once:true});
    });
  }
  return connected;
}
function openHistory(){
  $('historyList').replaceChildren();
  for(const [index,entry] of [...answerArchive].entries()){
    const item=document.createElement('details'),heading=document.createElement('summary'),answer=document.createElement('p');
    heading.textContent=entry.question;answer.textContent=parseResponse(entry.raw).answer;
    item.open=index===answerArchive.length-1;item.append(heading,answer);$('historyList').append(item);
  }
  const historyState=!connected||settings.source==='text'?'Recording is off.':paused?'Listening is paused.':'Listening continues while this is open.';
  $('historyHelp').textContent='Open a question to read its answer. '+historyState;
  $('historyDialog').showModal();
}
function coachingProfile(){return (confirmedProfile(settings.profile)+'\n'+backgroundFacts(background)).slice(0,39000);}
async function loadBackground(){
  try{const r=await fetch('/api/background'+(interviewId?'?interviewId='+encodeURIComponent(interviewId):''),{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('Background unavailable');const value=await r.json();if(value.error||!Array.isArray(value.records))throw new Error(value.error||'Background unavailable');applyBackground(value);if(interviewId&&read('profile:'+interviewId,null)===null){settings.profile=value.profile;$('profile').value=settings.profile;}}
  catch{$('backgroundButton').textContent='Background unavailable';$('homeBackground').textContent='Review your background';$('backgroundStatus').textContent='Saved background could not reload. The previously loaded interview stays available.';}
}
async function openSettings(){providerUI();audioSourceUI();void refreshMicrophones();$('settings').showModal();if(native){$('desktopSettings').hidden=false;try{const s=await native.status();$('captureProtection').checked=s.protectedCapture;$('permissionState').textContent='Recording access — Screen: '+s.screen+' · Microphone: '+s.microphone;renderShareState(s.shareView);}catch{$('permissionState').textContent='Could not read recording permission status.';}}}
function resetReading(){answerRevision++;reader.reset();for(const part of segmenters)if(part.source==='mic'&&(!candidateSpeaking||part.coachEpoch!==coach?.epoch))part.reset();if(!segmenters.some(p=>p.source==='mic'&&p.active))candidateSpeaking=false;clearTimeout(quietTimer);}
function resetDisplay(){resetReading();raw='';$('answer').textContent='';$('answer').classList.remove('empty');$('check').hidden=true;$('answerFrame').scrollTop=0;$('latency').textContent='';$('incomingQuestionBlock').hidden=true;}
function render(){const parsed=parseResponse(raw);if(parsed.question)$('question').textContent=parsed.question;$('answer').textContent=parsed.answer;$('check').textContent=parsed.check?'Check before saying: '+parsed.check:'';$('check').hidden=!parsed.check;refreshView();}
function send(event){if(dc?.readyState!=='open')throw new Error('Start a connection first.');dc.send(JSON.stringify(event));}
function cancelAnswer(){if(activeResponse){try{send({type:'response.cancel',response_id:activeResponse});}catch{}}activeResponse=null;filterStale=true;}
function generate(){
  if(usesText()){
    if(localBusy){notice('An answer is already being written. The next question will follow it.');return;}
    if(readyAnswer){showReadyAnswer();return;}
    if(pendingQuestions.length){void localAnswer({...pendingQuestions.take(),autoDetect:false});return;}
    const active=segmenters.filter(part=>part.active&&part.voice>=4800);
    if(active.length){const part=active.find(p=>p.source==='system')||active[0];part.forced=true;part.flush();status('Finishing that question…','live');return;}
    if(pendingPCM){const pcm=pendingPCM;pendingPCM=null;void localAnswer({pcm,autoDetect:false});return;}
    if(latestSpeechText){void localAnswer({question:latestSpeechText,autoDetect:false});return;}
    notice('Speak a question or use Type question.');return;
  }
  cancelAnswer();startAt=performance.now();send({type:'response.create',response:{output_modalities:['text']}});
}
function handleEvent(event){
  if(event.type==='input_audio_buffer.speech_started'){status(dualAudio(settings.source)?'Hearing conversation':'Hearing question','live');$('questionLabel').textContent='LISTENING';flow.set('speech','Audio is reaching OpenAI');startAt=performance.now();}
  if(event.type==='input_audio_buffer.speech_stopped'){lastFinished=performance.now();status(settings.auto?'Thinking…':'Question ready','live');flow.set(settings.auto?'draft':'listen',settings.auto?'Preparing your answer':'Question ready');$('questionLabel').textContent='QUESTION UNDERSTOOD';}
  if(event.type==='response.created'){
    activeResponse=event.response.id;filterStale=false;resetDisplay();firstTextAt=0;status('Writing answer','live');flow.set('draft','Preparing your answer');$('answer').classList.add('streaming');
  }
  if(event.type==='response.output_text.delta'){
    if(filterStale||(activeResponse&&event.response_id!==activeResponse))return;
    if(!firstTextAt){firstTextAt=performance.now();const since=lastFinished||startAt;$('latency').textContent=since?((firstTextAt-since)/1000).toFixed(1)+'s to text':'';}
    raw+=event.delta;render();flow.set('write','Text appears as it arrives');
  }
  if(event.type==='response.done'){
    if(filterStale||(activeResponse&&event.response.id!==activeResponse))return;
    const full=completedText(event.response);if(full){raw=full;render();}
    activeResponse=null;$('answer').classList.remove('streaming');historyCount++;
    if(event.response.status==='completed'&&parseResponse(raw).answer.trim()){answerArchive.push({question:$('question').textContent,raw});answerArchive=answerArchive.slice(-12);archiveIndex=answerArchive.length-1;syncArchive();}
    if(event.response.status==='failed'){notice('OpenAI could not complete the answer. Check API credits and model access, then retry.');status('Answer failed','error');flow.set('error','Check API credits and model access');}
    else{status(paused?'Paused':settings.source==='text'?'Connected':'Listening','live');flow.set(paused?'paused':'ready',$('latency').textContent);}
  }
  if(event.type==='error'){
    if(['response_cancel_not_active','input_audio_buffer_commit_empty'].includes(event.error?.code))return;
    const code=event.error?.code||'unknown';notice('OpenAI reported an issue ('+code+'). You can stop and reconnect.');status('Needs attention','error');flow.set('error','Connection needs attention');
  }
}
function audioMeter(){
  let warned=false,computerWarned=false;const started=performance.now();
  const computerWarning='No computer audio detected yet. If your interviewer is speaking, check Audio settings.';
  const tick=()=>{
    if(!analyser)return;
    const level=inputLevel(analyser);$('level').value=level;
    for(const input of capture?.inputs||[]){
      const value=inputLevel(input.analyser);$(input.kind==='mic'?'micLevel':'systemLevel').value=value;
      if(value>.02)input.heard=true;
      $(input.kind==='mic'?'micState':'systemState').textContent=value>.02?'Hearing':input.heard?'Connected':'Waiting for audio';
      if(settings.source==='mic')$('sourceLabel').textContent=value>.02?'Room microphone · hearing':input.heard?'Room microphone · connected':'Room microphone · waiting for sound';
    }
    const computer=capture?.inputs.find(input=>input.kind==='system');
    if(computer?.heard&&computerWarned){if($('notice').textContent===computerWarning)notice('');computerWarned=false;}
    else if(computer&&!computer.heard&&!paused&&performance.now()-started>15000&&!computerWarned&&!$('notice').textContent){notice(computerWarning);computerWarned=true;}
    if(level>.02){audioHeard=true;if(warned){notice('');warned=false;}}
    else if(!paused&&!audioHeard&&performance.now()-started>15000&&!warned){
      notice(settings.source==='mic'?'No microphone signal yet. Speak near your mic; check the device selected in Settings.':dualAudio(settings.source)?'No audio signal yet. Speak or play audio, and check the separate microphone and computer meters.':'No computer audio yet. Play the interviewer’s audio, or choose Computer audio + microphone to hear your voice too.');warned=true;
    }
    meterFrame=requestAnimationFrame(tick);
  };tick();
}
async function getSystemAudio(){
  if(native){const access=await native.status();if(access.screen==='denied')throw new Error('Allow Cue in System Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen Cue.');}
  try{return await navigator.mediaDevices.getDisplayMedia({video:true,audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},systemAudio:'include',selfBrowserSurface:'exclude'});}
  catch(e){if(native){const access=await native.status();if(access.captureError)throw new Error('Computer audio could not start. macOS recording access is '+access.screen+'. Quit and reopen Cue after changing access. Details: '+access.captureError);}throw e;}
}
async function getAudio(mine){
  const acquired=await acquireAudio({mode:settings.source,microphoneId:settings.microphone,echoCancellation:settings.echoCancellation,getSystemStream:getSystemAudio,isCurrent:()=>mine===generation,onEnded:kind=>{if(mine===generation){stop('Audio ended');notice((kind==='mic'?'Microphone':'Computer audio')+' disconnected. Check the source and press Start again.');}}});
  if(mine!==generation){acquired?.stop();return null;}
  capture=acquired;return acquired?.stream||null;
}
function stop(message='Stopped'){
  conversation.clear();
  interviewerTurn.clear();questionJoiner.clear();sharedQuestionJoiner.clear();crossSourceEcho.clear();
  coach?.stop();bookmarks.length=0;$('returnAnswer').hidden=true;
  if(localSessionId){const sessionId=localSessionId;localSessionId=null;void request('/api/codex/stop',{sessionId}).catch(()=>{});}
  generation++;replacementRevision++;advancingFollowup=false;questionJoiner.clear();sharedQuestionJoiner.clear();crossSourceEcho.clear();flow.set('stopped');closeQuestionEditor();localJob=null;lastHeardQuestion='';$('incomingQuestionBlock').hidden=true;$('correctQuestion').hidden=true;aborter?.abort();clearTimeout(connectTimer);clearTimeout(disconnectTimer);clearInterval(demoTimer);
  if(dc){dc.onclose=null;dc.close();}if(pc){pc.onconnectionstatechange=null;pc.close();}
  capture?.stop();capture=null;stream?.getTracks().forEach(t=>t.stop());stream=null;pc=null;dc=null;
  speechPipeline?.stop();speechPipeline=null;for(const p of processors)p.disconnect();processors=[];for(const s of segmenters)s.reset();segmenters=[];pendingQuestions.clear();lastTurn=null;latestSpeechText='';reader.stop();candidateSpeaking=false;clearTimeout(quietTimer);readyAnswer=null;retryInput=null;$('showReadyAnswer').hidden=true;$('retryAnswer').hidden=true;
  localAbort?.abort();localAbort=null;localBusy=false;processor?.disconnect();processor=null;segmenter?.reset();segmenter=null;pendingPCM=null;localHistory=[];
  cancelAnimationFrame(meterFrame);analyser=null;audioCtx?.close().catch(()=>{});audioCtx=null;
  connected=false;connecting=false;paused=false;activeResponse=null;filterStale=true;lastFinished=0;audioHeard=false;$('heardLine').textContent='';$('heardLine').hidden=true;
  if(sourceBeforeText!==null){settings.source=sourceBeforeText;sourceBeforeText=null;}
  $('level').value=0;$('micLevel').value=0;$('systemLevel').value=0;$('micState').textContent='Off';$('systemState').textContent='Off';$('answer').classList.remove('streaming');$('questionLabel').textContent=raw?'LAST ANSWER · RECORDING OFF':'RECORDING OFF';$('readingState').textContent='Recording off';notice('');status(message);syncControls();syncArchive();
}
async function connect(){
  if(!interviewsReady||interviewLoading){notice('Choose a loaded interview before starting.');return;}

  if($('statusText').textContent==='Demo'){clearInterval(demoTimer);render();$('answer').classList.remove('streaming');}
  if(connected||connecting){stop();return;}
  // Reserve this attempt before the first await. A second click must cancel it,
  // including while configuration or login checks are still in flight.
  const mine=++generation;connecting=true;lastHeardQuestion='';resetDisplay();refreshView();syncControls();notice('');status('Connecting…');flow.set('start','Opening the connection');aborter=new AbortController();
  try{
    await refreshConfig(AbortSignal.any([aborter.signal,AbortSignal.timeout(12000)]));if(mine!==generation)return;
    if(usesText()){await connectLocal(mine);return;}
    if(!config.keyConfigured){stop('Key needed');$('connectionDetails').open=true;openSettings();$('apiKey').focus();notice('Add your OpenAI API key once, then press Start.');return;}
    status('Choose audio…');const acquired=await getAudio(mine);if(mine!==generation){acquired?.getTracks().forEach(t=>t.stop());return;}stream=acquired;
    const peer=new RTCPeerConnection();pc=peer;
    if(stream){for(const track of stream.getAudioTracks()){peer.addTrack(track,stream);track.onended=()=>{if(mine===generation)stop('Audio ended');};}audioCtx=capture.context;analyser=audioCtx.createAnalyser();analyser.fftSize=256;audioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(analyser);await audioCtx.resume();audioMeter();}
    else peer.addTransceiver('audio',{direction:'recvonly'});
    dc=peer.createDataChannel('oai-events');
    dc.onmessage=e=>{if(mine===generation){try{handleEvent(JSON.parse(e.data));}catch{notice('An unreadable event arrived. Stop and reconnect if answers do not resume.');}}};
    dc.onopen=()=>{if(mine!==generation)return;clearTimeout(connectTimer);connected=true;connecting=false;flow.set('listen',settings.source==='text'?'Type a question':'Ready for the interviewer');status(settings.source==='text'?'Connected':'Listening','live');$('questionLabel').textContent='QUESTION UNDERSTOOD';$('question').textContent=settings.source==='text'?'Type a question below.':dualAudio(settings.source)?'Listening to you and the interviewer…':'Waiting for the interviewer’s question…';syncControls();if(settings.source==='text'){$('typedForm').hidden=false;$('typedQuestion').focus();}};
    dc.onclose=()=>{if(mine===generation)stop('Disconnected');};
    peer.onconnectionstatechange=()=>{if(mine!==generation)return;if(peer.connectionState==='failed'){stop('Connection failed');notice('The audio connection failed. Check your network, then press Start again.');}if(peer.connectionState==='disconnected')disconnectTimer=setTimeout(()=>{if(peer.connectionState==='disconnected'){stop('Disconnected');notice('Connection was lost. Press Start to reconnect.');}},8000);else clearTimeout(disconnectTimer);};
    status('Connecting…');const offer=await peer.createOffer();await peer.setLocalDescription(offer);if(mine!==generation)return;
    aborter=new AbortController();connectTimer=setTimeout(()=>{if(mine===generation){stop('Connection timed out');notice('Could not connect in time. Check your connection and API access.');}},35000);
    const response=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json','X-Cue-Client':'1'},body:JSON.stringify(scoped({sdp:offer.sdp,profile:effectiveProfile(),style:settings.style,auto:settings.auto})),signal:aborter.signal});
    if(mine!==generation)return;if(!response.ok){const failure=await response.json();throw new Error(failure.error);}
    await peer.setRemoteDescription({type:'answer',sdp:await response.text()});
  }catch(e){if(mine!==generation)return;native?.reportPhase?.('start-failed');stop('Could not start');notice(e.name==='NotAllowedError'?'Audio permission was not granted. Choose a source again, or allow Cue in macOS recording settings.':e.message);}
}
async function updateInstructions(){if(!connected||usesText())return;const result=await request('/api/instructions',{profile:effectiveProfile(),style:settings.style});send({type:'session.update',session:{type:'realtime',instructions:result.instructions,audio:{input:{turn_detection:{type:'server_vad',threshold:.5,prefix_padding_ms:300,silence_duration_ms:900,create_response:settings.auto,interrupt_response:true}}}}});}
function queueQuestion(input){
  try{pendingQuestions.push(input);status('Next question queued','live');flow.set('switch','Keeping the follow-up ready');}catch(e){notice(e.message);}
}
function questionAudioPending(){return segmenters.some(part=>part.active&&(part.source==='system'||part.source==='shared'))||!!speechPipeline?.hasPendingQuestionSpeech?.();}
function maybePresentReady(){if(readyAnswer&&!paused&&!editingQuestion&&!questionAudioPending()&&(readyAnswer.automatic||!candidateSpeaking&&!reader.held))showReadyAnswer();}
function showReadyAnswer(){
  if(!readyAnswer)return;
  const next=readyAnswer;readyAnswer=null;$('showReadyAnswer').hidden=true;
  resetDisplay();raw=next.raw;render();beginCoaching(next.question);flow.set('ready');
  if(next.requestedAt!==undefined){$('latency').textContent=((performance.now()-next.requestedAt)/1000).toFixed(1)+(next.fromSpeech?'s from speech end':'s to text');$('latency').title='Includes time held while you were reading or paused.';}
  $('question').textContent=next.question;$('questionLabel').textContent='QUESTION';
  archiveIndex=answerArchive.length-1;syncArchive();
  if(!localBusy&&connected&&settings.auto&&!paused&&!editingQuestion&&pendingQuestions.length)void localAnswer(pendingQuestions.take());
}
function finishSpeaking(){
  candidateSpeaking=false;clearTimeout(quietTimer);
  quietTimer=setTimeout(()=>{if(connected&&!candidateSpeaking&&!reader.held)maybePresentReady();},250);
}
function rememberQuestion(question){
  lastHeardQuestion=question;$('correctQuestion').hidden=!connected||!question;
  refreshView();
}
function showIncomingQuestion(question){
  rememberQuestion(question);
  if(parseResponse(raw).answer.trim()&&question!==$('question').textContent){
    $('incomingQuestion').textContent=question;$('incomingQuestionLabel').textContent='PREPARING THE NEXT ANSWER';$('incomingQuestionBlock').hidden=false;
    $('questionLabel').textContent='PREVIOUS ANSWER';
  }else{$('incomingQuestionBlock').hidden=true;$('question').textContent=question;$('questionLabel').textContent='QUESTION HEARD';}
  refreshView();
}
function openQuestionEditor(correct=false){
  if(!editingQuestion){editHold={held:reader.held,until:reader.holdUntil};editingQuestion=true;reader.hold();}
  $('typedForm').hidden=false;$('typeButton').setAttribute('aria-expanded','true');
  if(correct)$('typedQuestion').value=lastHeardQuestion;
  $('typedQuestion').focus();
}
function closeQuestionEditor(){
  $('typedForm').hidden=true;$('typeButton').setAttribute('aria-expanded','false');
  if(editingQuestion&&editHold){reader.held=editHold.held;reader.holdUntil=editHold.until;reader.describe();}
  editingQuestion=false;editHold=null;
}
async function advanceFollowup(input){
  queueQuestion(input);
  if(advancingFollowup)return;
  const flight={};advancingFollowup=flight;const mine=generation;
  const cancellation=replaceQuestion(null,{preserveContext:true,preservePending:true}),revision=replacementRevision;
  await cancellation;
  if(mine!==generation||revision!==replacementRevision||advancingFollowup!==flight){if(advancingFollowup===flight)advancingFollowup=false;return;}
  advancingFollowup=false;
  if(!connected||paused||editingQuestion)return;
  const next=pendingQuestions.take();if(next)void localAnswer({...next,showImmediately:true});
}
async function replaceQuestion(input,{preserveContext=false,preservePending=false}={}){
  const revision=++replacementRevision,mine=generation,job=localJob;
  if(!preservePending)pendingQuestions.clear();pendingPCM=null;readyAnswer=null;retryInput=null;
  $('showReadyAnswer').hidden=true;$('retryAnswer').hidden=true;
  if(job){
    if(preserveContext&&!job.contextSaved&&job.question){localHistory.push({question:job.question,answer:job.draft?'UNFINISHED SUGGESTION (not evidence the candidate said it): '+job.draft.slice(0,5800):'WAIT: The draft was interrupted before a suggestion was ready.'});localHistory=localHistory.slice(-6);job.contextSaved=true;}
    job.superseded=true;if(!preserveContext)job.restore();else $('answer').classList.remove('streaming');status('Updating question…','live');flow.set('switch','Stopping the old draft');
    if(!job.cancelling)job.cancelling=(async()=>{
      // Wait for server acceptance so a fast correction cannot overtake the
      // request it is intended to interrupt. Stop still aborts immediately.
      let timer;
      try{
        await Promise.race([job.accepted,new Promise(resolve=>timer=setTimeout(resolve,2000))]);
        if(mine!==generation)return;
        const result=await request('/api/answer/interrupt',{sessionId:localSessionId,requestId:job.id},'POST',AbortSignal.timeout(4000));
        if(!result.interrupted)job.controller.abort();
      }catch{job.controller.abort();}
      finally{clearTimeout(timer);}
      await job.finished;
    })();
    await job.cancelling;
  }
  if(mine!==generation||revision!==replacementRevision||!connected)return;
  notice('');
  if(input){await localAnswer(input);}
  else if(!preservePending){latestSpeechText='';rememberQuestion('');$('incomingQuestionBlock').hidden=true;status(paused?'Paused':'Waiting for the next question','live');flow.set(paused?'paused':'listen');}
}
async function localAnswer(input){
  if(!connected)return;
  if(localBusy){if(input.pcm)pendingPCM=input.pcm;else queueQuestion(input);return;}
  const mine=generation,autoDetect=input.autoDetect??(dualAudio(settings.source)&&settings.auto&&!!input.pcm);
  if(!autoDetect)lastQuestionAt=performance.now();
  localBusy=true;localAbort=new AbortController();const controller=localAbort;
  readyAnswer=null;$('showReadyAnswer').hidden=true;
  let settle,accept;const job={id:`${mine}-${++requestSequence}`,controller,superseded:false,question:input.question||'',draft:'',finished:new Promise(r=>settle=r),accepted:new Promise(r=>accept=r)};localJob=job;
  const previousCoach=coach.snapshot();
  const previous={raw,question:$('question').textContent,label:$('questionLabel').textContent,heardQuestion:lastHeardQuestion,scroll:$('answerFrame').scrollTop,cursor:reader.cursor};
  if(input.question)showIncomingQuestion(input.question);
  startAt=performance.now();status(input.question?'Preparing answer…':'Transcribing…','live');flow.set(input.question?'match':'transcribe',input.question?'Reading your question':'Turning speech into text');firstTextAt=0;syncArchive();
  retryInput=null;$('retryAnswer').hidden=true;
  const bufferedFollowup=!!parseResponse(raw).answer.trim();
  let q=input.question||'',draft='',displayStarted=false,deferred=bufferedFollowup,completed=false,timedOut=false;
  job.restore=()=>{coach.restore(previousCoach,{running:connected&&!paused});lastHeardQuestion=previous.heardQuestion;$('incomingQuestionBlock').hidden=true;$('question').textContent=previous.question;$('questionLabel').textContent=previous.label;refreshView();if(!displayStarted)return;reader.stop();raw=previous.raw;render();$('question').textContent=previous.question;$('questionLabel').textContent=previous.label;$('answerFrame').scrollTop=previous.scroll;reader.cursor=previous.cursor;$('answer').classList.remove('streaming');displayStarted=false;};
  const timeout=setTimeout(()=>{timedOut=true;controller.abort();},30000);
  try{
    const data=scoped({...input,requestId:job.id,autoDetect,profile:effectiveProfile(),style:settings.style,answerModel:settings.answerModel,answerSpeed:settings.answerSpeed,history:localHistory,conversation:conversation.snapshot(input.question)});
    const r=apiProvider()?await cloudApiAnswer(data,controller.signal):settings.provider==='chatgpt'?await chatGPTAnswer(data,controller.signal):settings.provider==='device'?(await localDevice()).answerResponse({...data,knowledge:background},controller.signal):await fetch('/api/answer',{method:'POST',headers:{'Content-Type':'application/json','X-Cue-Client':'1'},body:JSON.stringify(data),signal:controller.signal});
    if(!r.ok)throw new Error((await r.json()).error||'The answer request failed. Retry the question.');
    await consumeAnswer(r,e=>{
      accept();if(job.superseded)return;
      if(mine!==generation||controller.signal.aborted)throw new DOMException('Stopped.','AbortError');
      if(e.type==='context'){flow.set('draft',e.mode==='personal'?'Using relevant personal facts':'Answering from general knowledge');}
      if(e.type==='timing'){$('latency').title=[$('latency').title,`Ready-session wait: ${e.phases.readyWaitMs||0}ms; model connection: ${e.phases.readyMs}ms; first model text: ${e.phases.firstDeltaMs}ms; total generation: ${e.phases.totalMs}ms.`,input.transcriptionMs!==undefined?`Speech recognition: ${Math.round(input.transcriptionMs)}ms.`:''].filter(Boolean).join(' ');}
      if(e.type==='stage'){status(e.text,'live');flow.set(e.step||(/Transcrib/i.test(e.text)?'transcribe':'draft'),e.text);}
      if(e.type==='question'){q=e.text;job.question=q;showIncomingQuestion(q);$('heardLine').textContent='Heard: '+q;$('heardLine').hidden=false;}
      if(e.type==='answer'){
        draft=e.text;job.draft=draft;
        if(turnDecision(draft)==='answer'){
          if(!displayStarted&&!deferred)deferred=paused||editingQuestion||questionAudioPending()||(!input.showImmediately&&!!raw&&(candidateSpeaking||reader.held));
          if(!deferred){
            if(!displayStarted){resetDisplay();beginCoaching(q);displayStarted=true;$('question').textContent=q;$('questionLabel').textContent='QUESTION';notice('');}
            raw=draft;render();$('answer').classList.toggle('streaming',!!e.streaming);
            if(!firstTextAt){firstTextAt=performance.now();$('latency').textContent=((firstTextAt-(input.speechEndedAt??startAt))/1000).toFixed(1)+(input.speechEndedAt!==undefined?'s from speech end':'s to text');$('latency').title=input.speechEndedAt!==undefined?'Includes the end-of-question pause, transcription, queueing and drafting.':'Time from sending the question to the first answer text.';}
          }
          if(e.streaming){status(deferred?'Next answer is being written':'Writing answer','live');flow.set('write',deferred?'Your next answer will wait until you finish':'Text appears as it arrives');}
        }
      }
      if(e.type==='done'&&turnDecision(draft)==='pending')throw new Error('No complete answer arrived. Retry the question.');
      if(e.type==='done')completed=true;
      if(e.type==='empty'){$('heardLine').textContent='No clear speech heard. Try again or type the question.';$('heardLine').hidden=false;}
    });
    if(mine!==generation||job.superseded)return;
    if(completed){
      if(turnDecision(draft)==='answer'){
        answerArchive.push({question:q,raw:draft});archiveIndex-=Math.max(0,answerArchive.length-12);answerArchive=answerArchive.slice(-12);
        if(deferred){readyAnswer={question:q,raw:draft,requestedAt:input.speechEndedAt??startAt,fromSpeech:input.speechEndedAt!==undefined,automatic:!!(input.waitForComplete||input.showImmediately)};$('showReadyAnswer').hidden=false;if(!$('incomingQuestionBlock').hidden)$('incomingQuestionLabel').textContent='NEXT ANSWER READY';maybePresentReady();}
        else{archiveIndex=answerArchive.length-1;syncArchive();}
      }
      localHistory.push({question:q,answer:draft.slice(0,6000)});localHistory=localHistory.slice(-6);
      if(turnDecision(draft)==='wait'){job.restore();$('heardLine').textContent='Heard: '+q+' · No new question';}
    }
    if(mine===generation){status(paused?'Paused':readyAnswer?'Next answer ready':settings.source==='text'?(providerName()+' ready'):('Listening · '+providerName()),'live');flow.set(paused?'paused':readyAnswer?'hold':turnDecision(draft)==='answer'?'ready':'listen',turnDecision(draft)==='wait'?'No new question':$('latency').textContent);}
  }catch(e){
    if(mine===generation&&!job.superseded&&(e.name!=='AbortError'||timedOut)){
      job.restore();
      retryInput={...input,question:q||input.question};$('retryAnswer').hidden=false;
      notice((timedOut?'The answer timed out. Retry when your connection is ready.':e.message)+(previous.raw?' Your previous answer is still here.':''));status('Answer failed','error');flow.set('error',e.message);
    }
  }finally{
    clearTimeout(timeout);
    if(mine===generation&&localJob===job){$('answer').classList.remove('streaming');localBusy=false;localAbort=null;localJob=null;syncArchive();
      if(!job.superseded&&pendingQuestions.length&&settings.auto&&!paused&&!readyAnswer&&!editingQuestion)void localAnswer(pendingQuestions.take());
      else if(!job.superseded&&pendingPCM&&settings.auto&&!paused&&!editingQuestion){const pcm=pendingPCM;pendingPCM=null;void localAnswer({pcm});}
    }
    accept();settle();
  }
}
async function connectLocal(mine){
  if(apiProvider()&&!personalSetup.apiReady(settings.provider)){stop('Connect your AI first');await personalSetup.open('ai');return;}
  if(settings.provider==='chatgpt'&&!personalSetup.accountReady()){stop('Connect ChatGPT first');await personalSetup.open('ai');return;}
  if(settings.provider==='device'&&(!deviceRuntime?.status().answer||deviceRuntime?.status().model!==settings.deviceModel||settings.source!=='text'&&!deviceRuntime?.status().speech)){
    stop('Local AI setup needed');await personalSetup.open('ai');return;
  }
  clearInterval(demoTimer);notice('');status(settings.provider==='device'?'Loading local AI…':'Connecting '+providerName()+'…');flow.set('start',settings.source==='text'?'Connecting your answer model':'Getting audio and your answer model ready');
  try{
    const check=await request('/api/codex/check',{profile:effectiveProfile(),style:settings.style,answerModel:settings.answerModel,answerSpeed:settings.answerSpeed,autoDetect:settings.auto&&settings.source!=='text',audio:settings.source!=='text',dual:dualAudio(settings.source)},'POST',AbortSignal.any([aborter.signal,AbortSignal.timeout(settings.provider==='device'?900000:30000)]));if(mine!==generation)return;localSessionId=check.sessionId;
    if(settings.provider==='codex'&&settings.source!=='text'&&!config.localAudioAvailable)throw new Error('Local speech recognition is unavailable. Select Typed questions only in Settings.');
    if(settings.source!=='text')status(settings.source==='mic'?'Opening the room microphone…':'Choose / allow audio…');
    const acquired=await getAudio(mine);if(mine!==generation){acquired?.getTracks().forEach(t=>t.stop());return;}stream=acquired;
    if(stream){
      for(const track of stream.getTracks())track.onended=()=>{if(mine===generation)stop('Audio ended');};
      audioCtx=capture.context;analyser=audioCtx.createAnalyser();analyser.fftSize=256;
      const source=audioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));source.connect(analyser);
      await audioCtx.audioWorklet.addModule('/pcm-worklet.js');if(mine!==generation)return;
      speechPipeline=new SpeechPipeline({
        parallel:dualAudio(settings.source),
        transcribe:(pcm,signal,item)=>transcribeSpeech(pcm,signal,{lane:transcriptionLane(settings.source,item.source)}),
        onTranscript:item=>{if(mine===generation&&!paused)onSpeechText(item);},
        onIdle:()=>{if(mine===generation)maybePresentReady();},
        onState:item=>{if(mine===generation&&!paused&&(item.source==='system'||item.source==='shared'))flow.set('transcribe',item.queued?'Catching up with the conversation':'Turning speech into text');},
        onError:e=>{if(mine===generation&&!paused){notice(e.message);flow.set('error',e.message);}},
      });
      for(const input of capture.inputs){
        const speechSource=speechSourceFor(settings.source,input.kind);
        const worklet=new AudioWorkletNode(audioCtx,'cue-pcm'),mute=audioCtx.createGain();mute.gain.value=0;
        input.analyser.connect(worklet).connect(mute).connect(audioCtx.destination);processors.push(worklet);
        const part=new QuestionSegmenter((samples,meta)=>{const forced=!!part.forced;part.forced=false;speechPipeline?.push({pcm:pcmBase64(samples),source:speechSource,final:true,forced,...meta,answerRevision:part.readingRevision,coachEpoch:part.coachEpoch,interrupting:part.interrupting,overlappedSystem:!!part.overlappedSystem});},()=>{
          if(input.kind==='system'){for(const mic of segmenters)if((mic.source==='mic'||mic.source==='shared')&&mic.active)mic.overlappedSystem=true;part.interrupting=candidateSpeaking;reader.stop();flow.set('speech',localBusy?'Hearing the next question while the draft finishes':'Computer audio is arriving');if(!localBusy)status('Interviewer speaking','live');}
          else {part.overlappedSystem=segmenters.some(p=>p.source==='system'&&p.active);part.readingRevision=answerRevision;part.coachEpoch=coach.epoch;if(speechSource==='shared'){flow.set('speech','Room microphone is hearing speech');if(!localBusy)status('Hearing the conversation','live');}else{candidateSpeaking=true;clearTimeout(quietTimer);if(!localBusy)status('You’re speaking','live');}}
        },{voiceThreshold:speechSource==='system'?.002:.012,silenceMs:speechSource==='mic'?650:450,quietMs:speechSource==='mic'?250:160,partialMs:900,onQuiet:speechSource!=='mic'?(samples,meta)=>speechPipeline?.push({pcm:pcmBase64(samples),source:speechSource,final:false,endpoint:true,...meta,answerRevision:part.readingRevision,coachEpoch:part.coachEpoch}):null,onEnd:input.kind==='mic'?finishSpeaking:()=>{},onPartial:input.kind==='mic'?(samples,meta)=>{if(raw||interviewerTurn.parts.length)speechPipeline?.push({pcm:pcmBase64(samples),source:speechSource,final:false,...meta,answerRevision:part.readingRevision,coachEpoch:part.coachEpoch,overlappedSystem:!!part.overlappedSystem});}:null});
        part.source=speechSource;segmenters.push(part);worklet.port.onmessage=e=>{if(!paused&&mine===generation)part.push(e.data);};
      }
      await audioCtx.resume();if(mine!==generation)return;audioMeter();
    }
    connected=true;connecting=false;native?.reportPhase?.('listening');reader.describe();flow.set('listen',settings.source==='text'?'Type a question':'Ready for the interviewer');status(settings.source==='text'?(providerName()+' ready'):('Listening · '+providerName()),'live');$('questionLabel').textContent=settings.source==='text'?'ASK A QUESTION':'LISTENING';$('question').textContent=settings.source==='text'?'Type a question below.':dualAudio(settings.source)?'Listening to you and the interviewer…':'Waiting for the interviewer’s question…';notice('');syncControls();
    if(settings.source==='text'){$('typedForm').hidden=false;$('typedQuestion').focus();}
  }catch(e){if(mine===generation){native?.reportPhase?.('start-failed');stop('Could not start');notice(e.name==='NotAllowedError'?'Audio permission was not granted. Choose a source again or use typed questions.':e.message);}}
}
function demo(){if(connected||connecting)return;clearInterval(demoTimer);notice('Demo preview · prewritten example · no audio or API connection');resetDisplay();status('Demo');reader.describe();flow.set('stopped','Example answer · no recording or AI connection');$('questionLabel').textContent='DEMO QUESTION';$('question').textContent=seed.demo.question;const text=settings.style==='cues'?seed.demo.cues:seed.demo.answer;raw='ANSWER:\n'+text;refreshView();const words=text.match(/\S+\s*/g);let i=0;$('answer').classList.add('streaming');demoTimer=setInterval(()=>{if(i>=words.length){clearInterval(demoTimer);$('answer').classList.remove('streaming');return;}$('answer').textContent+=words[i++];},25);}
function syncArchive(){
  $('previousAnswer').disabled=localBusy||archiveIndex<=0;$('latestAnswer').disabled=localBusy;$('latestAnswer').hidden=archiveIndex>=answerArchive.length-1||archiveIndex<0;
  $('historyButton').hidden=!answerArchive.length;
}
function showArchive(index){
  const entry=answerArchive[index];if(!entry||localBusy)return;
  archiveIndex=index;resetReading();raw=entry.raw;render();$('question').textContent=entry.question;$('questionLabel').textContent=index===answerArchive.length-1?'LATEST ANSWER':'PREVIOUS ANSWER';syncArchive();
}
function onSpeechText({text,source,final,forced=false,answerRevision:spokenRevision,speechEndedAt,recognizedAt,transcriptionMs,eager,utteranceId,revision,coachEpoch,interrupting=false,overlappedSystem=false}){
  // Capture overlap alone does not mean echo: the candidate may genuinely
  // interrupt the interviewer. Only a matching computer transcript is echo.
  if(!forced&&turnRoute({text,source,hasAnswer:!!raw,dual:dualAudio(settings.source)})==='ack'){maybePresentReady();return;}
  const shared=source==='shared'||source==='mic'&&sharedMicrophone(settings.source);
  if(dualAudio(settings.source)&&final&&!forced&&!crossSourceEcho.accept(text,shared?'shared':source,speechEndedAt??performance.now(),{overlappedSystem}))return;
  let sharedIntent;
  if(shared){
    sharedIntent=forced?'question':sharedMicIntent(text,{answer:parseResponse(raw).answer,cursor:reader.cursor,turnOpen:interviewerTurn.parts.length>0&&interviewerTurn.replyAt<=interviewerTurn.lastAt});
    if(sharedIntent==='candidate'&&caseSetup(text)&&!interviewerTurn.parts.length)sharedIntent='unknown';
    if(sharedIntent==='ack')return;
    // Only recognised candidate speech may advance reading/coaching. Other
    // partials wait for an endpoint and are not prematurely assigned a speaker.
    if(!final&&sharedIntent!=='candidate'){conversation.record({speaker:sharedIntent==='question'?'interviewer':'unknown',text,source:'shared',at:speechEndedAt??performance.now(),key:utteranceId===undefined?undefined:'shared:'+utteranceId,provisional:true});return;}
    source=sharedIntent==='candidate'?'mic':'system';
    if(sharedIntent==='question'){candidateSpeaking=false;clearTimeout(quietTimer);reader.stop();}
  }
  const uncertainMicPartial=!final&&source==='mic'&&overlappedSystem&&!/^(?:(?:no|sorry|actually)[,.]?\s+)*(?:I(?:\b|['’])|we\b|my\b|our\b|what I\b)/i.test(text.trim());
  if(final||source==='mic')conversation.record({speaker:uncertainMicPartial?'unknown':source==='mic'?'candidate':shared&&sharedIntent==='unknown'?'unknown':'interviewer',text,source:shared?'shared':source,at:speechEndedAt??performance.now(),key:utteranceId===undefined?undefined:(shared?'shared':source)+':'+utteranceId,provisional:!final});
  if(uncertainMicPartial)return;
  if(source==='mic'&&!forced&&!(lastTurn?.source==='system'&&performance.now()-lastTurn.at<12000&&sameUtterance(lastTurn.text,text))){const before=interviewerTurn.replyAt;interviewerTurn.replied(text,{at:speechEndedAt??performance.now()});if(interviewerTurn.replyAt>before){questionJoiner.clear();sharedQuestionJoiner.clear();}}
  if(source==='mic'&&!forced&&(coachEpoch===undefined||coachEpoch===coach.epoch)&&!(lastTurn?.source==='system'&&performance.now()-lastTurn.at<12000&&sameUtterance(lastTurn.text,text)))coach.hear({text,final,utteranceId,revision});
  if(final)latestSpeechText=text;
  const reading=!forced&&(spokenRevision===undefined||spokenRevision===answerRevision)&&source==='mic'&&raw&&(shared||settings.source==='both'||!explicitQuestion(text))?reader.hear(text):null;
  if(reading){
    $('heardLine').textContent='You: '+text;$('heardLine').hidden=false;
    if(final){localHistory.push({question:text,answer:'WAIT: Candidate response; context only, not a verified new fact.'});localHistory=localHistory.slice(-6);}
    if(final&&!localBusy)status(('Listening · '+providerName()),'live');
    return;
  }
  if(!final)return;
  // A room transcript may arrive before loopback. Record the authoritative
  // system speech above, but do not execute the same correction twice.
  if(!forced&&source==='system'&&lastTurn?.source==='system'&&performance.now()-lastTurn.at<8000&&sameUtterance(lastTurn.text,text))return;
  if(source==='system'&&!forced){if(questionReplacement(text,source)){questionJoiner.clear();sharedQuestionJoiner.clear();}const joiner=settings.source==='hybrid'&&shared?sharedQuestionJoiner:questionJoiner;const joined=joiner.accept(text,{speechEndedAt});if(joined.waiting){$('heardLine').textContent=(shared?'Room: ':'Computer: ')+text;$('heardLine').hidden=false;flow.set('listen','Waiting for the rest of the question');return;}text=joined.question;speechEndedAt=joined.speechEndedAt;}
  const now=performance.now();
  if(!forced&&lastTurn&&lastTurn.source==='system'&&source==='mic'&&now-lastTurn.at<12000&&sameUtterance(lastTurn.text,text))return;
  lastTurn={text,source,at:now};const heardLabel=shared?(sharedIntent==='candidate'?'Answer: ':'Room: '):(source==='mic'?'You: ':'Computer: ');$('heardLine').textContent=heardLabel+text;$('heardLine').hidden=false;
  const route=sharedIntent==='candidate'&&!forced?'context':turnRoute({text,source,hasAnswer:!!raw,forced,dual:dualAudio(settings.source)});
  if(route!=='answer'){if(route==='context'){localHistory.push({question:text,answer:'WAIT: Candidate response; context only, not a verified new fact.'});localHistory=localHistory.slice(-6);}$('heardLine').textContent=heardLabel+text+' · Keeping your answer';if(!localBusy)status(('Listening · '+providerName()),'live');return;}
  rememberQuestion(text);
  const replacement=!forced?questionReplacement(text,source):null;
  if(replacement&&settings.auto&&!editingQuestion){interviewerTurn.clear();if(replacement.question)interviewerTurn.accept(replacement.question);if(candidateSpeaking&&raw)bookmarkAnswer();void replaceQuestion(replacement.question?{question:replacement.question,autoDetect:false,showImmediately:true,inputSource:source,speechEndedAt}:null);return;}
  let bundle;
  if(settings.auto&&source==='system'&&!forced&&sharedIntent!=='unknown'&&(!raw||interviewerRequest(text))){try{bundle=interviewerTurn.accept(text,{at:speechEndedAt??now});}catch(e){notice(e.message);return;}if(!bundle)return;text=bundle.question;latestSpeechText=text;rememberQuestion(text);}
  const next={question:text,autoDetect:forced||bundle?.confirmed?false:settings.auto,inputSource:shared?'shared':source,speechEndedAt,recognizedAt,transcriptionMs,eager,waitForComplete:!forced&&!!raw,...(bundle?{batchId:bundle.batchId,showImmediately:true}:{}),...(shared?{showImmediately:true}:{})};
  if(settings.auto&&!editingQuestion&&source==='system'&&(bundle||explicitQuestion(text))){
    if((candidateSpeaking||interrupting)&&raw)bookmarkAnswer();
    if(localBusy||advancingFollowup){void advanceFollowup(next);return;}
    if((candidateSpeaking||interrupting)&&raw){void replaceQuestion({...next,showImmediately:true},{preserveContext:true});return;}
  }
  if(!settings.auto&&!forced){queueQuestion(next);status('Question ready','live');return;}
  if(localBusy||editingQuestion){queueQuestion(next);return;}
  void localAnswer(next);
}

$('startButton').onclick=()=>connect().catch(e=>notice(e.message));
$('settingsButton').onclick=openSettings;$('audioSettingsButton').onclick=()=>{void openSettings();$('audioSource').focus();};$('displayButton').onclick=()=>{scrollHelp();$('displayDialog').showModal();};$('closeDisplay').onclick=()=>$('displayDialog').close();$('historyButton').onclick=openHistory;$('closeHistory').onclick=()=>$('historyDialog').close();$('homeBackground').onclick=()=>{if(!settings.profile.trim()&&!background?.records?.length){void personalSetup.open('context');}else $('backgroundDialog').showModal();};$('closeSettings').onclick=()=>$('settings').close();
$('demoButton').onclick=demo;
$('saveKey').onclick=async()=>{const key=$('apiKey').value.trim();$('keyMessage').textContent='';try{await request('/api/key',{key});$('apiKey').value='';await refreshConfig();$('keyMessage').textContent='Key saved for this app session. Access is checked when you press Start.';notice('');}catch(e){$('keyMessage').textContent=e.message;}};
$('forgetKey').onclick=async()=>{if(connected||connecting)stop();await request('/api/key',undefined,'DELETE');await refreshConfig();$('keyMessage').textContent='Session key cleared.';};
$('provider').onchange=providerUI;$('answerModel').onchange=providerUI;$('answerSpeed').onchange=providerUI;
$('audioSource').onchange=audioSourceUI;
$('quickAudio').onchange=()=>{if(connected||connecting){$('quickAudio').value=sourceBeforeText??settings.source;return;}settings.source=$('quickAudio').value;write('source',settings.source);$('audioSource').value=settings.source;audioSourceUI();syncControls();reader.describe();};
$('settingsForm').onsubmit=async e=>{e.preventDefault();if($('profile').value.trim().length>40000){$('factsDetails').open=true;$('profile').focus();$('saveMessage').textContent='Keep your context under 40,000 characters.';return;}const answerModel=$('answerModel').value,answerSpeed=$('answerSpeed').value;try{answerOptions({answerModel,answerSpeed});}catch(error){$('saveMessage').textContent=error.message;return;}const source=$('audioSource').value,provider=$('provider').value,microphone=$('microphoneDevice').value,echoCancellation=$('echoCancellation').checked;if((answerModel!==settings.answerModel||answerSpeed!==settings.answerSpeed||source!==settings.source||provider!==settings.provider||microphone!==settings.microphone||echoCancellation!==settings.echoCancellation||$('deviceModel').value!==settings.deviceModel||$('profile').value!==settings.profile||$('style').value!==settings.style)&&(connected||connecting))stop('Settings changed');settings.answerModel=answerModel;settings.answerSpeed=answerSpeed;settings.deviceModel=$('deviceModel').value;settings.provider=provider;settings.source=source;settings.microphone=microphone;settings.echoCancellation=echoCancellation;settings.style=$('style').value;settings.auto=$('autoAnswer').checked;settings.profile=$('profile').value;for(const [k,v] of Object.entries(settings))if(k!=='profile')write(k,v);saveProfile();try{await updateInstructions();$('settings').close();if(background)applyBackground(background);syncControls();reader.describe();}catch(e){$('saveMessage').textContent=e.message;}};
$('pauseButton').onclick=()=>{paused=!paused;capture?.setPaused(paused);if(paused){interviewerTurn.clear();questionJoiner.clear();sharedQuestionJoiner.clear();crossSourceEcho.clear();coach.stop();if(usesText()){segmenter?.reset();for(const part of segmenters)part.reset();speechPipeline?.clear();pendingQuestions.clear();pendingPCM=null;candidateSpeaking=false;clearTimeout(quietTimer);reader.stop();}else send({type:'input_audio_buffer.clear'});}else {if(coach.question)coach.restore(coach.snapshot());reader.describe();if(readyAnswer&&!editingQuestion)showReadyAnswer();if(analyser){cancelAnimationFrame(meterFrame);audioMeter();}if(usesText()&&pendingPCM&&settings.auto&&!localBusy){const pcm=pendingPCM;pendingPCM=null;void localAnswer({pcm});}}status(paused?'Paused':localBusy?'Writing answer':'Listening',paused?'':'live');flow.set(paused?'paused':localBusy?'draft':'listen');syncControls();};
$('retryAnswer').onclick=()=>{if(retryInput&&!localBusy)void localAnswer(retryInput);};
$('showReadyAnswer').onclick=showReadyAnswer;
$('answerButton').onclick=()=>{try{generate();}catch(e){notice(e.message);}};
$('typedForm').onsubmit=async e=>{e.preventDefault();const text=$('typedQuestion').value.trim();if(!text)return;if(!connected){if(connecting)return;await startTextSession();if(!connected)return;}if(usesText()){conversation.record({speaker:'interviewer',text});closeQuestionEditor();interviewerTurn.clear();$('typedQuestion').value='';void replaceQuestion({question:text,autoDetect:false,showImmediately:true});return;}try{closeQuestionEditor();lastFinished=0;cancelAnswer();send({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text}]}});generate();$('typedQuestion').value='';$('question').textContent=text;}catch(e){notice(e.message);}};
$('sampleButton').onclick=async()=>{
  stop();sourceBeforeText=settings.source;settings.answerModel=$('answerModel').value;settings.answerSpeed=$('answerSpeed').value;settings.provider=['device','chatgpt','openai','anthropic'].includes($('provider').value)?$('provider').value:'codex';settings.source='text';settings.profile=$('profile').value;settings.style=$('style').value;$('provider').value=settings.provider;$('settings').close();
  try{await connect();if(!connected)return;const sampleGeneration=generation,signal=aborter.signal;notice('Sample voice test · preparing transcription · microphone and system capture stay off');if(settings.provider==='device')await prepareDevice(signal,true);else if(['chatgpt','openai','anthropic'].includes(settings.provider))await(await localDevice()).prepareSpeech(signal);if(signal.aborted||sampleGeneration!==generation)return;notice('Recorded sample test · real transcription and AI answer · microphone and system capture are not being tested');const ctx=new AudioContext({sampleRate:16000});try{const response=await fetch('/sample-question.wav',{signal});if(!response.ok)throw new Error('The sample recording could not load. Try a typed question or reinstall Cue.');const audio=await ctx.decodeAudioData(await response.arrayBuffer());if(sampleGeneration===generation)await localAnswer({pcm:pcmBase64(audio.getChannelData(0))});}finally{await ctx.close();}}catch(e){if(e.name!=='AbortError')notice(e.message);}
};
$('typeButton').onclick=()=>{if($('typedForm').hidden)openQuestionEditor();else closeQuestionEditor();};
$('correctQuestion').onclick=()=>openQuestionEditor(true);
$('correctIncomingQuestion').onclick=()=>openQuestionEditor(true);
$('cancelQuestionEdit').onclick=()=>{closeQuestionEditor();if(readyAnswer&&!paused)showReadyAnswer();if(!localBusy&&connected&&settings.auto&&!paused&&pendingQuestions.length)void localAnswer(pendingQuestions.take());};
$('fontSize').oninput=()=>{$('fontValue').textContent=$('fontSize').value;document.documentElement.style.setProperty('--font',$('fontSize').value+'px');write('font',Number($('fontSize').value));};
$('glass').oninput=()=>{$('glassValue').textContent=$('glass').value+'%';document.documentElement.style.setProperty('--glass',String(Number($('glass').value)/100));write('glass',Number($('glass').value));};
function scrollHelp(){
  const mode=$('scrollMode').value;
  $('scrollHelp').textContent=mode==='steady'?'Moves automatically once the answer fills the window. No need to read the exact words aloud.':mode==='voice'?(reader.getHint()||'Follows matching words from your microphone. Use Auto-scroll when speaking from cues.'):'Use your trackpad or keyboard to move the answer.';
  $('scrollPace').hidden=mode!=='steady';
}
$('scrollMode').value=read('scrollMode','steady');
$('scrollMode').onchange=()=>{write('scrollMode',$('scrollMode').value);reader.held=false;reader.describe();scrollHelp();};
$('scrollSpeed').value=read('scrollSpeed',18);
$('scrollSpeed').oninput=()=>{const speed=Number($('scrollSpeed').value);write('scrollSpeed',speed);$('scrollSpeedValue').textContent=speed<14?'Gentle':speed>24?'Brisk':'Comfortable';};
$('scrollSpeed').oninput();
$('previousAnswer').onclick=()=>showArchive(archiveIndex-1);$('latestAnswer').onclick=()=>showArchive(answerArchive.length-1);

$('pinButton').onclick=()=>{pinned=!pinned;native?.setPinned(pinned);$('pinButton').setAttribute('aria-pressed',String(pinned));$('pinButton').title=pinned?'Always on top':'Not pinned';};
$('closeButton').onclick=()=>{studio?.close();stop();native?.close();};
$('captureProtection').onchange=async()=>{if(native){$('captureProtection').checked=await native.protectCapture($('captureProtection').checked);write('captureProtection',$('captureProtection').checked);}};
$('shareButton').onclick=async()=>{if(!native||shareStarting)return;shareStarting=true;$('shareButton').disabled=true;try{renderShareState(shareState.state==='stopped'?await native.startShareView():await native.stopShareView());}catch{notice('Share View could not start. Reopen Cue and try again.');}finally{shareStarting=false;$('shareButton').disabled=false;}};
$('meetingPlatform').onchange=platformHelp;
native?.onShareState(renderShareState);
async function startFromShortcut(){
  native?.reportPhase?.("shortcut-received");
  if(connecting)return;
  if(connected&&settings.source!=='text'){if(paused)$('pauseButton').click();return;}
  if(connected)stop();
  if(settings.source==='text'){settings.source=sourceBeforeText&&sourceBeforeText!=='text'?sourceBeforeText:'both';sourceBeforeText=null;write('source',settings.source);$('audioSource').value=settings.source;audioSourceUI();syncControls();}
  await connect();
}
native?.onAction(action=>{if(action==='start-listening'){void startFromShortcut().catch(e=>notice(e.message));return;}if(action==='system-interrupted'){studio?.close();stop('Session interrupted');notice('Your Mac locked or went to sleep. Press Start to reconnect the audio.');}if(action==='pause'&&connected&&settings.source!=='text')$('pauseButton').click();if(action==='answer'&&connected)$('answerButton').click();});
window.addEventListener('beforeunload',()=>{deviceRuntime?.dispose();studio?.close();coach?.cancel();capture?.stop();stream?.getTracks().forEach(t=>t.stop());pc?.close();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('settings').open&&!$('storiesDialog').open&&!$('practiceDialog').open&&!$('displayDialog').open&&!$('historyDialog').open){if(!$('typedForm').hidden){$('cancelQuestionEdit').onclick();}else reader.hold(5000);}if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&!$('settings').open&&!$('storiesDialog').open&&!$('practiceDialog').open&&!$('displayDialog').open&&!$('historyDialog').open){e.preventDefault();if(connected)generate();}});
async function coachRequest(mode,data,signal){const scopedInput=scoped(data);for(let n=0;n<3;n++){try{return await request('/api/coach/'+mode,scopedInput,'POST',signal);}catch(e){if(e.status!==429||n===2)throw e;await new Promise(resolve=>setTimeout(resolve,300*(n+1)));signal?.throwIfAborted();}}}

$('interviewPicker').onchange=()=>selectInterview($('interviewPicker').value);
$('addInterview').onclick=()=>{if(connected||connecting||interviewLoading)return;$('interviewCreateMessage').textContent='';$('newInterviewName').value='';$('newInterviewContext').value='';$('interviewDialog').showModal();};
$('closeInterview').onclick=()=>$('interviewDialog').close();
$('interviewForm').onsubmit=async e=>{
  e.preventDefault();if(connected||connecting||interviewLoading)return;
  $('createInterview').disabled=true;
  try{const result=await request('/api/interviews',{name:$('newInterviewName').value,context:$('newInterviewContext').value});interviewCatalog=result;renderInterviewChoices();await selectInterview(result.id);$('interviewDialog').close();}
  catch(e){$('interviewCreateMessage').textContent=e.message;}finally{$('createInterview').disabled=false;}
};
$('backgroundButton').onclick=()=>{$('backgroundDialog').showModal();};
$('closeBackground').onclick=()=>$('backgroundDialog').close();
$('backgroundSearch').oninput=()=>{if(background)renderBackground($,background,$('backgroundSearch').value);};
$('knowledgeActions').hidden=!native?.openKnowledge;
$('knowledgeMessage').textContent=native?.openKnowledge?'Saved on this Mac, outside the app. Your knowledge survives Cue updates.':'';
for(const [id,kind] of [['openKnowledge','folder'],['openMockContext','mock']])$(id).onclick=async()=>{try{await native.openKnowledge(kind,interviewId||undefined);}catch{$('knowledgeMessage').textContent='Could not open the saved files. Reopen Cue and try again.';}};
$('reloadKnowledge').onclick=async()=>{
  if(connected||connecting){$('knowledgeMessage').textContent='Stop listening before reloading saved knowledge.';return;}
  try{const result=await native.reloadKnowledge();if(interviewId)await selectInterview(interviewId);else await loadBackground();$('knowledgeMessage').textContent=result?.warning||'Saved knowledge reloaded. Model and speed settings are unchanged.';}
  catch{$('knowledgeMessage').textContent='Saved knowledge could not be reloaded. Your current background is still available.';}
};
studio=new StoryStudio({$,read,transcribe:transcribeSpeech,request:coachRequest,getProfile:()=>coachingProfile(),getSettings:()=>settings,stopInterview:()=>{if(connected||connecting)stop();},onChange:()=>{if(connected||connecting)stop('Story library changed');}});
coach=new LiveCoach({request:coachRequest,getFacts:()=>({profile:coachingProfile(),stories:studio.stories.filter(s=>s.status==='confirmed')}),render:state=>renderCoach($,state)});
// Migrate the old always-on coach once. It stays available as an opt-in setting.
if(!read('quietLayoutV1',false)){write('coachEnabled',false);write('quietLayoutV1',true);}
coach.enabled=read('coachEnabled',false);$('coachEnabled').checked=coach.enabled;
$('coachEnabled').onchange=()=>{coach.toggle($('coachEnabled').checked);write('coachEnabled',coach.enabled);if(coach.enabled&&connected&&lastHeardQuestion)coach.begin(lastHeardQuestion);};
$('returnAnswer').onclick=()=>void returnToAnswer();
async function cloudApiAnswer(data,signal){
  await localDevice();let question=data.question;if(!question)question=await deviceRuntime.transcribe(data.pcm,signal);
  const provider=settings.provider,model=read('apiModel:'+provider,'');
  if(!model)throw new Error('Choose your answer model in Your AI.');
  const messages=deviceModule.answerMessages({...data,question,knowledge:background}).map(m=>({...m,content:m.content.replace(/\n\/(?:no_)?think$/,'')}));
  return apiResponse(native,{question,provider,model,messages,autoDetect:data.autoDetect},signal);
}
async function chatGPTAnswer(data,signal){
  await localDevice();let question=data.question;if(!question)question=await deviceRuntime.transcribe(data.pcm,signal);
  const model=read('chatGPTModel','');if(!model)throw new Error('Choose your ChatGPT model in Your AI.');
  return accountResponse(native,{question,model,messages:deviceModule.answerMessages({...data,question,knowledge:background}),autoDetect:data.autoDetect},signal);
}
personalSetup=setupUI({$,native,read,write,getSettings:()=>settings,localStatus:()=>deviceRuntime?.status(),stopListening:()=>{if(connected||connecting)stop('Setup opened');cancelWarmup();},
  saveContext:text=>{settings.profile=text;saveProfile();if(background)applyBackground(background);syncControls();},
  chooseProvider:provider=>{cancelWarmup();if(connected||connecting)stop();notice('');settings.provider=provider;write('provider',provider);$('provider').value=provider;providerUI();syncControls();},
  prepareLocal:async(model,signal)=>{settings.deviceModel=model;$('deviceModel').value=model;write('deviceModel',model);await prepareDevice(signal,true);},
  prepareSpeech:async signal=>{await(await localDevice()).prepareSpeech(signal);},
  tryQuestion:async question=>{sourceBeforeText=settings.source;settings.source='text';await connect();if(connected)await localAnswer({question});},
  trySample:()=>$('sampleButton').onclick(),
  chooseSource:source=>{if(!['both','hybrid','mic','system','text'].includes(source))return;settings.source=source;write('source',source);$('audioSource').value=source;audioSourceUI();syncControls();reader.describe();},
});
$('settingsContext').onclick=()=>{$('settings').close();void personalSetup.open('context');};
$('settingsAI').onclick=()=>{$('settings').close();void personalSetup.open('ai');};
async function init(){seed=await(await fetch('/seed.json')).json();if(localStorage.getItem('cue.provider')===null&&seed.defaultProvider)settings.provider=seed.defaultProvider;if(localStorage.getItem('cue.deviceModel')===null&&seed.defaultDeviceModel)settings.deviceModel=seed.defaultDeviceModel;settings.profile=read('profile',seed.profile);const reconciled=reconcileProfile(settings.profile);if(reconciled!==settings.profile){if(!read('profileBeforeBackgroundImport',null))write('profileBeforeBackgroundImport',settings.profile);settings.profile=reconciled;write('profile',reconciled);}const usingWorkspace=await loadInterviews();backgroundLoad=usingWorkspace?Promise.resolve():loadBackground();$('profile').value=settings.profile;$('style').value=settings.style;$('provider').value=settings.provider;$('deviceModel').value=settings.deviceModel;for(const m of ANSWER_MODELS)$('answerModel').add(new Option(m.label,m.id));$('answerModel').value=settings.answerModel;$('answerSpeed').value=settings.answerSpeed;$('audioSource').value=settings.source;$('autoAnswer').checked=settings.auto;$('echoCancellation').checked=settings.echoCancellation;$('fontSize').value=read('font',31);$('glass').value=read('glass',76);$('fontSize').oninput();$('glass').oninput();audioSourceUI();if(native){await native.protectCapture(read('captureProtection',true));const state=await native.status();$('shareButton').hidden=state.platform!=='darwin';renderShareState(state.shareView);}try{const registry=await(await fetch('/platforms.json')).json();platforms=registry.platforms;for(const p of platforms){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;$('meetingPlatform').append(option);}$('meetingPlatform').value=read('platform','unknown');platformHelp();}catch{$('platformHelp').textContent='Platform guidance could not load. Verify your sharing setup before use.';}await refreshConfig();await backgroundLoad;providerUI();syncControls();syncArchive();reader.describe();flow.set('idle','Start once. Questions are handled automatically.');}
init().then(async()=>{try{if(settings.provider==='chatgpt')await personalSetup.refreshAccount();else if(apiProvider())await personalSetup.refreshApi();}catch(e){notice(e.message);}native?.ready?.();if(seed.firstRunSetup&&!read('setupComplete',false))void personalSetup.open(read('setupStep','context'));else if(settings.provider==='chatgpt')void personalSetup.refreshAccount().catch(()=>{});if(settings.provider==='device'&&read('devicePrepared',false)&&!$('setupDialog').open){const controller=new AbortController();warmAbort=controller;const message='Loading your saved local AI…';notice(message);void prepareDevice(controller.signal).then(()=>{if(!controller.signal.aborted&&$('notice').textContent===message)notice('Local AI ready. Recording is off.');}).catch(e=>{if(!controller.signal.aborted){$('deviceProgress').textContent=e.message;notice('Local AI needs attention. Open Your AI to retry or choose a smaller model.');}}).finally(()=>{if(warmAbort===controller)warmAbort=null;personalSetup.home();});}}).catch(()=>{notice('Setup could not load. Close and reopen Cue.');flow.set('error','Setup could not load');});

let setupAbort;
$('prepareDevice').onclick=async()=>{
  if(connected||connecting)stop();settings.deviceModel=$('deviceModel').value;write('deviceModel',settings.deviceModel);
  setupAbort?.abort();setupAbort=new AbortController();$('prepareDevice').disabled=true;$('cancelDevice').hidden=false;$('deviceProgress').textContent='Preparing the local models…';
  try{await prepareDevice(setupAbort.signal,true);$('deviceProgress').textContent='Ready. Choose Save & close, then Start. Cached models load automatically next time.';}
  catch(e){$('deviceProgress').textContent=e.name==='AbortError'?'Setup cancelled. Cached files can be reused.':e.message;}
  finally{$('prepareDevice').disabled=false;$('cancelDevice').hidden=true;setupAbort=null;}
};
$('cancelDevice').onclick=()=>setupAbort?.abort();
$('importContext').onchange=async e=>{
  const files=[...e.target.files];e.target.value='';$('contextImportStatus').textContent='Reading files on this Mac…';$('importContext').disabled=true;
  try{await localDevice();let draft=$('profile').value;
    for(const file of files){const doc=await deviceModule.readDocument(file);draft+='\n\n'+doc.title+'\n'+doc.text;if(draft.length>40000)throw new Error('These files exceed 40,000 characters. Add shorter notes or remove older context first.');}
    $('profile').value=draft.trim();$('contextImportStatus').textContent='Imported locally. Review the text below, then Save & choose AI.';
  }catch(e){$('contextImportStatus').textContent=e.message;}finally{$('importContext').disabled=false;}
};
$('editContext').onclick=()=>{$('backgroundDialog').close();void personalSetup.open('context');};
$('exportContext').onclick=()=>{const blob=new Blob([$('profile').value],{type:'text/plain'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='My Cue Context.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

preferencesUI({$, getValues:()=>({font:Number($('fontSize').value),glass:Number($('glass').value),scrollMode:$('scrollMode').value,scrollSpeed:Number($('scrollSpeed').value),style:settings.style,auto:settings.auto}),apply:value=>{
  if(connected||connecting)stop('Preferences changed');
  settings.style=value.style;settings.auto=value.auto;write('style',value.style);write('auto',value.auto);$('style').value=value.style;$('autoAnswer').checked=value.auto;
  for(const [id,key] of [['fontSize','font'],['glass','glass'],['scrollSpeed','scrollSpeed']]){$(id).value=value[key];$(id).oninput();}
  $('scrollMode').value=value.scrollMode;$('scrollMode').onchange();syncControls();
}});
