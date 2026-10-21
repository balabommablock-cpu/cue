class CuePCM extends AudioWorkletProcessor {
  constructor(){super();this.samples=[];this.phase=0;}
  process(inputs){
    const input=inputs[0];if(!input?.[0])return true;
    const ratio=sampleRate/16000;
    for(let i=0;i<input[0].length;i++){
      this.phase++;if(this.phase>=ratio){this.phase-=ratio;let sample=0;for(const channel of input)sample+=channel[i];this.samples.push(sample/input.length);}
    }
    if(this.samples.length>=1600){this.port.postMessage(new Float32Array(this.samples));this.samples=[];}
    return true;
  }
}
registerProcessor('cue-pcm',CuePCM);
