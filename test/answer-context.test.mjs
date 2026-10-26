import {test} from 'node:test';
import assert from 'node:assert/strict';
import {answerContext,answerPrompt,questionMode} from '../answer-context.mjs';
import {createKnowledge} from '../knowledge.mjs';
import {writingOptions,closeLocal} from '../local-provider.mjs';
const source={id:'test',title:'Synthetic',detail:'Test data'};
const fact={id:'career',kind:'fact',title:'Career',source:'test',topics:'consumer product',text:'UNRELATED_APPLICATION_STORY',note:''};
const external={id:'rule',kind:'research',title:'Current policy',source:'test',topics:'consumer technology eligibility',text:'Current external policy',note:'Verified source, not candidate history',url:'https://example.com/faq',checkedAt:'2026-10-01',validUntil:'2026-10-09'};
const bank={records:[fact,external]},profile='UNRELATED_CAREER_PROFILE';
test('concepts and hypothetical reasoning do not carry unrelated career stories or the full fact sheet',()=>{
 for(const q of ['What is consumer tech?','Can you explain consumer tech?','Tell me what consumer tech is.','How does a network effect work?','Explain network effects.','Suppose an app loses money on each order. What would you change?','How would you design an app for keys?','If employers pay, is a job app still consumer technology?','Your proposed product increases clicks but reduces purchases. What would you decide?']){
  const result=answerContext({question:q,profile,knowledge:bank,now:new Date('2026-10-02')});assert.equal(result.profile,'',q);assert.ok(result.knowledge.records.every(r=>r.kind==='research'),q);assert.doesNotMatch(answerPrompt({...result,question:q}),/UNRELATED_/);
 }
});
test('personal-history and mixed questions keep grounded evidence',()=>{
 for(const q of ['What did you build?','Why did you leave your job?','What does your application say?','How would you apply what you learned from your launch?','What are your strengths?','You made 40 crore in revenue and already have a committed CTO. Why do you need an accelerator?']){
  const result=answerContext({question:q,profile,knowledge:bank,now:new Date('2026-10-02')});assert.equal(result.profile,profile,q);assert.ok(result.knowledge.records.some(r=>r.id==='career'),q);
 }
});
test('a conceptual follow-up retains the actual conversation but cannot drag in an unrelated application',()=>{
 const history=[{question:'Suppose you build a job search tool. What would it do?',answer:'Remove duplicates and expired jobs.'}],question='That is just a filter. What is defensible?';
 const result=answerContext({question,history,profile,knowledge:bank,now:new Date('2026-10-02')});const prompt=answerPrompt({...result,question,history});assert.match(prompt,/Remove duplicates/);assert.doesNotMatch(prompt,/UNRELATED_/);
 assert.equal(questionMode('What happened next?',[{question:'What did you build at your employer?',answer:'Launched.'}]),'personal');
});
test('expired external research is withheld while candidate facts remain available',()=>{
 const result=answerContext({question:'What did you build?',profile,knowledge:bank,now:new Date('2026-10-10')});assert.deepEqual(result.knowledge.records,[fact]);
});
test('research entries need source and validity dates and retain provenance through retrieval',()=>{
 const pack={schemaVersion:1,id:'test',sources:[source],records:[{...external,checkedAt:'2020-01-01',validUntil:'2099-01-01'}]};
 const entry=createKnowledge(pack).retrieve('consumer technology').records[0];assert.equal(entry.url,'https://example.com/faq');assert.equal(entry.checkedAt,'2020-01-01');
 for(const change of [{url:''},{checkedAt:'yesterday'},{validUntil:'2019-01-01'}])assert.throws(()=>createKnowledge({...pack,records:[{...pack.records[0],...change}]}),/research source/);
 const old=createKnowledge({...pack,records:[{...external,checkedAt:'2020-01-01',validUntil:'2020-01-02'}]});assert.equal(old.retrieve('consumer technology').records.length,0);
});
test('warm-up primes thinking rules without committing the whole application to every subsequent question',async t=>{
 t.after(closeLocal);const opts=await writingOptions({profile,style:'script',sessionKey:'test'});
 assert.doesNotMatch(opts.warmPrompt,/UNRELATED_/);assert.match(opts.writingInstructions,/general knowledge/);assert.match(opts.writingInstructions,/Missing evidence does not establish a negative/);assert.equal(opts.effort,'low');assert.equal(opts.model,'gpt-6-sol');assert.equal(opts.serviceTier,'priority');
});
test('general tasks and historical questions exclude career material even with polite requests',()=>{
 for(const question of ['Write a Python function to remove duplicates.','Could you please translate this sentence into Hindi: Good morning.','Please calculate 17 times 24.','Summarise this paragraph: Stars form from gas.','Tell me about photosynthesis.','Who was Darwin?','When did the French Revolution begin?','Can you solve x squared equals 16?','Debug my Python code: print(x)']){
  const context=answerContext({question,profile,knowledge:bank});assert.equal(context.mode,'general',question);assert.equal(context.profile,'',question);assert.doesNotMatch(answerPrompt({...context,question}),/UNRELATED_/);
 }
});
test('requests to write personal material still receive facts instead of a general-topic shortcut',()=>{
 for(const question of ['Write my biography.','Summarise my CV.','Tell me about yourself.','Who is the candidate?','Translate my submitted application into Hindi.']){
  const context=answerContext({question,profile,knowledge:bank});assert.equal(context.mode,'personal',question);assert.equal(context.profile,profile,question);
 }
});

