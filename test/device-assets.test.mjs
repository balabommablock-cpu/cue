import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('model assets are local static files, with traversal and foreign origins rejected',async t=>{
  const server=createApp();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/device/runtime.js')).status,200);
  assert.equal((await fetch(base+'/device/..%2f..%2fbackground.json')).status,403);
  assert.equal((await fetch(base+'/device/runtime.js',{headers:{Origin:'https://foreign.example'}})).status,403);
  assert.equal((await fetch(base+'/device/missing.js')).status,404);
});
