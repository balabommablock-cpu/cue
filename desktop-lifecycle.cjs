// Recovery must stop the provider and shared view before reloading the UI.
// Reloading never starts recording; the renderer requires an explicit Start.
function installRendererRecovery({win,server,shareView,dialog,quit,onError=()=>{}}){
  // BrowserWindow.webContents itself throws after the native window closes.
  // Keep the emitter we registered on so teardown never revisits that getter.
  const webContents=win.webContents;
  let recovering=false,disposed=false;
  const handler=async()=>{
    if(disposed||recovering||win.isDestroyed())return;recovering=true;
    try{
      server.disposeLocal?.();shareView.stop();
      const choice=await dialog.showMessageBox(win,{type:'warning',title:'Cue stopped unexpectedly',message:'The interview window stopped. Listening has ended.',detail:'Reload to reconnect. Your saved fact sheet and stories are still on this Mac. Unsaved conversation text may be lost.',buttons:['Reload Cue','Quit'],defaultId:0,cancelId:1});
      if(disposed||win.isDestroyed())return;
      if(choice.response===0)webContents.reload();else quit();
    }catch(error){onError('renderer-recovery',error);if(!disposed&&!win.isDestroyed())quit();}
    finally{recovering=false;}
  };
  webContents.on('render-process-gone',handler);
  return ()=>{if(disposed)return;disposed=true;webContents.removeListener('render-process-gone',handler);};
}
// A second quit signal must not tear down the same resources again. A failure
// in one cleanup step must not leave speech, model processes or sockets alive.
function createShutdown(steps,{onError=()=>{},onPhase=()=>{}}={}){
  let stopped=false;
  return ()=>{
    if(stopped)return;stopped=true;onPhase('shutdown-start');
    for(const [name,run] of steps){try{run();}catch(error){onError(name,error);}}
    onPhase('shutdown-complete');
  };
}
function windowBounds(area){
  const width=Math.min(960,area.width),height=Math.min(820,area.height);
  return {width,height,minWidth:Math.min(510,width),minHeight:Math.min(440,height),x:area.x+Math.max(0,area.width-width-30),y:area.y+Math.min(65,Math.max(0,area.height-height))};
}
module.exports={installRendererRecovery,createShutdown,windowBounds};
