import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {learn} from '../world/epistemics.js';
import {adoptBelief} from '../world/beliefs.js';
import {classifyHistory} from '../world/observer.js';

test('observer can classify emergent shared sacred belief without creating religion in canonical state',()=>{
  const w=createSovereignGenesis({seed:81,realEpochMs:0});
  for(const c of w.citizens.slice(0,4)){learn(c,'k:sky',{kind:'observation',evidence:{}},1,0);adoptBelief(w,c,{stanceCode:'sacred',conceptIds:['k:sky'],confidence:.8},{kind:'reflection'},1);}
  const before=JSON.stringify({organizations:w.organizations,claims:w.claims});
  const h=classifyHistory(w);
  assert.ok(h.entries.some(e=>e.category==='culture'&&/proto-religious/i.test(e.label)));
  assert.equal(JSON.stringify({organizations:w.organizations,claims:w.claims}),before);
  assert.ok(h.entries.every(e=>e.era));
});
