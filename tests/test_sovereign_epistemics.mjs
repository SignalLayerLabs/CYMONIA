import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {learn,knows,validateProposalKnowledge,forget} from '../world/epistemics.js';

test('unknown concepts cannot be used by a plan',()=>{
  const w=createSovereignGenesis({seed:7,realEpochMs:0});
  const c=w.citizens[0];
  const r=validateProposalKnowledge(w,c,{concepts:['combustion-engine'],actions:[]});
  assert.equal(r.ok,false);
  assert.match(r.reason,/unknown_concept/);
});

test('provenance-backed concepts become actionable and can be forgotten',()=>{
  const w=createSovereignGenesis({seed:7,realEpochMs:0});
  const c=w.citizens[0];
  learn(c,'ridge-water',{kind:'observation',eventId:'evt:test'},0.9);
  assert.equal(knows(c,'ridge-water'),true);
  assert.equal(validateProposalKnowledge(w,c,{concepts:['ridge-water'],actions:[]}).ok,true);
  forget(c,'ridge-water');
  assert.equal(knows(c,'ridge-water'),false);
});
