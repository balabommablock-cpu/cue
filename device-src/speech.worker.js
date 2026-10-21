import {pipeline,env} from '@huggingface/transformers';
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = '/device/wasm/';
let transcriber, loading;
const ready = () => loading ||= pipeline('automatic-speech-recognition','onnx-community/whisper-base',{
  device:'wasm', dtype:'q8', progress_callback: p => self.postMessage({type:'progress',status:p.status,file:p.file,progress:p.progress})
}).then(p=>transcriber=p).catch(e=>{loading=null;throw e;});
let work = Promise.resolve();
self.onmessage = ({data}) => {work=work.then(async()=>{
  try {
    if(data.type==='load'){await ready();self.postMessage({id:data.id,type:'ready'});}
    else if(data.type==='transcribe'){
      await ready();
      const result=await transcriber(new Float32Array(data.audio),{language:'english',task:'transcribe',chunk_length_s:25,stride_length_s:3,return_timestamps:false});
      self.postMessage({id:data.id,type:'text',text:result.text});
    }
  }catch(e){self.postMessage({id:data.id,type:'error',error:String(e.message||e)});}
});};
