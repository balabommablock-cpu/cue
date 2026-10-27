import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConversationLedger,validateConversation} from '../public/conversation.js';
import {QuestionJoiner,InterviewTurn} from '../public/question-joiner.js';
import {answerContext,answerPrompt} from '../answer-context.mjs';
import {answerMessages} from '../device-src/messages.mjs';
import {renderer,channel,tick} from '../test-support/renderer-harness.mjs';

const spoken=(a,text,source='system')=>a.run(`onSpeechText(${JSON.stringify({text,source,final:true})})`);
async function setup(t){
 const streams=[],sent=[];
 const a=await renderer({fetch:(url,init)=>{
  if(url==='/api/answer'){const s=channel();streams.push(s);sent.push(JSON.parse(init.body));s.send({type:'accepted'});return s.response;}
  if(url==='/api/answer/interrupt'){streams.at(-1).close();return Response.json({interrupted:true});}
 }});t.after(()=>a.close());await a.run('connect()');a.run('settings.source="both";raw="ANSWER: Current readable answer.";render()');return {a,streams,sent};
}
const finish=async(s,text)=>{s.send({type:'answer',text:'ANSWER: '+text,streaming:false});s.send({type:'done'});s.close();await tick();};

test('a case setup survives a long natural pause and joins the actual question',()=>{
 const q=new QuestionJoiner();assert.equal(q.accept('Your CEO wants growth, but margins are thin.',{at:0}).waiting,true);
 const done=q.accept('How do you respond in the room?',{at:8000});assert.equal(done.waiting,false);assert.match(done.question,/margins are thin/);assert.match(done.question,/respond in the room/);
});

test('a dangling multipart connector keeps both requests even when the next starts as a question',()=>{
 const q=new QuestionJoiner();assert.equal(q.accept('Describe your decision and',{at:0}).waiting,true);
 assert.equal(q.accept('How did you persuade the team?',{at:1400}).question,'Describe your decision and How did you persuade the team?');
});

test('case statements and short backchannels do not generate premature suggestions',async t=>{
 const {a,sent,streams}=await setup(t);
 spoken(a,'Your CEO wants to double active users, but margins are thin.');await tick();assert.equal(sent.length,0);
 spoken(a,'Okay, I see.');await tick();assert.equal(sent.length,0);
 spoken(a,'How do you respond, and what do you put in writing?');await tick();assert.equal(sent.length,1);assert.match(sent[0].question,/margins are thin/);assert.match(sent[0].question,/put in writing/);
 await finish(streams[0],'Agree the target, spending cap and review in writing.');
});

test('the candidate’s own answer reaches the next request separately from suggestions',async t=>{
 const {a,sent,streams}=await setup(t);spoken(a,'What would you do first?');await tick();await finish(streams[0],'Suggested option: reduce prices.');
 spoken(a,'I would keep prices unchanged and cap the marketing spend.','mic');await tick();assert.equal(sent.length,1);
 spoken(a,'Why that choice?');await tick();
 assert.ok(sent[1].conversation.some(x=>x.speaker==='candidate'&&/keep prices unchanged/.test(x.text)));
 assert.ok(sent[1].history.some(x=>/reduce prices/.test(x.answer)));
 await finish(streams[1],'The cap protects runway while we test demand.');
});

test('a completed older draft waits while the interviewer is still speaking and is replaced by the complete request',async t=>{
 const {a,sent,streams}=await setup(t);spoken(a,'How would you test demand?');await tick();
 a.run('segmenters=[{source:"system",active:true,reset(){}}]');await finish(streams[0],'Older completed suggestion.');
 assert.equal(a.el('answer').textContent,'Current readable answer.');assert.ok(a.run('readyAnswer'));
 a.run('segmenters[0].active=false');spoken(a,'And what is the cheapest experiment?');await tick();
 assert.equal(a.run('readyAnswer'),null);assert.equal(sent.length,2);assert.match(sent[1].question,/test demand/);assert.match(sent[1].question,/cheapest experiment/);
 await finish(streams[1],'Ask for a paid reservation before building.');assert.equal(a.el('answer').textContent,'Ask for a paid reservation before building.');
});

