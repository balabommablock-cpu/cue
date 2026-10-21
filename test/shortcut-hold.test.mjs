import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

test('native hold gate rejects taps, cancels on release and fires once per complete hold',{skip:process.platform!=='darwin'},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'cue-hold-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const main=join(dir,'main.swift'),binary=join(dir,'hold-tests');
  await writeFile(main,`
import Foundation
var hold = ShortcutHold()
assert(!hold.shouldFire(at: 10, keysDown: true)) // idle
assert(hold.press(at: 10))
assert(!hold.shouldFire(at: 10.59, keysDown: true)) // brief press
assert(!hold.press(at: 10.4)) // autorepeat cannot restart the clock
assert(hold.shouldFire(at: 10.61, keysDown: true))
assert(!hold.shouldFire(at: 15, keysDown: true)) // long hold cannot fire twice
hold.release()
assert(hold.press(at: 20))
hold.release()
assert(!hold.shouldFire(at: 20.7, keysDown: true)) // cancelled timer
assert(hold.press(at: 30))
assert(!hold.shouldFire(at: 30.7, keysDown: false)) // modifier released first
assert(!hold.shouldFire(at: 31, keysDown: true))
assert(hold.press(at: 40))
hold.release()
assert(hold.press(at: 40.2))
assert(!hold.shouldFire(at: 40.61, keysDown: true)) // stale earlier deadline
assert(hold.shouldFire(at: 40.81, keysDown: true))
hold.release()
assert(hold.press(at: 50))
assert(hold.shouldFire(at: 50.7, keysDown: true)) // a new hold works again
var single = SingleModifierHold()
assert(!single.update(down: false, otherModifiers: false, keyCount: 0, at: 0))
assert(!single.update(down: true, otherModifiers: false, keyCount: 0, at: 1))
assert(!single.update(down: true, otherModifiers: false, keyCount: 0, at: 1.44))
assert(single.update(down: true, otherModifiers: false, keyCount: 0, at: 1.46))
assert(!single.update(down: true, otherModifiers: false, keyCount: 0, at: 10))
assert(!single.update(down: false, otherModifiers: false, keyCount: 0, at: 11))
assert(!single.update(down: true, otherModifiers: false, keyCount: 0, at: 12))
assert(!single.update(down: true, otherModifiers: false, keyCount: 1, at: 12.2)) // Option plus letter
assert(!single.update(down: true, otherModifiers: false, keyCount: 1, at: 20)) // blocked until release
assert(!single.update(down: false, otherModifiers: false, keyCount: 1, at: 21))
assert(!single.update(down: true, otherModifiers: true, keyCount: 1, at: 22)) // another modifier
assert(!single.update(down: true, otherModifiers: false, keyCount: 1, at: 23))
assert(!single.update(down: false, otherModifiers: false, keyCount: 1, at: 24))
assert(!single.update(down: true, otherModifiers: false, keyCount: 1, at: 25))
assert(!single.update(down: false, otherModifiers: false, keyCount: 1, at: 25.3)) // tap
assert(!single.update(down: true, otherModifiers: false, keyCount: 1, at: 26))
assert(single.update(down: true, otherModifiers: false, keyCount: 1, at: 26.5))
print("native hold cases passed")
`);
  execFileSync('xcrun',['swiftc','-swift-version','5',new URL('../native/ShortcutHold.swift',import.meta.url).pathname,main,'-o',binary],{stdio:'pipe'});
  assert.match(execFileSync(binary,{encoding:'utf8'}),/native hold cases passed/);
});
