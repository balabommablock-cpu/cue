import {unwrap} from './account-ui.js';
const apiProvider=p=>p==='openai'||p==='anthropic';
const label=p=>p==='anthropic'?'Claude':'OpenAI';
const validModel=s=>/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(s);
export function apiSetupUI({$,native,read,write,getProvider,chooseProvider,page,say,render}){
  let state={providers:{}},working=false,last='',revision=0;
  const modelCache={};
  const cancelConnect=p=>{void Promise.resolve(native?.apiCancelConnect?.(p)).catch(()=>{});};
  function fillModels(provider,values){
    modelCache[provider]=values;
    if(getProvider()!==provider)return;
    $('apiModelOptions').replaceChildren();
    for(const model of values)$('apiModelOptions').append(new Option(model.name,model.id));
    if(!$('apiModel').value){$('apiModel').value=read('apiModel:'+provider,'')||values[0]?.id||'';}
  }
  function view(){
    const provider=getProvider(),active=apiProvider(provider);$('setupAPI').hidden=!active;
    if(!active)return;
    const connected=!!state.providers[provider]?.connected;
    $('apiProviderTitle').textContent=label(provider)+' API';
    $('apiKeyLabel').textContent=label(provider)+' API key';
    $('apiKeyStatus').textContent=connected?'Key connected · encrypted on this Mac':'Connect your own API key to get started.';
    $('providerApiKey').placeholder=connected?'Paste a new key to replace it':'Paste your API key';
    $('apiWorkspaceWrap').hidden=provider!=='anthropic';
    $('saveApiKey').textContent=working?'Checking connection…':connected?'Replace key & refresh models':'Connect & load models';
    $('saveApiKey').disabled=working||!$('providerApiKey').value.trim();
    $('apiModelWrap').hidden=!connected;
    $('refreshApiModels').disabled=working;
    $('removeApiKey').disabled=working;
    $('useApi').textContent='Use '+label(provider)+' →';
    $('useApi').disabled=working||!connected||!validModel($('apiModel').value.trim());
  }
  async function refresh(){
    if(!native?.apiStatus)return;
    state=unwrap(await native.apiStatus());view();
  }
  async function loadModels(provider){
    if(!native?.apiModels||!state.providers[provider]?.connected)return;
    const token=revision;working=true;render();say('Loading models available to your '+label(provider)+' key…');
    try{
      const values=unwrap(await native.apiModels(provider));
      if(token===revision&&getProvider()===provider){fillModels(provider,values);say(values.length?'Choose a text model, or enter an exact model ID.':'No text models were listed. Enter the exact model ID your key can use.');}
    }catch(e){if(token===revision)say(e.message+' You can still enter a known model ID.');}
    finally{if(token===revision){working=false;render();}}
  }
  function select(provider){
    revision++;working=false;$('providerApiKey').value='';
    if(apiProvider(last))cancelConnect(last);
    last=provider;
    if(!apiProvider(provider)){view();return;}
    $('apiWorkspace').value=state.providers[provider]?.workspace||'';
    $('apiModel').value=read('apiModel:'+provider,'');
    fillModels(provider,modelCache[provider]||[]);view();
  }
  $('providerApiKey').oninput=view;
  $('apiModel').oninput=view;
  $('getApiKey').onclick=()=>void native?.apiConsole?.(getProvider());
  $('saveApiKey').onclick=async()=>{
    const provider=getProvider();if(!apiProvider(provider)||working)return;
    if(!native?.apiConnect){say('Open the installed Cue app to connect an API key securely.');return;}
    const key=$('providerApiKey').value,workspace=$('apiWorkspace').value.trim(),token=revision;
    $('providerApiKey').value='';working=true;render();say('Checking your key and loading available models…');
    try{
      const result=unwrap(await native.apiConnect({provider,key,...(provider==='anthropic'?{workspace}:{})}));
      await refresh();
      if(token===revision&&getProvider()===provider){fillModels(provider,result.models);say(result.warning||'Connected. Choose the model you want to use.');}
    }catch(e){if(token===revision)say(e.message);}
    finally{if(token===revision){working=false;render();}}
  };
  $('refreshApiModels').onclick=()=>void loadModels(getProvider());
  $('removeApiKey').onclick=async()=>{
    const provider=getProvider();working=true;render();
    try{unwrap(await native.apiDisconnect(provider));delete modelCache[provider];await refresh();say('API key removed from this Mac. Your context is still saved.');}
    catch(e){say(e.message);}finally{working=false;render();}
  };
  $('useApi').onclick=()=>{
    const provider=getProvider(),model=$('apiModel').value.trim();
    if(!state.providers[provider]?.connected||!validModel(model)){say('Connect your key and choose a text model first.');return;}
    write('apiModel:'+provider,model);chooseProvider(provider);page('test');
    say('Using '+label(provider)+' · '+model+'. English listening downloads on first use; typed questions need no speech download.');
  };
  return {render:view,select,refresh,loadModels,close(){revision++;working=false;$('providerApiKey').value='';if(apiProvider(last))cancelConnect(last);},busy:()=>working,ready:p=>!!state.providers[p]?.connected,
    async readyModel(provider){await refresh();if(!state.providers[provider]?.connected)throw new Error('Open Your AI and connect your '+label(provider)+' API key.');const model=read('apiModel:'+provider,'');if(!validModel(model))throw new Error('Choose a text model in Your AI.');return model;}};
}
