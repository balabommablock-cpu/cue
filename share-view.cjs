const {spawn}=require('node:child_process');
const {existsSync}=require('node:fs');

class ShareViewController {
  constructor({helperPath,onState=()=>{},spawnProcess=spawn,exists=existsSync,startTimeout=20000,platform=process.platform}={}){
    Object.assign(this,{helperPath,onState,spawnProcess,exists,startTimeout,platform});
    this.child=null;this.timer=null;this.generation=0;this.state={state:'stopped',message:'Share View is off.'};
  }
  update(state){this.state=state;this.onState({...state});return this.state;}
  start({displayID,parentPID=process.pid}){
    if(this.child)return this.state;
    if(this.platform!=='darwin')return this.update({state:'error',message:'Share View is currently available on Mac. Use a specific window or tab when sharing on Windows.'});
    if(!Number.isSafeInteger(displayID)||displayID<0||!Number.isSafeInteger(parentPID)||parentPID<2)throw new Error('Invalid display or application identifier.');
    if(!this.exists(this.helperPath))return this.update({state:'error',message:'Share View is missing from this build. Rebuild Cue with the native helper.'});
    const generation=++this.generation;let buffer='';
    let child;
    try{child=this.spawnProcess(this.helperPath,['--parent-pid',String(parentPID),'--display-id',String(displayID)],{stdio:['ignore','pipe','pipe']});}
    catch{return this.update({state:'error',message:'Share View could not launch. Reopen Cue and try again.'});}
    this.child=child;this.update({state:'starting',message:'Starting Share View…'});
    const current=()=>generation===this.generation&&this.child===child;
    this.timer=setTimeout(()=>{if(current()){this.stop();this.update({state:'error',message:'Share View did not start. Check recording permission and try again.'});}},this.startTimeout);
    child.stdout.on('data',chunk=>{
      if(!current())return;buffer+=chunk.toString();
      if(buffer.length>64000){this.stop();this.update({state:'error',message:'Share View returned invalid status data.'});return;}
      let index;
      while((index=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,index);buffer=buffer.slice(index+1);let event;
        try{event=JSON.parse(line);}catch{continue;}
        if(!event||!['starting','live','permission_required','error','stopped'].includes(event.state))continue;
        if(event.state==='starting'&&this.state.state==='live')continue;
        if(event.state!=='starting')clearTimeout(this.timer);
        this.update({state:event.state,message:String(event.message||'').slice(0,2000)});
      }
    });
    child.stderr.on('data',()=>{});
    child.on('error',()=>{if(current()){clearTimeout(this.timer);this.child=null;this.update({state:'error',message:'Share View could not launch. Reopen Cue and try again.'});}});
    child.on('close',()=>{if(current()){clearTimeout(this.timer);this.child=null;if(!['error','permission_required','stopped'].includes(this.state.state))this.update({state:'error',message:'Share View exited unexpectedly. Stop sharing it in your meeting and reopen it.'});}});
    return this.state;
  }
  stop(){
    ++this.generation;clearTimeout(this.timer);const child=this.child;this.child=null;
    child?.kill('SIGTERM');
    return this.update({state:'stopped',message:'Share View is off. Stop sharing it in your meeting too.'});
  }
}
module.exports={ShareViewController};