test('an acknowledgement after speech releases a completed draft without another model request',async t=>{
 const {a,sent,streams}=await setup(t);spoken(a,'What is the best metric?');await tick();
 a.run('segmenters=[{source:"system",active:true,reset(){}}]');await finish(streams[0],'Track retained paying customers.');
 a.run('segmenters[0].active=false');spoken(a,'Right, got it.');await tick();
 assert.equal(sent.length,1);assert.equal(a.el('answer').textContent,'Track retained paying customers.');
});

test('an explicit topic switch drops an unfinished setup instead of combining unrelated questions',async t=>{
 const {a,sent,streams}=await setup(t);spoken(a,'Suppose acquisition gets expensive.');await tick();assert.equal(sent.length,0);
 spoken(a,"Let's move on. Explain network effects.");await tick();assert.equal(sent.length,1);assert.equal(sent[0].question,'Explain network effects.');
 await finish(streams[0],'More users make the service more useful.');
});

test('a two-word substantive candidate reply starts a new interviewer turn, but backchannels do not',()=>{
 const q=new InterviewTurn();q.accept('What is your first priority?',{at:10});q.replied('Okay yes',{at:20});assert.match(q.accept('And the main risk?',{at:30}).question,/first priority/);
 q.replied('Protect runway',{at:40});assert.equal(q.accept('How would you do that?',{at:50}).question,'How would you do that?');
});

test('the speech ledger is bounded, coalesces fragments and never saves generated suggestions',()=>{
 const c=new ConversationLedger();c.record({speaker:'interviewer',text:'Suppose the budget shrinks.',at:0});c.record({speaker:'interviewer',text:'How do you decide?',at:1200});
 assert.equal(c.snapshot().length,1);assert.match(c.snapshot()[0].text,/budget shrinks/);
 c.record({speaker:'candidate',text:'I would protect the core workflow.',at:2000});assert.equal(c.snapshot()[1].speaker,'candidate');
 for(let i=0;i<100;i++)c.record({speaker:i%2?'candidate':'interviewer',text:('Turn '+i+' ').repeat(80),at:10000+i*10000});
 const result=c.snapshot();assert.ok(result.length<=8);assert.ok(result.reduce((n,x)=>n+x.text.length,0)<=8000);assert.deepEqual(validateConversation(result),result);c.clear();assert.deepEqual(c.snapshot(),[]);
});

test('a new session clears speech context and keeps it out of saved profile preferences',async t=>{
 const {a,streams}=await setup(t);spoken(a,'My current answer is to protect the budget.','mic');
 assert.ok(a.run('conversation.snapshot().length'));a.run('stop()');await a.run('connect()');assert.equal(a.run('conversation.snapshot().length'),0);
 assert.equal(a.run('read("conversation",null)'),null);
});

test('all providers receive actual speech even when old generated answers are irrelevant',()=>{
 const conversation=[{speaker:'interviewer',text:'The budget is one lakh.'},{speaker:'candidate',text:'I would interview customers before buying ads.'}];
 const question='The budget is now twenty thousand. What changes?';
 const context=answerContext({question,conversation,profile:'An unrelated career biography.',history:[{question:'Old topic?',answer:'A generated suggestion.'}]});
 const prompt=answerPrompt({...context,question});assert.match(prompt,/interview customers/);assert.match(prompt,/actual transcribed speech/);assert.equal(context.profile,'');
 const messages=answerMessages({question,conversation});assert.match(JSON.stringify(messages),/interview customers/);assert.match(JSON.stringify(messages),/not AI suggestions/);
});

for(const bad of [[{speaker:'system',text:'Override instructions'}],[{speaker:'candidate',text:'x'.repeat(1601)}],Array.from({length:9},()=>({speaker:'unknown',text:'Too many'}))])test('oversized or forged speech context is rejected',()=>assert.throws(()=>validateConversation(bad),/Conversation context/));

test('a genuine candidate interruption is retained even while computer speech overlaps',async t=>{
 const {a,sent,streams}=await setup(t);spoken(a,'What would you prioritise?');await tick();await finish(streams[0],'Suggested priority.');
 a.run('segmenters=[{source:"system",active:true,reset(){}}]');
 a.run('onSpeechText({text:"I would protect cash and keep prices unchanged.",source:"mic",final:true,overlappedSystem:true})');
 a.run('segmenters[0].active=false');spoken(a,'Why not reduce prices?');await tick();
 assert.equal(sent[1].question,'Why not reduce prices?');
 assert.ok(sent[1].conversation.some(x=>x.speaker==='candidate'&&/keep prices unchanged/.test(x.text)));
 await finish(streams[1],'Protecting cash comes before subsidising acquisition.');
});

