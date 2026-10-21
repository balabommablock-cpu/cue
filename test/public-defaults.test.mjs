import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('distributed defaults are blank and onboarding is enabled', async () => {
  const seed = JSON.parse(await readFile(new URL('../public/seed.json', import.meta.url)));
  const background = JSON.parse(await readFile(new URL('../background.json', import.meta.url)));
  assert.equal(seed.profile, ''); assert.equal(seed.firstRunSetup, true); assert.deepEqual(background.records, []); assert.deepEqual(background.sources, []);
});
test('Cue uses its explicit local data directory and has no developer workspace path', async () => {
  const source = await readFile(new URL('../desktop.cjs', import.meta.url), 'utf8');
  assert.match(source, /desktop-data\.cjs/); assert.doesNotMatch(source, /\/Users\/[a-z]+/i);
});
