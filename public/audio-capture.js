// Own every physical track separately from the mixed stream. Stopping a Web
// Audio destination alone does not release the microphone or display capture.
export async function acquireAudio({mode, microphoneId='default', echoCancellation=true, getSystemStream,
  isCurrent=()=>true, onEnded=()=>{}, mediaDevices=navigator.mediaDevices,
  AudioContextClass=AudioContext, MediaStreamClass=MediaStream,
  onProgress=()=>{},ensureMicrophone=async()=>{if(typeof window!=='undefined')await window.cueDesktop?.requestMicrophone?.();}}) {
  if(mode==='text')return null;
  if(!['system','mic','both','hybrid'].includes(mode))throw new Error('Choose a valid audio source.');
  const inputs=[],nodes=[];
  let context,output,closed=false;
  const stop=()=>{
    if(closed)return;closed=true;
    for(const input of inputs)for(const track of input.stream.getTracks()){track.onended=null;track.stop();}
    output?.getTracks().forEach(track=>track.stop());
    for(const node of nodes)try{node.disconnect();}catch{}
    if(context)void context.close().catch(()=>{});
  };
  const check=()=>{if(closed||!isCurrent())throw new DOMException('Capture cancelled.','AbortError');};
  async function add(kind,open){
    let stream;
    try{stream=await open();}catch(error){
      if(!isCurrent())throw new DOMException('Capture cancelled.','AbortError');
      if(kind==='mic'){
        if(error.name==='NotAllowedError')throw new Error('Microphone access is blocked. Allow Cue under System Settings → Privacy & Security → Microphone, then reopen Cue.');
        if(['NotFoundError','OverconstrainedError'].includes(error.name))throw new Error('No matching microphone is available. Connect a microphone and choose it in Settings → Microphone.');
        if(error.name==='NotReadableError')throw new Error('The microphone could not open. Check that it is connected and available, then try Start again.');
      }
      throw error;
    }
    if(closed){stream.getTracks().forEach(t=>t.stop());throw new DOMException('Capture cancelled.','AbortError');}
    inputs.push({kind,stream});check();
    if(!stream.getAudioTracks().length)throw new Error(kind==='mic'?'The selected microphone returned no audio track.':'No computer audio was shared. Choose a source with audio, then try again.');
    if(stream.getTracks().some(t=>t.readyState==='ended'))throw new Error('The selected audio source has already disconnected. Choose it again.');
    for(const track of stream.getTracks())track.onended=()=>{if(closed)return;stop();onEnded(kind);};
  }
  try{
    // Keep display capture first because browser pickers require a user action.
    if(mode!=='mic')await add('system',getSystemStream);
    if(mode!=='system')await add('mic',async()=>{onProgress('Checking microphone access…');await ensureMicrophone();check();onProgress('Opening audio device…');return mediaDevices.getUserMedia({audio:{
      // Room modes include a nearby phone. Keep that speech; hybrid retains
      // Mac echo cancellation because loopback already captures Mac playback.
      echoCancellation:mode==='mic'?false:echoCancellation,noiseSuppression:!['mic','hybrid'].includes(mode),autoGainControl:true,
      ...(microphoneId!=='default'?{deviceId:{exact:microphoneId}}:{}),
    },video:false});});
    check();context=new AudioContextClass();
    const destination=context.createMediaStreamDestination();nodes.push(destination);
    destination.channelCount=1;output=destination.stream;
    for(const input of inputs){
      const source=context.createMediaStreamSource(new MediaStreamClass(input.stream.getAudioTracks()));
      const analyser=context.createAnalyser();analyser.fftSize=256;
      const gain=context.createGain();gain.gain.value=1/inputs.length;
      source.connect(analyser).connect(gain).connect(destination);
      nodes.push(source,analyser,gain);input.analyser=analyser;
      for(const track of input.stream.getTracks())track.onended=()=>{
        if(closed)return;stop();onEnded(input.kind);
      };
    }
    onProgress('Starting audio engine…');await context.resume();check();
    return {stream:output,context,inputs,stop,
      setPaused(paused){
        for(const input of inputs)for(const track of input.stream.getAudioTracks())track.enabled=!paused;
        output.getAudioTracks().forEach(track=>track.enabled=!paused);
      },
    };
  }catch(error){stop();throw error;}
}

export function inputLevel(analyser){
  const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);
  let sum=0;for(const n of data)sum+=n*n;
  return Math.min(1,Math.sqrt(sum/data.length)*5);
}
