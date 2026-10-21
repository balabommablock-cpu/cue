import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchReading,sameUtterance,explicitQuestion,words,turnRoute} from '../public/reading.js';
import {QuestionSegmenter} from '../public/local-audio.js';
import {SpeechPipeline} from '../public/speech-pipeline.js';

const script='I built a trading platform with one new front-end developer. Before we started writing code, I spent a week studying the existing requirements and product flows. I broke the work into small tasks, so we could move quickly without losing track of the experience. We delivered a live product with basic trading workflows.';
test('reading follows consecutive phrases and never rewinds during a repeated phrase',()=>{
 const first=matchReading(script,'I built a trading platform with one new front end developer');assert.equal(first.wordIndex,11);
 const next=matchReading(script,'Before we started writing code I spent a week studying the existing requirements and product flows',first.wordIndex);assert.ok(next.wordIndex>first.wordIndex);
 const stutter=matchReading(script,'a week studying the existing requirements and product flows',next.wordIndex);assert.ok(stutter.wordIndex>=next.wordIndex);
});
test('reading tolerates fillers, punctuation and a skipped word',()=>{
 const result=matchReading(script,'Well, um, I built a trading platform with a new front end developer');assert.ok(result);assert.ok(result.confidence>=.65);
 assert.equal(words('₹40 crore — I’m here.')[0].word,'40');
});
test('unrelated speech and short generic fragments do not move the script',()=>{
 assert.equal(matchReading(script,'can you explain your strongest leadership experience'),null);
 assert.equal(matchReading(script,'I think so'),null);
 assert.equal(matchReading(script,'small tasks with no mention of the platform and unrelated recipes'),null);
});
test('explicit questions are identifiable before suppressing a spoken readback',()=>{
 for(const q of ['What would you change?','So, tell me about the project.','Can you explain that?'])assert.equal(explicitQuestion(q),true);
 assert.equal(explicitQuestion('I built a product and then tested it.'),false);
});
test('echo comparison tolerates punctuation but distinguishes a follow-up',()=>{
 assert.equal(sameUtterance('Tell me about a time you built something with a small team.','Tell me about a time you built something with a small team'),true);
 assert.equal(sameUtterance('What did you build?','Why did you build it?'),false);
});
test('long speech produces bounded partial readbacks, then a final segment',()=>{
 const partial=[],final=[];const part=new QuestionSegmenter(s=>final.push(s),()=>{},{silenceMs:650,onPartial:s=>partial.push(s)});
 for(let i=0;i<95;i++)part.push(new Float32Array(1600).fill(.06));
 assert.equal(partial.length,3);assert.ok(partial.every(p=>p.length<=88000));
 for(let i=0;i<7;i++)part.push(new Float32Array(1600));assert.equal(final.length,1);
 part.reset();assert.equal(part.active,false);
});
test('decoder gives a final computer question precedence over queued microphone previews',async()=>{
 let release,first=true;const decoded=[],done=[];
 const pipeline=new SpeechPipeline({transcribe:async pcm=>{decoded.push(pcm);if(first){first=false;await new Promise(r=>release=r);}return pcm;},onTranscript:x=>done.push(x.text)});
 pipeline.push({pcm:'active',source:'mic',final:false});
 pipeline.push({pcm:'outdated preview',source:'mic',final:false});
 pipeline.push({pcm:'new preview',source:'mic',final:false});
 pipeline.push({pcm:'question',source:'system',final:true});release();
 await new Promise(r=>setTimeout(r,10));assert.deepEqual(decoded,['active','question','new preview']);assert.equal(done.length,3);pipeline.stop();
});
test('late transcription after Stop never updates the conversation',async()=>{
 let release,updates=0;const pipeline=new SpeechPipeline({transcribe:()=>new Promise(r=>release=r),onTranscript:()=>updates++});
 pipeline.push({pcm:'sample',source:'mic',final:true});pipeline.stop();release('private speech');await new Promise(r=>setTimeout(r,0));assert.equal(updates,0);
});

test('acknowledgements and ordinary candidate responses do not consume a model request',()=>{
 assert.equal(turnRoute({text:'Thank you.',source:'system',hasAnswer:true}),'ack');
 assert.equal(turnRoute({text:'I learned the requirements and worked with one developer.',source:'mic',hasAnswer:true,dual:true}),'context');
 assert.equal(turnRoute({text:'How would you approach it?',source:'mic',hasAnswer:true}),'answer');
 assert.equal(turnRoute({text:'Tell me about a failure.',source:'system',hasAnswer:true}),'answer');
 assert.equal(turnRoute({text:'I learned the requirements.',source:'mic',hasAnswer:true,forced:true}),'answer');
});
