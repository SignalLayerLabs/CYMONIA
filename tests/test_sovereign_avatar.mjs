import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {createHumanAvatar} from '../world/engine.js';

test('human avatar consumes Genesis embodiment reserve and gets no Earth knowledge',()=>{
  const w=createSovereignGenesis({seed:21,realEpochMs:0});
  const before=w.reserves.observerEmbodimentKg;
  const c=createHumanAvatar(w,{externalId:'gh:123',displayName:'Observer-linked'},0);
  assert.equal(w.reserves.observerEmbodimentKg,before-c.body.massKg);
  assert.equal(c.kind,'HUMAN_LINKED');
  assert.equal(c.knowledge.some(k=>/car|internet|earth|government/i.test(k.concept)),false);
});