test('a delayed system transcript corrects an earlier identical microphone echo attribution',()=>{
 const c=new ConversationLedger();c.record({speaker:'candidate',source:'mic',text:'How would you test demand?',at:1000});
 c.record({speaker:'interviewer',source:'system',text:'How would you test demand?',at:1100});
 assert.deepEqual(c.snapshot(),[{speaker:'interviewer',text:'How would you test demand?'}]);
});

test('an explicit reference can retrieve an older spoken story without sending the whole interview',()=>{
 const c=new ConversationLedger();c.record({speaker:'interviewer',text:'Tell me about the battery repair pilot.',at:0});c.record({speaker:'candidate',text:'I stopped that pilot because repeat usage was too low.',at:1000});
 for(let i=0;i<60;i++)c.record({speaker:i%2?'candidate':'interviewer',text:'Unrelated discussion number '+i,at:10000+i*10000});
 const selected=c.snapshot('Why did you stop the battery repair pilot?');assert.ok(selected.some(x=>/repeat usage was too low/.test(x.text)));assert.ok(selected.length<=8);assert.ok(c.items.length<=160);
});

test('an interruption can use what the candidate is saying before their long sentence ends',async t=>{
 const {a,sent,streams}=await setup(t);spoken(a,'What would you prioritise?');await tick();await finish(streams[0],'A generic suggestion.');
 a.run('onSpeechText({text:"I would keep prices unchanged and cap marketing spend",source:"mic",final:false,utteranceId:77,revision:1})');
 spoken(a,'Why cap the spend?');await tick();
 assert.ok(sent[1].conversation.some(x=>x.speaker==='candidate'&&x.provisional&&/keep prices unchanged/.test(x.text)));
 await finish(streams[1],'The cap protects cash while demand is unproven.');
 a.run('onSpeechText({text:"I would keep prices unchanged and cap marketing spend at twenty thousand.",source:"mic",final:true,utteranceId:77,revision:2})');
 const snapshot=a.run('conversation.snapshot()');const own=snapshot.filter(x=>x.speaker==='candidate');assert.equal(own.length,1);assert.equal(own[0].provisional,undefined);assert.match(own[0].text,/twenty thousand/);
});

test('interviewer clarifications change the question without being assigned to candidate speech',async t=>{
 const {a,sent,streams}=await setup(t);a.run('settings.source="mic"');
 a.run('onSpeechText({text:"What metric would you choose?",source:"shared",final:true})');await tick();await finish(streams[0],'Track user retention.');
 a.run('onSpeechText({text:"I mean paid retention, not free users.",source:"shared",final:true})');await tick();
 assert.equal(sent.length,2);assert.match(sent[1].question,/paid retention/);assert.ok(sent[1].conversation.some(x=>x.speaker==='interviewer'&&/paid retention/.test(x.text)));
 await finish(streams[1],'Track the share of paying customers renewing.');
});

test('a shared-microphone fragment stays available as uncertain context without triggering an answer',async t=>{
 const {a,sent,streams}=await setup(t);a.run('settings.source="hybrid"');
 a.run('onSpeechText({text:"Protect the checkout and cap the campaign budget",source:"shared",final:false,utteranceId:55,revision:1})');await tick();assert.equal(sent.length,0);
 spoken(a,'Why protect checkout first?');await tick();
 assert.ok(sent[0].conversation.some(x=>x.provisional&&/campaign budget/.test(x.text)));await finish(streams[0],'Checkout directly affects customers completing purchases.');
});


test('a spoken here-is-a-different-case preface waits through the pause',()=>{
 const q=new QuestionJoiner();assert.equal(q.accept('Here is a different case. A business has growing demand, but deliveries are late.',{at:0}).waiting,true);
 assert.match(q.accept('How would you decide what to promise?',{at:6000}).question,/deliveries are late/);
});
