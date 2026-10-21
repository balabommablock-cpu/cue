export const MODELS = {
  strong:{id:'Qwen3-8B-q4f16_1-MLC',name:'Qwen3 · 8 billion parameters',download:'about 5 GB',memory:'about 6 GB of available graphics memory'},
  balanced:{id:'Qwen3-4B-q4f16_1-MLC',name:'Qwen3 · 4 billion parameters',download:'about 2.5 GB',memory:'about 4 GB of available graphics memory'},
  light:{id:'Qwen3-1.7B-q4f16_1-MLC',name:'Qwen3 · 1.7 billion parameters',download:'about 1.1 GB',memory:'about 2 GB of available graphics memory'},
};
export async function checkDevice() {
  if (!navigator.gpu) return {ok:false,message:'Local AI could not access WebGPU. Reopen Cue after updating macOS.'};
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return {ok:false,message:'Cue cannot access a compatible graphics processor. Close other graphics-heavy apps and restart Cue.'};
  if (!adapter.features.has('shader-f16')) return {ok:false,message:'Your graphics processor does not support the local models in this preview. Another computer may be needed.'};
  const estimate=await navigator.storage?.estimate?.().catch(()=>({}));
  return {ok:true,message:'Your Mac supports local AI. Setup checks the model by generating a real answer after download.',available:estimate?.quota?estimate.quota-(estimate.usage||0):null};
}
export class LocalBrain {
  constructor(onProgress){this.onProgress=onProgress;this.worker=null;this.engine=null;this.ready=false;this.loading=false;this.revision=0;}
  async load(choice='balanced') {
    if(this.loading)throw new Error('AI setup is already running.');
    this.dispose();const revision=++this.revision;this.loading=true;let timer;
    try {
      const {CreateWebWorkerMLCEngine}=await import('@mlc-ai/web-llm');
      if(revision!==this.revision)throw new Error('Setup cancelled.');
      this.worker=new Worker(new URL('./llm.worker.js',import.meta.url),{type:'module'});
      const interrupted=new Promise((_,reject)=>{this.cancel=reject;timer=setTimeout(()=>reject(new Error('Model setup took too long. Check the connection and retry.')),15*60*1000);});
      const engine=await Promise.race([CreateWebWorkerMLCEngine(this.worker,MODELS[choice].id,{initProgressCallback:p=>{if(revision===this.revision)this.onProgress?.(p);}}, {context_window_size:4096}),interrupted]);
      if(revision!==this.revision){this.worker?.terminate();throw new Error('Setup cancelled.');}
      this.engine=engine;this.ready=true;this.choice=choice;
    } finally {clearTimeout(timer);if(revision===this.revision){this.loading=false;this.cancel=null;}}
  }
  async answer(messages,onText) {
    if(!this.ready)throw new Error('Set up local AI first.');
    const engine=this.engine;let timer,expired=false;
    const limit=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;this.dispose();reject(new Error('The local model took too long. Reload it or try the lighter model.'));},90000);});
    try{return await Promise.race([(async()=>{
      const reasoning=/\/think$/.test(messages.at(-1)?.content||'');
      const chunks=await engine.chat.completions.create({messages,stream:true,temperature:reasoning?.2:.5,max_tokens:reasoning?1600:420,extra_body:{enable_thinking:reasoning}});
      let text='';for await(const chunk of chunks){if(expired)break;text+=chunk.choices[0]?.delta?.content||'';onText(text);}
      return text;
    })(),limit]);}finally{clearTimeout(timer);}
  }
  interrupt(){this.engine?.interruptGenerate();}
  dispose(){this.revision++;this.ready=false;this.loading=false;this.cancel?.(new Error('Setup cancelled.'));this.cancel=null;this.engine?.interruptGenerate();this.worker?.terminate();this.worker=null;this.engine=null;}
}
export class LocalSpeech {
  constructor(onProgress){this.onProgress=onProgress;this.worker=null;this.pending=new Map();this.sequence=0;this.ready=false;}
  request(type,audio) {
    if(!this.worker){
      this.worker=new Worker(new URL('./speech.worker.js',import.meta.url),{type:'module'});
      this.worker.onmessage=({data})=>{
        if(data.type==='progress'){this.onProgress?.(data);return;}
        const p=this.pending.get(data.id);if(!p)return;this.pending.delete(data.id);clearTimeout(p.timer);
        if(data.type==='error')p.reject(new Error(data.error));else p.resolve(data.text??true);
      };
      this.worker.onerror=()=>this.dispose(new Error('The speech model stopped. Reload it in AI setup.'));
    }
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.dispose(new Error(type==='load'?'Speech download took too long. Check your connection and try again.':'Speech processing took too long. Try a shorter question.'));},type==='load'?600000:90000);
      this.pending.set(id,{resolve,reject,timer});
      this.worker.postMessage({id,type,...(audio?{audio:audio.buffer}:{})},audio?[audio.buffer]:[]);
    });
  }
  async load(){await this.request('load');this.ready=true;}
  transcribe(audio){if(!this.ready)throw new Error('Set up speech recognition first.');return this.request('transcribe',audio);}
  dispose(error=new Error('Speech recognition stopped.')){this.worker?.terminate();this.worker=null;this.ready=false;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
}
