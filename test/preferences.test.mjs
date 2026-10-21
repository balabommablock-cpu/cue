import test from 'node:test';
import assert from 'node:assert/strict';
import { makePreset, parsePreset } from '../public/preferences-ui.js';
const valid = { font: 31, glass: 76, scrollMode: 'steady', scrollSpeed: 18, style: 'cues', auto: true };
test('export keeps only portable reading preferences, never notes or credentials', () => {
  const result = makePreset({ ...valid, profile: 'PRIVATE NOTES', apiKey: 'PRIVATE KEY', account: 'PRIVATE ACCOUNT', microphone: 'PRIVATE DEVICE' });
  assert.deepEqual(result, { kind: 'cue.preferences', version: 1, ...valid });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
test('a preferences round trip preserves every permitted setting', () => assert.deepEqual(parsePreset(JSON.parse(JSON.stringify(makePreset(valid)))), makePreset(valid)));
test('malicious or mistaken account/context imports cannot modify preferences', () => {
  for (const extra of [{ profile: 'notes' }, { token: 'secret' }, JSON.parse('{"__proto__":{"polluted":true}}')]) assert.throws(() => parsePreset({ ...makePreset(valid), ...extra }), /unsupported fields/);
  assert.equal({}.polluted, undefined);
});
test('invalid and extreme settings fail before changing the UI', () => {
  for (const change of [{ font: 1000 }, { glass: -1 }, { scrollSpeed: NaN }, { auto: 'yes' }, { scrollMode: 'execute' }, { version: 9 }, { kind: 'other' }]) assert.throws(() => parsePreset({ ...makePreset(valid), ...change }));
});
