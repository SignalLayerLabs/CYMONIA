import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {learn} from '../world/epistemics.js';
import {buildCognitiveContext,validateCognitiveProposal} from '../world/cognition.js';

test('cognitive context contains known facts, not global omniscience',()=>{
  const w=createSovereignGenesis({seed:17,realEpochMs:0});
  const c=w.citizens[0];
  learn(c,'visible-tree',{kind:'observation',eventId:'evt:t'});
  const ctx=buildCognitiveContext(w,c,0);
  assert.ok(ctx.knowledge.some(k=>k.id==='visible-tree'));
  assert.equal(ctx.knowledge.some(k=>k.id==='combustion-engine'),false);
  assert.equal('allResources' in ctx,false);
});

test('proposal referencing forbidden knowledge is rejected',()=>{
  const w=createSovereignGenesis({seed:17,realEpochMs:0});
  const c=w.citizens[0];
  const r=validateCognitiveProposal(w,c,{goal:'unknown',concepts:['electric-grid'],actions:[]});
  assert.equal(r.ok,false);
});
