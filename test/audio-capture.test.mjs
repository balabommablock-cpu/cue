import {test} from 'node:test';
import assert from 'node:assert/strict';
import {acquireAudio} from '../public/audio-capture.js';
import {turnDecision} from '../public/turn-decision.js';

class Track {
  constructor(kind='audio'){this.kind=kind;this.enabled=true;this.stops=0;}
  stop(){this.stops++;}
}
class Stream {
  constructor(tracks=[new Track()]){this.tracks=tracks;}
  getTracks(){return this.tracks;}
  getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}
}
class Node {
  constructor(){this.connections=[];this.gain={value:1};}
  connect(next){this.connections.push(next);return next;}
  disconnect(){this.connections=[];}
}
class Context {
  constructor(){this.sources=[];this.gains=[];this.closed=0;}
  createMediaStreamDestination(){this.destination=new Node();this.destination.stream=new Stream();return this.destination;}
  createMediaStreamSource(stream){const node=new Node();node.stream=stream;this.sources.push(node);return node;}
  createAnalyser(){return new Node();}
  createGain(){const node=new Node();this.gains.push(node);return node;}
  async resume(){}
  async close(){this.closed++;}
}
function setup(extra={}){
  const system=new Stream([new Track('audio'),new Track('video')]),mic=new Stream();
  const options={mode:'both',getSystemStream:async()=>system,mediaDevices:{getUserMedia:async()=>mic},AudioContextClass:Context,MediaStreamClass:Stream,...extra};
  return {system,mic,options};
}
test('both inputs connect to one mixed audio track, without routing audio to speakers',async()=>{
  const {options,system,mic}=setup();const session=await acquireAudio(options);
  assert.deepEqual(session.inputs.map(i=>i.kind),['system','mic']);assert.equal(session.stream.getAudioTracks().length,1);
  assert.equal(session.stream.getTracks().some(t=>t.kind==='video'),false);
  assert.equal(session.context.sources.length,2);assert.deepEqual(session.context.gains.map(g=>g.gain.value),[.5,.5]);
  for(const source of session.context.sources)assert.equal(source.connections[0].connections[0].connections[0],session.context.destination);
  session.setPaused(true);for(const s of [system,mic,session.stream])assert.equal(s.getAudioTracks()[0].enabled,false);
  session.setPaused(false);assert.equal(mic.getAudioTracks()[0].enabled,true);
  session.stop();session.stop();for(const s of [system,mic,session.stream])for(const t of s.getTracks())assert.equal(t.stops,1);
  assert.equal(session.context.closed,1);
});
test('microphone denial releases an already acquired display stream',async()=>{
  const {options,system}=setup({mediaDevices:{getUserMedia:async()=>{throw new DOMException('denied','NotAllowedError');}}});
  await assert.rejects(acquireAudio(options),/Microphone access is blocked/);
  assert.ok(system.getTracks().every(t=>t.stops===1));
});
test('cancellation during a permission prompt releases the late microphone stream',async()=>{
  let valid=true,resolveMic,opened;const ready=new Promise(r=>opened=r);
  const {options,system,mic}=setup({isCurrent:()=>valid,mediaDevices:{getUserMedia:()=>{opened();return new Promise(r=>resolveMic=r);}}});
  const pending=acquireAudio(options);await ready;valid=false;resolveMic(mic);
  await assert.rejects(pending,{name:'AbortError'});for(const s of [system,mic])assert.ok(s.getTracks().every(t=>t.stops===1));
});
test('cancellation after display selection never opens the microphone',async()=>{
  let valid=true,micOpened=false;const {options,system}=setup({isCurrent:()=>valid,mediaDevices:{getUserMedia:async()=>{micOpened=true;return new Stream();}}});
  options.getSystemStream=async()=>{valid=false;return system;};await assert.rejects(acquireAudio(options),{name:'AbortError'});
  assert.equal(micOpened,false);assert.ok(system.getTracks().every(t=>t.stops===1));
});
test('loss of either physical input stops both sources and reports which disconnected',async()=>{
  let ended;const {options,system,mic}=setup({onEnded:kind=>ended=kind});const session=await acquireAudio(options);
  mic.getAudioTracks()[0].onended();assert.equal(ended,'mic');assert.ok(system.getTracks().every(t=>t.stops===1));assert.equal(session.context.closed,1);
});
test('missing loopback audio fails clearly and releases screen video',async()=>{
  const silent=new Stream([new Track('video')]);const {options}=setup({getSystemStream:async()=>silent});
  await assert.rejects(acquireAudio(options),/No computer audio/);assert.equal(silent.getTracks()[0].stops,1);
});
test('microphone-only mode uses the chosen device and never opens display capture',async()=>{
  let constraints;const {options}=setup({mode:'mic',microphoneId:'chosen',getSystemStream:()=>{throw new Error('Unexpected display request');},mediaDevices:{getUserMedia:async c=>{constraints=c;return new Stream();}}});
  const session=await acquireAudio(options);assert.equal(constraints.audio.deviceId.exact,'chosen');assert.equal(constraints.audio.echoCancellation,false);assert.equal(constraints.audio.noiseSuppression,false);assert.equal(session.context.gains[0].gain.value,1);session.stop();
});
test('typed mode does not request either recording source',async()=>{
  const {options}=setup({mode:'text',getSystemStream:()=>{throw new Error('must not record');}});assert.equal(await acquireAudio(options),null);
});
test('hybrid capture opens both inputs without noise suppression of the phone voice',async()=>{
 let constraints;const {options,system}=setup({mode:'hybrid',mediaDevices:{getUserMedia:async c=>{constraints=c;return new Stream();}}});
 const session=await acquireAudio(options);assert.deepEqual(session.inputs.map(i=>i.kind),['system','mic']);
 assert.equal(constraints.audio.echoCancellation,true);assert.equal(constraints.audio.noiseSuppression,false);assert.equal(constraints.audio.autoGainControl,true);
 session.stop();assert.ok(system.getTracks().every(t=>t.stops===1));
});
test('incremental WAIT and incomplete ANSWER prefixes preserve the previous answer',()=>{
  for(const text of ['W','WAIT','A','ANSWER:','ANSWER: \n'])assert.equal(turnDecision(text),'pending');
  assert.equal(turnDecision('WAIT: Candidate is answering.'),'wait');
  assert.equal(turnDecision('ANSWER: I built it.'),'answer');
});
test('losing display audio during a microphone permission prompt releases the late microphone too',async()=>{
 let resolveMic,ready;const started=new Promise(r=>ready=r);let ended;
 const {options,system,mic}=setup({onEnded:kind=>ended=kind,mediaDevices:{getUserMedia:()=>{ready();return new Promise(r=>resolveMic=r);}}});
 const capture=acquireAudio(options);await started;system.getAudioTracks()[0].onended();resolveMic(mic);await assert.rejects(capture,{name:'AbortError'});assert.equal(ended,'system');assert.ok(mic.getTracks().every(t=>t.stops===1));
});
test('audio engine start failure releases every acquired physical track',async()=>{
 class BrokenContext extends Context{async resume(){throw new Error('Audio device unavailable.');}}
 const {options,system,mic}=setup({AudioContextClass:BrokenContext});await assert.rejects(acquireAudio(options),/Audio device unavailable/);for(const s of [system,mic])assert.ok(s.getTracks().every(t=>t.stops===1));
});
test('a stale already-ended source fails before creating an apparently live connection',async()=>{
 const {options,system}=setup();system.getAudioTracks()[0].readyState='ended';await assert.rejects(acquireAudio(options),/already disconnected/);assert.ok(system.getTracks().every(t=>t.stops===1));
});
for(const name of ['NotFoundError','OverconstrainedError','NotReadableError'])test('microphone '+name+' provides recovery guidance and releases display capture',async()=>{
 const {options,system}=setup({mediaDevices:{getUserMedia:async()=>{throw new DOMException('detail',name);}}});await assert.rejects(acquireAudio(options),/microphone/);assert.ok(system.getTracks().every(t=>t.stops===1));
});
