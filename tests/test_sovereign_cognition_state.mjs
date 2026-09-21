import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {advancePregnancies,conceive} from '../world/reproduction.js';
import {
  ageCognitionDebt,
  ensureCognitionState,
  markAICognition,
  outcomeModifier,
  recordAffordanceOutcome,
} from '../world/cognition-state.js';

test('legacy citizen state migrates lazily and debt is bounded',()=>{
  const world=createSovereignGenesis({seed:17,realEpochMs:0});
  assert.ok(world.citizens.every(citizen=>citizen.cognition.local));
  const citizen=world.citizens[0];
  delete citizen.cognition.local;
  const state=ensureCognitionState(citizen,0);
  assert.equal(state.cognitionDebt,0);
  ageCognitionDebt(citizen,100_000);
  assert.equal(citizen.cognition.local.cognitionDebt,1);
});

test('newborn citizens start with bounded local cognition state',()=>{
  const world=createSovereignGenesis({seed:23,realEpochMs:0});
  const mother=world.citizens.find(c=>c.body.reproductiveRole==='gestating');
  const partner=world.citizens.find(c=>c.body.reproductiveRole==='non_gestating');
  const pregnancy=conceive(world,mother,partner,0);
  const [child]=advancePregnancies(world,pregnancy.dueWorldMinute);
  assert.ok(child.cognition.local);
  assert.equal(child.cognition.local.cognitionDebt,0);
});

test('recent failed affordance is penalized and later decays',()=>{
  const citizen=createSovereignGenesis({seed:17,realEpochMs:0}).citizens[0];
  recordAffordanceOutcome(citizen,'experiment',{ok:false,reason:'redundant'},100);
  assert.ok(outcomeModifier(citizen,'experiment',101)<0);
  assert.ok(outcomeModifier(citizen,'experiment',20_000)>outcomeModifier(citizen,'experiment',101));
});

test('successful outcomes reinforce behavior and accepted AI resets debt',()=>{
  const citizen=createSovereignGenesis({seed:19,realEpochMs:0}).citizens[0];
  ageCognitionDebt(citizen,7200);
  recordAffordanceOutcome(citizen,'communicate',{ok:true},100);
  assert.ok(outcomeModifier(citizen,'communicate',101)>0);
  markAICognition(citizen,120);
  const state=ensureCognitionState(citizen,120);
  assert.equal(state.cognitionDebt,0);
  assert.equal(state.lastAICognitionMinute,120);
  assert.equal(state.aiCognitionCount,1);
});
