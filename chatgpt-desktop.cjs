const {join}=require('node:path');
const os=require('node:os');
function installChatGPT({app,win,ipcMain,safeStorage,shell,origin}){
  let connection,loading;const inflight=new Map();
  const send=(channel,value)=>{if(!win.isDestroyed())win.webContents.send(channel,value);};
  async function client(){
    if(!loading)loading=import('./chatgpt-auth.bundle.mjs').then(async({createChatGPTConnection})=>{
      connection=await createChatGPTConnection({directory:join(app.getPath('userData'),'chatgpt'),encryption:{isAvailable:()=>safeStorage.isEncryptionAvailable(),encrypt:s=>safeStorage.encryptString(s),decrypt:b=>safeStorage.decryptString(Buffer.from(b))},openBrowser:async url=>{if(new URL(url).origin!=='https://auth.openai.com')throw new Error('Invalid sign-in destination');await shell.openExternal(url);},onState:state=>send('cue:account-state',state)});return connection;
    }).catch(e=>{loading=null;throw e;});return loading;
  }
  const permitted=e=>!win.isDestroyed()&&e.sender===win.webContents&&e.senderFrame===win.webContents.mainFrame&&new URL(e.senderFrame.url).origin===origin;
  const handle=(name,fn)=>ipcMain.handle('cue:'+name,async(e,...args)=>{
    if(!permitted(e))return {ok:false,error:{code:'untrusted',message:'Open Cue to continue.'}};
    try{return {ok:true,value:await fn(...args)};}catch(e){const {publicError}=await import('./chatgpt-auth.bundle.mjs');return {ok:false,error:publicError(e)};}
  });
  handle('device-info',()=>({platform:process.platform,arch:process.arch,memoryGB:Math.round(os.totalmem()/1024**3),recommendedModel:os.totalmem()>=24*1024**3?'strong':os.totalmem()>=16*1024**3?'balanced':'light'}));
  handle('account-status',async()=> (await client()).status());
  handle('account-signin',async options=>(await client()).signIn({newAccount:options?.newAccount===true,reconsent:options?.reconsent===true}));
  handle('account-cancel',async()=>{connection?.cancelSignIn();return true;});
  handle('account-models',async()=>(await client()).models());
  handle('account-select',async id=>(await client()).select(String(id)));
  handle('account-disconnect',async()=> (await client()).disconnect());
  handle('account-usage',async()=>{await shell.openExternal('https://chatgpt.com/settings/usage');return true;});
  handle('account-answer',async data=>{
    if(typeof data?.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(data.id))throw new Error('Invalid request');
    for(const c of inflight.values())c.abort();
    const c=new AbortController();inflight.set(data.id,c);
    try{const text=await(await client()).answer(data,text=>send('cue:account-answer-event',{id:data.id,type:'delta',text}),c.signal);return {text};}
    finally{if(inflight.get(data.id)===c)inflight.delete(data.id);}
  });
  handle('account-interrupt',async id=>{if(id)inflight.get(String(id))?.abort();else for(const c of inflight.values())c.abort();return true;});
  return {close(){for(const c of inflight.values())c.abort();connection?.close();}};
}
module.exports={installChatGPT};
