import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sameUtterance,matchReading,turnRoute} from '../public/reading.js';
import {SpeechPipeline} from '../public/speech-pipeline.js';

const tick=()=>new Promise(r=>setImmediate(r));
for(const [left,right] of [
 ['Why did you choose growth over profitability?','Why did you choose profitability over growth?'],
 ['Why did you hire that person for the team?','Why did you not hire that person for the team?'],
 ['How did you reach 40 crore in six months?','How did you reach 20 crore in six months?'],
 ['How did you change the team after launch?','Why did you change the team after launch?'],
 ['What did you learn from the failed launch?','What did you learn from the successful launch?'],
])test('changed meaning survives echo filtering: '+right,()=>assert.equal(sameUtterance(left,right),false));

test('several final interviewer chunks retain chronological order under decoder backlog',async()=>{
 let release;const seen=[];const pipe=new SpeechPipeline({transcribe:pcm=>pcm==='busy'?new Promise(r=>release=r):Promise.resolve(pcm),onTranscript:x=>seen.push(x.text)});
 pipe.push({pcm:'busy',source:'mic',final:false});
 for(const pcm of ['First, explain the launch.','Then, tell me what failed.','Finally, what would you change?'])pipe.push({pcm,source:'system',final:true});
 release('busy');await tick();assert.deepEqual(seen,['busy','First, explain the launch.','Then, tell me what failed.','Finally, what would you change?']);pipe.stop();
});

test('decoder failure does not strand the next question',async()=>{
 const seen=[],errors=[];const pipe=new SpeechPipeline({transcribe:async pcm=>{if(pcm==='bad')throw new Error('decoder failed');return pcm;},onTranscript:x=>seen.push(x.text),onError:e=>errors.push(e.message)});
 pipe.push({pcm:'bad',source:'system',final:true});pipe.push({pcm:'good',source:'system',final:true});await tick();assert.deepEqual(seen,['good']);assert.deepEqual(errors,['decoder failed']);pipe.stop();
});

test('microphone candidate rhetoric in dual mode remains context',()=>{
 assert.equal(turnRoute({text:'Why did I do that? Because customers were stuck.',source:'mic',hasAnswer:true,dual:true}),'context');
});
test('microphone practice passes an indirect question to the intent checker',()=>{
 assert.equal(turnRoute({text:'You mentioned a launch. Let us talk about the difficult part.',source:'mic',hasAnswer:true,dual:false}),'answer');
});
test('unrelated generic words cannot jump more than sixty words down the answer',()=>{
 const script='Start with the customer. '+Array(25).fill('A specific measured outcome.').join(' ')+' I think this is the best approach.';
 assert.equal(matchReading(script,'I think this is the best',0),null);
});
