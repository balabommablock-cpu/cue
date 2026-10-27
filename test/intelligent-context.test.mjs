import {test} from 'node:test';
import assert from 'node:assert/strict';
import {answerContext,answerPrompt,questionMode} from '../answer-context.mjs';
import {makeMessages,EMPTY_PROFILE} from '../device-src/context.mjs';
const profile='CV_ONLY_ANCHOR: Built trading software. Strength: product delivery. Wants consumer tech, has not picked an idea.';
for(const question of ['Suppose your team has five engineers and only three weeks of cash. What should you stop?','Your company has 80% satisfaction but 10% retention. How would you investigate?','How would you design incentives for your team without encouraging shortcuts?'])test('imagined case is reasoned about without pulling in the CV: '+question,()=>{
 const c=answerContext({question,profile});assert.equal(c.mode,'scenario');assert.equal(c.profile,'');assert.doesNotMatch(answerPrompt({...c,question}),/CV_ONLY_ANCHOR/);
 assert.doesNotMatch(JSON.stringify(makeMessages(question,{...EMPTY_PROFILE,facts:profile})),/CV_ONLY_ANCHOR/);
});
for(const question of ['Given my experience, what consumer business should I build first?','What should I focus on next in my career?','How would you apply what you learned from your launch?'])test('tailored advice uses experience as a starting point for a new recommendation: '+question,()=>{
 const c=answerContext({question,profile});assert.equal(c.mode,'personal-advice');assert.equal(c.profile,profile);const prompt=answerPrompt({...c,question});assert.match(prompt,/Proposals may be new/);assert.match(prompt,/Do not answer by reciting experience/);
 const messages=makeMessages(question,{...EMPTY_PROFILE,facts:profile});assert.match(JSON.stringify(messages),/CV_ONLY_ANCHOR/);assert.doesNotMatch(messages.at(-1).content,/For this personal answer, use only/);
});
test('past achievements remain grounded while interpretations may be reasoned conclusions',()=>{
 assert.equal(questionMode('What did you personally do at the company?'),'personal');const c=answerContext({question:'What did you personally do?',profile});assert.equal(c.profile,profile);
 const p=answerPrompt({...c,question:'What did you personally do?'});assert.match(p,/CAREER FACTS/);
});
