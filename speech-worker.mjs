import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';

const stopped=()=>new DOMException('Stopped.','AbortError');
// Each lane owns a warm, offline decoder. A readback job cannot occupy the
// interviewer decoder. Audio exists only in bounded request buffers.
export class SpeechWorker {
  constructor({command,script,spawnProcess=spawn,timeout=60000,idleMs=300000}){
    Object.assign(this,{command,script,spawnProcess,timeout,idleMs});this.sequence=0;this.queue=[];
  }
  warm(){
    if(this.ready)return this.ready;
    clearTimeout(this.idle);
    this.ready=new Promise((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});
    this.ready.catch(()=>{});
    this.buffer='';this.decoder=new StringDecoder('utf8');
    const child=this.spawnProcess(this.command,['-c',this.script,'--worker'],{stdio:['pipe','pipe','pipe'],env:{...process.env,HF_HUB_OFFLINE:'1'}});
    this.child=child;
    this.startTimer=setTimeout(()=>this.close(new Error('Local speech recognition could not warm up.')),this.timeout);
    child.on('error',()=>{if(this.child===child)this.close(new Error('Local speech recognition could not start.'));});
    child.on('close',()=>{if(this.child===child)this.close(new Error('Local speech recognition disconnected. Try again.'));});
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
    child.stdout.on('data',bytes=>{
      if(this.child!==child)return;
      this.buffer+=this.decoder.write(bytes);
      if(this.buffer.length>100000)return this.close(new Error('Speech recognition returned too much data.'));
      let n;while((n=this.buffer.indexOf('\n'))>=0){
        const line=this.buffer.slice(0,n);this.buffer=this.buffer.slice(n+1);let data;
        try{data=JSON.parse(line);}catch{return this.close(new Error('Speech recognition returned an unreadable result.'));}
        if(data?.type==='ready'){clearTimeout(this.startTimer);this.readyResolve();this.armIdle();continue;}
        if(data?.type==='error')return this.close(new Error('Local speech recognition could not load the cached model.'));
        const job=this.active;
        if(!job||data?.id!==job.id)return this.close(new Error('Speech recognition returned an unexpected result.'));
        this.active=null;clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.abort);
        if(typeof data.text==='string')job.resolve(data.text.trim());else job.reject(new Error('Local speech recognition failed. Try again.'));
        this.drain();
      }
    });
    return this.ready;
  }
  async transcribe(pcm,signal){
    signal?.throwIfAborted();
    if(this.queue.length>=8)throw new Error('Speech recognition is busy. Try again in a moment.');
    return new Promise((resolve,reject)=>{
      const job={pcm,signal,resolve,reject,id:++this.sequence};
      job.abort=()=>{
        if(this.active===job){this.close(stopped());return;}
        this.queue=this.queue.filter(x=>x!==job);signal?.removeEventListener('abort',job.abort);reject(stopped());
      };
      signal?.addEventListener('abort',job.abort,{once:true});this.queue.push(job);
      this.warm().then(()=>this.drain(),()=>{});
    });
  }
  drain(){
    if(this.active)return;
    const job=this.queue.shift();
    if(!job){this.armIdle();return;}
    clearTimeout(this.idle);this.active=job;
    job.timer=setTimeout(()=>this.close(new Error('Local speech recognition took too long. Try a shorter question.')),this.timeout);
    this.child.stdin.write(JSON.stringify({id:job.id,pcm:job.pcm})+'\n');job.pcm=null;
  }
  armIdle(){clearTimeout(this.idle);if(!this.active&&!this.queue.length){this.idle=setTimeout(()=>this.close(),this.idleMs);this.idle.unref?.();}}
  close(error=stopped()){
    clearTimeout(this.startTimer);clearTimeout(this.idle);
    const child=this.child;this.child=null;child?.kill('SIGKILL');
    this.readyReject?.(error);this.ready=null;this.readyResolve=null;this.readyReject=null;
    for(const job of [this.active,...this.queue].filter(Boolean)){clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.abort);job.pcm=null;job.reject(error);}
    this.active=null;this.queue=[];this.buffer='';
  }
}
