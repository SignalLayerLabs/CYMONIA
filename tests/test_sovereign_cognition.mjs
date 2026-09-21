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

test('cognitive context stays compact while preserving active strategy',()=>{
  const w=createSovereignGenesis({seed:29,realEpochMs:0});
  const c=w.citizens[0];
  for(let i=0;i<50;i++)learn(c,`known:${i}`,{kind:'observation',eventId:`evt:${i}`});
  c.memories=Array.from({length:30},(_,i)=>({kind:'episodic',content:{i},confidence:1}));
  c.activeGoal={kind:'strategy-v1',intent:'understand',focus:'known:49',actionBias:['EXPERIMENT'],createdWorldMinute:0,expiresWorldMinute:4000};
  const ctx=buildCognitiveContext(w,c,100);
  assert.ok(ctx.knowledge.length<=32);
  assert.ok(ctx.memories.length<=12);
  assert.equal(ctx.self.activeGoal.intent,'understand');
});
