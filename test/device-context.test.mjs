import test from 'node:test';
import assert from 'node:assert/strict';
import {makeMessages,EMPTY_PROFILE,visibleAnswer} from '../device-src/context.mjs';
test('numerical questions request reasoning; conversational questions keep the fast path',()=>{
 for(const q of ['Calculate the probability of drawing two aces.','A price rises from 80 to 100. What is the percentage increase?','Solve x squared minus four equals zero.'])assert.match(makeMessages(q,EMPTY_PROFILE).at(-1).content,/\/think$/);
 assert.match(makeMessages('Explain how to prioritise a product feature.',EMPTY_PROFILE).at(-1).content,/\/no_think$/);
 assert.match(makeMessages('Tell me about a time you improved support.',EMPTY_PROFILE).at(-1).content,/\/think$/);
});
test('partial thinking tags and internal reasoning never appear in the answer area',()=>{
 for(const value of ['<','<thi','<think>','<think>internal calculation'])assert.equal(visibleAnswer(value),'');
 assert.equal(visibleAnswer('<think>internal calculation</think>\n20%.'),'20%.');
});
