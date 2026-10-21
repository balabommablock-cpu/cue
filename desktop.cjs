const {app,BrowserWindow,ipcMain,session,desktopCapturer,dialog,screen,systemPreferences,globalShortcut,powerMonitor,shell,safeStorage}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {ShareViewController}=require('./share-view.cjs');
const {installSessionInterrupts}=require('./session-interrupts.cjs');
const {installRendererRecovery,createShutdown,windowBounds}=require('./desktop-lifecycle.cjs');
const {createStartController}=require('./desktop-start.cjs');
const captureLog=[];
function captureDiagnostic(item){captureLog.push({at:new Date().toISOString(),...item});if(captureLog.length>30)captureLog.shift();try{fs.writeFileSync(path.join(app.getPath('userData'),'capture-diagnostics.json'),JSON.stringify(captureLog));}catch{}}
app.setName('Cue');
app.setPath('userData',path.join(app.getPath('appData'),'Cue Community'));

// An explicit separate profile lets QA test the distributed first-run flow
// without touching the owner's saved context, cache or credentials.
const isolatedProfile=app.commandLine.getSwitchValue('cue-profile');
if(isolatedProfile){
  if(!path.isAbsolute(isolatedProfile))throw new Error('Use an absolute Cue profile folder.');
  fs.mkdirSync(isolatedProfile,{recursive:true,mode:0o700});
  app.setPath('userData',isolatedProfile);
}
// Only lifecycle names and stack frames are stored: no questions, answers,
// audio, profile or error-message payloads. Retain the last 80 events.
function diagnostic(phase,error){
  try{
    const file=path.join(app.getPath('userData'),'runtime-diagnostics.json');
    let entries=[];try{const prior=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(prior))entries=prior.slice(-79);}catch{}
    entries.push({at:new Date().toISOString(),version:app.getVersion(),phase,...(error?{name:error.name,frames:String(error.stack||'').split('\n').filter(line=>/^\s+at /.test(line)).slice(0,6)}:{})});
    fs.writeFileSync(file,JSON.stringify(entries,null,2),{mode:0o600});
  }catch{}
}
process.on('uncaughtExceptionMonitor',error=>diagnostic('uncaught-exception',error));
let win,server,origin,shareView,accountBridge,disposeInterrupts,disposeRecovery,quitting=false,shareChoosing=false,captureError='',protectedCapture=true;
const startController=createStartController({show:()=>{if(!quitting&&win&&!win.isDestroyed()){win.show();win.focus();}},send:action=>{if(!quitting&&win&&!win.isDestroyed())win.webContents.send('cue:action',action);}});
if(process.argv.includes('--start-listening')){diagnostic('shortcut-cold-start');startController.request();}
const shutdown=createShutdown([
  ['mark-quitting',()=>{quitting=true;}],
  ['interrupt-listeners',()=>disposeInterrupts?.()],
  ['recovery-listeners',()=>disposeRecovery?.()],
  ['shortcuts',()=>globalShortcut.unregisterAll()],
  ['share-view',()=>shareView?.stop()],
  ['chatgpt',()=>accountBridge?.close()],
  ['providers',()=>server?.disposeLocal?.()],
  ['server-connections',()=>server?.closeAllConnections()],
  ['server-listener',()=>server?.close()],
],{onError:diagnostic,onPhase:diagnostic});
if(!app.requestSingleInstanceLock()){app.quit();}
else {
  app.on('second-instance',(_event,argv)=>{if(quitting)return;if(argv.includes('--start-listening')){diagnostic('shortcut-running-app');startController.request();}else if(win&&!win.isDestroyed()){win.show();win.focus();}});
  app.whenReady().then(async()=>{
    diagnostic('starting');
    const {createApp}=await import('./server.mjs');
    if(quitting)return;
    const {openKnowledgeBank}=await import('./knowledge-bank.mjs');
    const {knowledge:bundledKnowledge}=await import('./knowledge.mjs');
    const bank=openKnowledgeBank({directory:path.join(app.getPath('userData'),'knowledge'),seed:bundledKnowledge.view()});
    if(quitting)return;
    const {loadConfiguredWorkspace}=await import('./interview-workspace.mjs');
    const workspace=await loadConfiguredWorkspace(bank.directory);
    if(quitting)return;
    server=createApp({knowledge:bank,workspace});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4329,'127.0.0.1',resolve);});
    if(quitting){server.close();return;}
    origin='http://127.0.0.1:4329';
    const trusted=url=>{try{return new URL(url).origin===origin;}catch{return false;}};
    session.defaultSession.setPermissionCheckHandler((_wc,permission,requestingOrigin,details={})=>trusted(requestingOrigin)&&(permission==='display-capture'||permission==='media'&&details.mediaType!=='video'));
    session.defaultSession.setPermissionRequestHandler((wc,permission,cb,details={})=>cb(trusted(wc.getURL())&&(permission==='display-capture'||permission==='media'&&!(details.mediaTypes||[]).includes('video'))));
    session.defaultSession.setDisplayMediaRequestHandler(async(request,callback)=>{
      captureError='';
      captureDiagnostic({phase:'requested',origin:request.securityOrigin,userGesture:request.userGesture});
      // The renderer awaits a login check after Start. Electron's gesture flag can
      // expire across that await. Start authorises capture; OS access checks still apply.
      if(!trusted(request.securityOrigin))return callback({});
      try {
        const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0}});
        captureDiagnostic({phase:'sources',count:sources.length});
        if(!sources.length)throw new Error('No screen source was available.');
        if(sources.length===1){callback({video:sources[0],audio:'loopback'});return;}
        const selected=await dialog.showMessageBox(win,{type:'question',title:'Choose interview audio',message:'Choose the screen carrying your interview.',detail:'Codex mode transcribes computer audio locally. Realtime mode sends audio to OpenAI. Screen video stays on this Mac. Stop ends capture.',buttons:[...sources.map(s=>s.name),'Cancel'],cancelId:sources.length});
        if(selected.response>=sources.length)return callback({});
        callback({video:sources[selected.response],audio:'loopback'});
      }catch(error){captureError=String(error?.message||error);captureDiagnostic({phase:'failed',message:captureError,permission:systemPreferences.getMediaAccessStatus('screen')});callback({});}
    },{useSystemPicker:false});
    const bounds=screen.getPrimaryDisplay().workArea;
    win=new BrowserWindow({title:'Cue',...windowBounds(bounds),transparent:true,backgroundColor:'#00000000',frame:false,roundedCorners:true,hasShadow:true,alwaysOnTop:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    win.once('close',shutdown);
    accountBridge=require('./chatgpt-desktop.cjs').installChatGPT({app,win,ipcMain,safeStorage,shell,origin});
    win.setAlwaysOnTop(true,'floating');win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
    // This is a best-effort OS request. Modern macOS ScreenCaptureKit clients
    // can still capture the window; the UI explicitly describes that limit.
    win.setContentProtection(protectedCapture);
    const helperRoot=app.isPackaged?process.resourcesPath:path.join(__dirname,'native-build');
    shareView=new ShareViewController({helperPath:path.join(helperRoot,'Cue Share View.app','Contents','MacOS','CueShareView'),onState:state=>{if(win&&!win.isDestroyed())win.webContents.send('cue:share-state',state);}});
    disposeInterrupts=installSessionInterrupts({powerMonitor,webContents:win.webContents,shareView});
    disposeRecovery=installRendererRecovery({win,server,shareView,dialog,quit:()=>app.quit(),onError:diagnostic});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(e,url)=>{if(!trusted(url))e.preventDefault();});
    win.webContents.on('did-start-loading',()=>startController.loading());
    ipcMain.on('cue:ready',e=>{if(e.sender===win?.webContents&&!quitting){diagnostic('renderer-ready');startController.ready();}});
    ipcMain.on('cue:phase',(e,phase)=>{if(e.sender===win?.webContents&&['shortcut-received','listening','start-failed'].includes(phase))diagnostic(phase);});
    ipcMain.on('cue:pin',(e,value)=>{if(e.sender===win?.webContents&&typeof value==='boolean')win.setAlwaysOnTop(value,'floating');});
    ipcMain.on('cue:close',e=>{if(e.sender===win?.webContents)win.close();});
    ipcMain.handle('cue:status',e=>{if(e.sender!==win?.webContents)return null;return {platform:process.platform,screen:systemPreferences.getMediaAccessStatus('screen'),microphone:systemPreferences.getMediaAccessStatus('microphone'),captureError,protectedCapture,shareView:shareView.state};});
    ipcMain.handle('cue:knowledge-reload',e=>{if(quitting||!win||win.isDestroyed()||e.sender!==win.webContents)return null;return workspace?workspace.reload():bank.reload();});
    ipcMain.handle('cue:knowledge-open',async(e,kind,interviewId)=>{
      if(quitting||!win||win.isDestroyed()||e.sender!==win.webContents)return null;
      if(kind==='mock'){
        const file=workspace?workspace.mockPath(interviewId):path.join(bank.directory,'Mock Interview.md');
        if(!fs.existsSync(file))throw new Error('The mock interview file is not in the saved knowledge folder yet.');
        shell.showItemInFolder(file);return true;
      }
      if(kind!=='folder')return false;
      const error=await shell.openPath(workspace?.directory||bank.directory);if(error)throw new Error('Could not open the saved knowledge folder.');return true;
    });
    ipcMain.handle('cue:microphone',async e=>{
      if(e.sender!==win?.webContents||!trusted(e.sender.getURL()))throw new Error('Open Cue to request microphone access.');
      if(process.platform!=='darwin')return true;
      const state=systemPreferences.getMediaAccessStatus('microphone');
      if(state==='granted'||state==='not-determined'&&await systemPreferences.askForMediaAccess('microphone'))return true;
      throw new Error('Allow Cue in System Settings → Privacy & Security → Microphone, then quit and reopen Cue.');
    });
    ipcMain.handle('cue:protection',(e,value)=>{if(e.sender!==win?.webContents||typeof value!=='boolean')return false;protectedCapture=value;win.setContentProtection(value);return protectedCapture;});
    ipcMain.handle('cue:share-start',async e=>{
      if(e.sender!==win?.webContents)return null;
      if(shareChoosing||shareView.child)return shareView.state;
      if(process.platform!=='darwin')return shareView.start({displayID:0});
      shareChoosing=true;
      try{
        const displays=screen.getAllDisplays();
        const choice=await dialog.showMessageBox(win,{type:'info',title:'Open Share View',message:'Choose the display to present.',detail:'Share View creates a local picture with Cue excluded. In the meeting, select the Cue Share View window. Sharing the entire display can still expose Cue. Other apps and notifications remain visible.',buttons:[...displays.map((d,i)=>`${d.label||'Display '+(i+1)} · ${d.size.width}×${d.size.height}`),'Cancel'],cancelId:displays.length});
        if(choice.response>=displays.length)return shareView.state;
        if(!win||win.isDestroyed())return null;
        return shareView.start({displayID:displays[choice.response].id});
      }finally{shareChoosing=false;}
    });
    ipcMain.handle('cue:share-stop',e=>{if(e.sender!==win?.webContents)return null;return shareView.stop();});
    // The independent Cue Launcher handles holding right Option, including while Cue is quit.
    globalShortcut.register('Alt+Shift+Space',()=>{if(win.isVisible())win.hide();else {win.show();win.focus();}});
    globalShortcut.register('Alt+P',()=>win.webContents.send('cue:action','pause'));
    globalShortcut.register('Alt+Return',()=>win.webContents.send('cue:action','answer'));
    win.once('ready-to-show',()=>{if(!quitting&&!win.isDestroyed()){win.show();diagnostic('ready');}});
    await win.loadURL(origin);
  }).catch(error=>{if(quitting)return;diagnostic('startup-error',error);dialog.showErrorBox('Cue could not start',error.code==='EADDRINUSE'?'Port 4329 is already in use. Close the other Cue window or development server, then reopen Cue from Applications.':'Cue could not load its local components. Reopen Cue from Applications. If this repeats, keep your saved data and reinstall the app.');app.quit();});
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',shutdown);
  app.on('will-quit',()=>diagnostic('will-quit'));
}
