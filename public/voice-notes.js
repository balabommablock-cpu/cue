import {acquireAudio} from './audio-capture.js';
import {QuestionSegmenter,pcmBase64} from './local-audio.js';
import {SpeechPipeline,transcribeRequest} from './speech-pipeline.js';

// Microphone ownership is independent of the interview session. Stopping a
// memo releases the physical microphone before waiting for final recognition.
export class VoiceNotes {
  constructor({getSettings,onText,onState=()=>{},onError=()=>{},acquire=acquireAudio,transcribe=transcribeRequest,makeNode=(ctx)=>new AudioWorkletNode(ctx,'cue-pcm')}){Object.assign(this,{getSettings,onText,onState,onError,acquire,transcribe,makeNode});this.epoch=0;this.active=false;}
  async start(){
    this.cancel();const epoch=++this.epoch;this.active=true;this.onState('Opening microphone…');
    this.openTimer=setTimeout(()=>{if(epoch===this.epoch){this.cancel();this.onError(new Error('Microphone did not open. Check macOS microphone access and the device selected in Settings, then try again.'));}},20000);
    try{
      const s=this.getSettings();const capture=await this.acquire({mode:'mic',microphoneId:s.microphone,echoCancellation:s.echoCancellation,onProgress:text=>{if(epoch===this.epoch)this.onState(text);},isCurrent:()=>epoch===this.epoch,onEnded:()=>{this.cancel();this.onError(new Error('Microphone disconnected. Your captured text is still here.'));}});
      if(epoch!==this.epoch||!this.active){capture.stop();return;}this.capture=capture;
      await capture.context.audioWorklet.addModule('/pcm-worklet.js');if(epoch!==this.epoch)return;
      this.pipeline=new SpeechPipeline({transcribe:(pcm,signal)=>this.transcribe(pcm,signal,{lane:'readback'}),onTranscript:item=>{if(epoch===this.epoch)this.onText(item.text);},onError:e=>{if(epoch===this.epoch)this.onError(e);}});
      this.segmenter=new QuestionSegmenter(samples=>this.pipeline?.push({pcm:pcmBase64(samples),source:'mic',final:true}),()=>this.onState('Listening…'),{silenceMs:1000,onEnd:()=>this.onState('Transcribing…')});
      this.node=this.makeNode(capture.context);const mute=capture.context.createGain();mute.gain.value=0;
      capture.inputs[0].analyser.connect(this.node).connect(mute).connect(capture.context.destination);
      this.node.port.onmessage=e=>{if(this.active&&epoch===this.epoch)this.segmenter.push(e.data);};
      clearTimeout(this.openTimer);this.onState('Listening · microphone only');this.limit=setTimeout(()=>{void this.finish();},20*60*1000);
    }catch(e){if(epoch===this.epoch){this.cancel();this.onError(e);}}
  }
  finish(){if(this.finishing)return this.finishing;const job=this.finishCapture();this.finishing=job;void job.finally(()=>{if(this.finishing===job)this.finishing=null;});return job;}
  async finishCapture(){
    if(!this.active)return;if(!this.pipeline){this.cancel();return;}const epoch=this.epoch;this.active=false;clearTimeout(this.limit);clearTimeout(this.openTimer);
    this.segmenter?.flush();this.node?.disconnect();this.capture?.stop();this.capture=null;
    this.onState('Finishing transcription…');
    const started=Date.now();while(epoch===this.epoch&&(this.pipeline?.busy||this.pipeline?.queue.length)){
      if(Date.now()-started>75000){this.pipeline.stop();this.onError(new Error('Last segment timed out. Earlier text is saved; add the missing words below.'));break;}
      await new Promise(r=>setTimeout(r,80));
    }
    if(epoch===this.epoch){this.pipeline?.stop();this.onState('Recording off');}
  }
  cancel(){this.epoch++;this.active=false;this.finishing=null;clearTimeout(this.limit);clearTimeout(this.openTimer);this.node?.disconnect();this.node=null;this.capture?.stop();this.capture=null;this.pipeline?.stop();this.pipeline=null;this.segmenter=null;this.onState('Recording off');}
}
