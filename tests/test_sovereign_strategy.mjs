import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {learn} from '../world/epistemics.js';
import {enumerateAffordances,scoreAffordance} from '../world/affordances.js';
import {
  acceptAIStrategy,
  activeStrategy,
  recordStrategyOutcome,
  sanitizeAIStrategy,
  validateStrategy,
} from '../world/strategy.js';

test('strategy persists for days and references only known state',()=>{
  const world=createSovereignGenesis({seed:7,realEpochMs:0});
  const citizen=world.citizens[0];
  learn(citizen,'known-concept',{kind:'observation',eventId:'e'});
  const strategy=sanitizeAIStrategy({focus:'known-concept',intent:'understand',actionBias:['EXPERIMENT'],partnerIds:[],successSignals:['known-concept'],horizonMinutes:4320,confidence:.7});
  assert.equal(validateStrategy(world,citizen,strategy,0).ok,true);
  acceptAIStrategy(world,citizen.id,strategy,0);
  assert.equal(activeStrategy(citizen,2879)?.intent,'understand');
  assert.equal(citizen.activeGoal.expiresWorldMinute,4320);
});

test('unknown partner, unknown concept, and expired strategy are inert',()=>{
  const world=createSovereignGenesis({seed:7,realEpochMs:0});
  const citizen=world.citizens[0];
  const invalid=sanitizeAIStrategy({focus:'forbidden',intent:'share',partnerIds:['stranger'],horizonMinutes:60});
  assert.equal(validateStrategy(world,citizen,invalid,0).ok,false);
  citizen.activeGoal={kind:'strategy-v1',createdWorldMinute:0,expiresWorldMinute:10,intent:'explore',actionBias:['OBSERVE'],progress:{completedActions:0}};
  assert.equal(activeStrategy(citizen,11,world),null);
  assert.equal(citizen.activeGoal,null);
  assert.ok(world.ledger.some(event=>event.type==='STRATEGY_CLOSED'&&event.payload.reason==='expired'));
});

test('strategy progress is bounded and repeated failures abandon it',()=>{
  const world=createSovereignGenesis({seed:11,realEpochMs:0});
  const citizen=world.citizens[0];
  acceptAIStrategy(world,citizen.id,sanitizeAIStrategy({intent:'adapt',actionBias:['OBSERVE'],horizonMinutes:120}),0);
  recordStrategyOutcome(world,citizen,{ok:true,family:'explore'},10);
  assert.equal(citizen.activeGoal.progress.completedActions,1);
  recordStrategyOutcome(world,citizen,{ok:false,family:'experiment'},20);
  recordStrategyOutcome(world,citizen,{ok:false,family:'experiment'},30);
  recordStrategyOutcome(world,citizen,{ok:false,family:'experiment'},40);
  assert.equal(citizen.activeGoal,null);
  assert.ok(world.ledger.some(event=>event.type==='STRATEGY_CLOSED'&&event.payload.reason==='repeated_failure'));
});

test('persistent and legacy goals both bias matching local affordances',()=>{
  const world=createSovereignGenesis({seed:13,realEpochMs:0});
  const citizen=world.citizens[0],deposit=world.resourceDeposits.find(item=>item.type==='timber');
  citizen.position={...deposit.position};citizen.knownEntityIds.push(deposit.id);
  learn(citizen,'known-focus',{kind:'observation',eventId:'focus'});
  learn(citizen,`resource:${deposit.id}`,{kind:'observation',eventId:'resource'});
  const explore=enumerateAffordances(world,citizen,0).find(item=>item.family==='explore');
  const baseline=scoreAffordance(world,citizen,explore,0);
  acceptAIStrategy(world,citizen.id,sanitizeAIStrategy({focus:'known-focus',intent:'explore',actionBias:['MOVE','OBSERVE'],successSignals:['known-focus'],horizonMinutes:600}),0);
  assert.ok(scoreAffordance(world,citizen,explore,1)>baseline);
  citizen.activeGoal={concepts:[],actionTypes:['MOVE'],source:'legacy',createdWorldMinute:0};
  assert.ok(scoreAffordance(world,citizen,explore,1)>baseline);
});

test('sanitizer clamps the strategy surface to supported primitives',()=>{
  const strategy=sanitizeAIStrategy({intent:'invent-government',actionBias:['OBSERVE','FLY'],partnerIds:Array.from({length:20},(_,i)=>`p-${i}`),successSignals:Array.from({length:20},(_,i)=>`k-${i}`),horizonMinutes:999999,confidence:4});
  assert.equal(strategy.intent,'adapt');
  assert.deepEqual(strategy.actionBias,['OBSERVE']);
  assert.equal(strategy.partnerIds.length,6);
  assert.equal(strategy.successSignals.length,8);
  assert.equal(strategy.horizonMinutes,10080);
  assert.equal(strategy.confidence,1);
});
