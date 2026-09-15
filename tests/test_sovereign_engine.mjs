import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {advanceWorldTo,publicWorld} from '../world/engine.js';

test('world catches up from canonical real time without browser presence',()=>{
  const w=createSovereignGenesis({seed:23,realEpochMs:1000});
  advanceWorldTo(w,61_000);
  assert.equal(w.clock.worldMinute,60);
  const pub=publicWorld(w,61_000);
  assert.equal(pub.clock.worldMinute,60);
  assert.equal(pub.citizens.length,100);
});
