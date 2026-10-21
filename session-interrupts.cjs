// Sleep/lock invalidates live audio assumptions. Require a deliberate Start
// afterwards instead of silently resuming a possibly stale interview session.
function installSessionInterrupts({powerMonitor,webContents,shareView}){
  const handlers=new Map();
  for(const event of ['suspend','lock-screen']){
    const handler=()=>{shareView.stop();if(!webContents.isDestroyed())webContents.send('cue:action','system-interrupted');};
    handlers.set(event,handler);powerMonitor.on(event,handler);
  }
  return ()=>{for(const [event,handler] of handlers)powerMonitor.removeListener(event,handler);};
}
module.exports={installSessionInterrupts};
