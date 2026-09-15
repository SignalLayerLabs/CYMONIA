import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {totalTrackedMass,transferObject} from '../world/materials.js';

test('object transfer changes custody, not mass',()=>{
  const w=createSovereignGenesis({seed:5,realEpochMs:0});
  const item=w.objects.find(o=>o.holderId==='commons:genesis');
  const before=totalTrackedMass(w);
  transferObject(w,item.id,w.citizens[0].id);
  assert.equal(item.holderId,w.citizens[0].id);
  assert.equal(totalTrackedMass(w),before);
});
