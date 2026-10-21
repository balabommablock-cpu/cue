import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderer} from '../test-support/renderer-harness.mjs';

test('auto-scroll works without a microphone or literal voice match, preserving the opening',async t=>{
 const a=await renderer();t.after(()=>a.close());
 await a.run('connect()');a.run('raw="ANSWER: A long answer with enough detail to fill the visible window.";render()');
 assert.equal(a.el('scrollMode').value,'steady');
 a.animate(1000);assert.equal(a.el('answerFrame').scrollTop,0);
 a.animate(4000);assert.ok(a.el('answerFrame').scrollTop>20);
 assert.ok(a.el('answerFrame').scrollTop<150,'must not jump to the end');
 a.run('stop()');const at=a.el('answerFrame').scrollTop;a.animate(4000);assert.equal(a.el('answerFrame').scrollTop,at);
});
test('a short answer never moves; appended streaming text becomes scrollable without restarting the reader',async t=>{
 const a=await renderer();t.after(()=>a.close());await a.run('connect()');
 a.el('answerFrame').scrollHeight=200;a.run('raw="ANSWER: Short answer.";render()');a.animate(3000);assert.equal(a.el('answerFrame').scrollTop,0);
 a.el('answerFrame').scrollHeight=1400;a.run('raw+=" More useful details arrived.";render()');a.animate(4000);
 const at=a.el('answerFrame').scrollTop;assert.ok(at>0);
 a.run('raw+=" The last point.";render()');a.animate(4000);assert.ok(a.el('answerFrame').scrollTop>at);
});
test('scroll holds resume automatically and a new answer starts at the top',async t=>{
 const a=await renderer();t.after(()=>a.close());await a.run('connect()');a.run('raw="ANSWER: Readable content.";render()');
 a.animate(4000);a.el('answerFrame').events.wheel();const at=a.el('answerFrame').scrollTop;a.animate(3000);assert.equal(a.el('answerFrame').scrollTop,at);
 await a.advance(5000);a.animate(4000);assert.ok(a.el('answerFrame').scrollTop>at);
 a.run('resetDisplay();raw="ANSWER: A different answer.";render()');assert.equal(a.el('answerFrame').scrollTop,0);
 a.animate(1000);assert.equal(a.el('answerFrame').scrollTop,0);
});
test('opening display settings pauses movement without losing the reading position',async t=>{
 const a=await renderer();t.after(()=>a.close());await a.run('connect()');a.run('raw="ANSWER: Readable content.";render()');a.animate(4000);
 a.el('displayButton').click();const at=a.el('answerFrame').scrollTop;a.animate(4000);assert.equal(a.el('answerFrame').scrollTop,at);
 a.el('closeDisplay').click();a.animate(4000);assert.ok(a.el('answerFrame').scrollTop>at);
});
