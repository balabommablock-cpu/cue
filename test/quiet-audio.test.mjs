import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QuestionSegmenter} from '../public/local-audio.js';
const tone=(level,n=1600)=>Float32Array.from({length:n},(_,i)=>Math.sin(i*.2)*level);
const silence=()=>new Float32Array(1600);

test('quiet computer speech below the room-microphone threshold still produces each question',()=>{
 const heard=[];const system=new QuestionSegmenter(p=>heard.push(p),()=>{},{voiceThreshold:.002,silenceMs:450});
 for(let turn=0;turn<3;turn++){for(let i=0;i<12;i++)system.push(tone(.006));for(let i=0;i<7;i++)system.push(silence());}
 assert.equal(heard.length,3);assert.ok(heard.every(p=>p.length>=16000));
});
test('lower computer threshold does not turn a digital noise floor or a click into a question',()=>{
 let count=0;const s=new QuestionSegmenter(()=>count++,()=>{},{voiceThreshold:.002,silenceMs:450});
 for(let i=0;i<20;i++)s.push(tone(.0004));s.push(tone(.15));for(let i=0;i<10;i++)s.push(silence());assert.equal(count,0);
});
test('room microphone retains its higher noise threshold',()=>{
 let count=0;const s=new QuestionSegmenter(()=>count++,()=>{},{silenceMs:450});
 for(let i=0;i<20;i++)s.push(tone(.006));for(let i=0;i<10;i++)s.push(silence());assert.equal(count,0);
});
