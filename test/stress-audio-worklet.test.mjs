import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code=await readFile(new URL('../public/pcm-worklet.js',import.meta.url),'utf8');
for(const rate of [16000,44100,48000,96000])test('audio worklet retains 16 kHz timing from a '+rate+' Hz input',()=>{
 const chunks=[];let Processor;vm.runInNewContext(code,{sampleRate:rate,Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage:x=>chunks.push(x)};}},registerProcessor:(_n,p)=>Processor=p});const processor=new Processor();
 const frames=Math.floor(rate*2/128);for(let i=0;i<frames;i++)processor.process([[new Float32Array(128).fill(.1),new Float32Array(128).fill(.3)]]);
 const total=chunks.reduce((n,x)=>n+x.length,0)+processor.samples.length;assert.ok(Math.abs(total-frames*128*16000/rate)<2);assert.ok(chunks.every(x=>x.every(n=>Math.abs(n-.2)<.00001)));assert.ok(chunks.every(x=>x.length<=1728));
});
test('audio worklet stays alive when an input is temporarily missing',()=>{
 let Processor;vm.runInNewContext(code,{sampleRate:48000,Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},registerProcessor:(_n,p)=>Processor=p});const processor=new Processor();assert.equal(processor.process([]),true);assert.equal(processor.process([[]]),true);assert.equal(processor.samples.length,0);
});
