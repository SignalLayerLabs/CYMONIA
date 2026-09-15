import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {startAction} from '../world/actions.js';
import {advanceWorldTo} from '../world/engine.js';

test('canonical social interactions change relationships instead of only producing narration',()=>{
  const w=createSovereignGenesis({seed:65,realEpochMs:0}),a=w.citizens[0],b=w.citizens[1];
  a.knownEntityIds.push(b.id);b.knownEntityIds.push(a.id);
  startAction(w,a,{type:'CARE',durationMinutes:1,targetId:b.id,purpose:'care'},0);
  advanceWorldTo(w,1000);
  assert.ok(a.relationships[b.id]?.affection>0);
  assert.ok(b.relationships[a.id]?.trust>0);
});
