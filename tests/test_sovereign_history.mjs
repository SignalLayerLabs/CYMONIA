import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {appendEvent} from '../world/ledger.js';
import {classifyHistory} from '../world/observer.js';

test('observer classifications are descriptive and do not mutate canonical world',()=>{
  const w=createSovereignGenesis({seed:19,realEpochMs:0});
  const before=JSON.stringify({organizations:w.organizations,claims:w.claims});
  appendEvent(w,'VIOLENCE',w.citizens[0].id,{against:w.citizens[1].id,group:'g1'},[]);
  appendEvent(w,'VIOLENCE',w.citizens[1].id,{against:w.citizens[0].id,group:'g2'},[]);
  const h=classifyHistory(w);
  assert.ok(h.entries.length>=1);
  assert.equal(JSON.stringify({organizations:w.organizations,claims:w.claims}),before);
});
