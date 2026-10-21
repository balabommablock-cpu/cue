import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {dataDirectory} from '../desktop-data.cjs';
test('an existing main Cue installation retains its data when Community data also exists',()=>{
 assert.equal(dataDirectory('/example/app-data',()=>true),join('/example/app-data','Cue'));
});
test('a Community-only user retains that folder without copying or mixing accounts',()=>{
 assert.equal(dataDirectory('/example/app-data',p=>p.endsWith('Cue Community')),join('/example/app-data','Cue Community'));
});
test('a clean machine starts in the main Cue folder',()=>{
 assert.equal(dataDirectory('/example/app-data',()=>false),join('/example/app-data','Cue'));
});