test('new advice and opinion questions default to reasoning, not an application match',()=>{
 const old=[{question:'What did you build?',answer:'UNRELATED_OLD_ANSWER'}];
 for(const question of ['Sell me a pen.','How do you decide when to kill a feature?','What do you think most builders misunderstand about Indian consumers?','What do you believe makes a good product?','A product costs 800 rupees and sells for 1000. Is growth worthwhile?','Customer acquisition costs','Explain what you think of freemium.']){
  for(const autoDetect of [false,true]){
   const context=answerContext({question,history:old,profile,knowledge:bank,autoDetect});
   assert.equal(context.mode,'general',question);assert.equal(context.profile,'');assert.equal(context.knowledge.records.length,0);
   if(/^(Sell|How|What|Explain)/.test(question))assert.doesNotMatch(answerPrompt({...context,question}),/UNRELATED_/);
  }
 }
});
test('submitted narratives are retrieved only when the question explicitly asks about the submission',()=>{
 const application={...fact,id:'application',kind:'application',text:'UNCONFIRMED_STORY'};
 const knowledge={records:[fact,application]};
 assert.deepEqual(answerContext({question:'What did you build?',profile,knowledge}).knowledge.records,[fact]);
 assert.equal(answerContext({question:'What did I submit in my application?',profile,knowledge}).knowledge.records.length,2);
});
test('follow-up snapshot is bounded and a topic switch removes previous generated answers',()=>{
 const history=Array.from({length:6},(_,i)=>({question:`Question ${i}`,answer:'x'.repeat(6000)}));
 const follow=answerContext({question:'Why that choice?',history});assert.equal(follow.history.length,2);assert.ok(follow.history.every(h=>h.answer.length===2000));
 assert.deepEqual(answerContext({question:'What is inflation?',history}).history,[]);
});

test('short hypothetical follow-ups retain the numbers from the preceding case',()=>{
 const history=[{question:'CAC is 1500 and monthly gross profit is 300. What is payback?',answer:'ANSWER: Payback is 5 months.'}];
 for(const question of ['What if CAC doubles?','How about annual billing?','How so?','Tell me more.']){
  const context=answerContext({question,history,profile,knowledge:bank});
  assert.equal(context.mode,'follow-up',question);assert.equal(context.history[0].question,history[0].question);
  assert.equal(context.profile,'');assert.equal(context.knowledge.records.length,0);
 }
 assert.deepEqual(answerContext({question:'What is photosynthesis?',history}).history,[]);
});
