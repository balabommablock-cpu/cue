const {join}=require('node:path');
function installApiProviders({app,win,ipcMain,safeStorage,shell,origin}){
  let connection,loading;const inflight=new Map();
  const client=()=>{
    loading??=import('./api-providers.mjs').then(({createApiConnections})=>createApiConnections({
      directory:join(app.getPath('userData'),'api'),
      encryption:{isAvailable:()=>safeStorage.isEncryptionAvailable(),encrypt:s=>safeStorage.encryptString(s),decrypt:b=>safeStorage.decryptString(Buffer.from(b))},
    })).then(c=>(connection=c)).catch(e=>{loading=null;throw e;});
    return loading;
  };
  const permitted=e=>{try{return !win.isDestroyed()&&e.sender===win.webContents&&e.senderFrame===win.webContents.mainFrame&&new URL(e.senderFrame.url).origin===origin;}catch{return false;}};
  const handle=(name,fn)=>ipcMain.handle('cue:api-'+name,async(e,...args)=>{
    if(!permitted(e))return {ok:false,error:{code:'untrusted',message:'Open Cue to continue.'}};
    try{return {ok:true,value:await fn(...args)};}catch(e){const {publicApiError}=await import('./api-providers.mjs');return {ok:false,error:publicApiError(e)};}
  });
  handle('console',async provider=>{
    const urls={openai:'https://platform.openai.com/api-keys',anthropic:'https://platform.claude.com/settings/keys'};
    if(!Object.hasOwn(urls,provider))throw new Error('Invalid provider');await shell.openExternal(urls[provider]);return true;
  });
  handle('status',async()=>(await client()).status());
  handle('connect',async data=>(await client()).connect(data));
  handle('cancel-connect',async provider=>{(await client()).cancelConnect(provider);return true;});
  handle('disconnect',async provider=>(await client()).disconnect(provider));
  handle('models',async provider=>(await client()).models(provider));
  handle('answer',async data=>{
    if(typeof data?.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(data.id))throw new Error('Invalid request');
    for(const c of inflight.values())c.abort();
    const controller=new AbortController();inflight.set(data.id,controller);
    try{
      const text=await(await client()).answer(data,text=>{
        if(!controller.signal.aborted&&!win.isDestroyed())win.webContents.send('cue:api-answer-event',{id:data.id,type:'delta',text});
      },controller.signal);
      return {text};
    }finally{if(inflight.get(data.id)===controller)inflight.delete(data.id);}
  });
  handle('interrupt',async id=>{if(id)inflight.get(String(id))?.abort();else for(const c of inflight.values())c.abort();return true;});
  return {close(){for(const c of inflight.values())c.abort();connection?.close();}};
}
module.exports={installApiProviders};
