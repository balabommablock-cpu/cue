import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('distributed defaults are blank and onboarding is enabled', async () => {
  const seed = JSON.parse(await readFile(new URL('../public/seed.json', import.meta.url)));
  const background = JSON.parse(await readFile(new URL('../background.json', import.meta.url)));
  assert.equal(seed.profile, ''); assert.equal(seed.firstRunSetup, true); assert.deepEqual(background.records, []); assert.deepEqual(background.sources, []);
});
test('Community isolates data and does not load a developer workspace by default', async () => {
  const source = await readFile(new URL('../desktop.cjs', import.meta.url), 'utf8');
  assert.match(source, /Cue Community/); assert.doesNotMatch(source, /\/Users\/[a-z]+/i);
});
