import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {learn} from '../world/epistemics.js';
import {resourceConceptId} from '../world/perception.js';
import {recordAffordanceOutcome} from '../world/cognition-state.js';
import {chooseAffordance,enumerateAffordances,scoreAffordance} from '../world/affordances.js';
import {applyAcceptedPlan} from '../world/cognition.js';
import {advanceWorldTo} from '../world/engine.js';

function reveal(world,citizen,deposit){
  citizen.position={...deposit.position};
  if(!citizen.knownEntityIds.includes(deposit.id))citizen.knownEntityIds.push(deposit.id);
  learn(citizen,resourceConceptId(deposit),{kind:'observation',eventId:`seen:${deposit.id}`,entityId:deposit.id});
}

function hold(world,citizen,deposit,id=`held:${deposit.type}`){
  const object={id,kind:'gathered_material',material:deposit.type,quantity:1,massPerUnitKg:1,properties:null,holderId:citizen.id,position:{...citizen.position},condition:1,provenance:{type:'GATHERED',depositId:deposit.id}};
  world.objects.push(object);citizen.possessions.push(object.id);return object;
}

test('curious citizen gathers then experiments on an untested material',()=>{
  const world=createSovereignGenesis({seed:31,realEpochMs:0});
  const citizen=world.citizens[0],deposit=world.resourceDeposits.find(d=>d.type==='timber');
  reveal(world,citizen,deposit);
  citizen.psychology.curiosity=1;
  const first=chooseAffordance(world,citizen,0);
  assert.equal(first.actions.at(-1).type,'GATHER');
  hold(world,citizen,deposit);
  const second=chooseAffordance(world,citizen,30);
  assert.equal(second.actions[0].type,'EXPERIMENT');
});

test('invalid targets are excluded and an isolated citizen falls back safely',()=>{
  const world=createSovereignGenesis({seed:31,realEpochMs:0});
  const citizen=world.citizens[0];
  citizen.knownEntityIds=[citizen.id];
  citizen.knowledge=[];
  citizen.body.sleepPressure=10;citizen.body.hydration=80;citizen.body.calories=80;
  const proposal=chooseAffordance(world,citizen,0);
  assert.ok(['MOVE','OBSERVE','REST'].includes(proposal.actions[0].type));
  assert.equal((proposal.actions[0].concepts||[]).length,0);
});

test('social drive and trust raise communication and teaching utility',()=>{
  const world=createSovereignGenesis({seed:41,realEpochMs:0});
  const [citizen,other]=world.citizens;
  other.position={...citizen.position};
  citizen.knownEntityIds.push(other.id);
  learn(citizen,'shared:test',{kind:'observation',eventId:'shared'});
  citizen.relationships[other.id]={familiarity:.8,trust:.85,affection:.4,fear:0,obligation:0};
  citizen.psychology.socialDrive=.95;
  const candidates=enumerateAffordances(world,citizen,0);
  const communicate=candidates.find(x=>x.family==='communicate');
  const teach=candidates.find(x=>x.family==='teach');
  assert.ok(communicate);assert.ok(teach);
  const socialScore=scoreAffordance(world,citizen,communicate,0);
  const teachingScore=scoreAffordance(world,citizen,teach,0);
  citizen.psychology.socialDrive=.05;
  citizen.relationships[other.id].trust=.05;
  assert.ok(socialScore>scoreAffordance(world,citizen,communicate,0));
  assert.ok(teachingScore>scoreAffordance(world,citizen,teach,0));
});

test('distance, risk aversion, cooldown, and failure lower utility',()=>{
  const world=createSovereignGenesis({seed:43,realEpochMs:0});
  const citizen=world.citizens[0],deposit=world.resourceDeposits.find(d=>d.type==='stone');
  reveal(world,citizen,deposit);
  const near=enumerateAffordances(world,citizen,100).find(x=>x.family==='gather'&&x.proposal.actions.at(-1).targetId===deposit.id);
  citizen.psychology.riskTolerance=1;
  const nearScore=scoreAffordance(world,citizen,near,100);
  citizen.position={x:95,y:95};
  citizen.psychology.riskTolerance=0;
  const far=enumerateAffordances(world,citizen,100).find(x=>x.family==='gather'&&x.proposal.actions.at(-1).targetId===deposit.id);
  const farScore=scoreAffordance(world,citizen,far,100);
  assert.ok(nearScore>farScore);
  recordAffordanceOutcome(citizen,'gather',{ok:false,reason:'blocked'},100);
  assert.ok(scoreAffordance(world,citizen,far,101)<farScore);
});

test('held material creates transfer and transformation affordances without a COOPERATE action',()=>{
  const world=createSovereignGenesis({seed:47,realEpochMs:0});
  const [citizen,other]=world.citizens,deposit=world.resourceDeposits.find(d=>d.type==='clay');
  reveal(world,citizen,deposit);const object=hold(world,citizen,deposit);
  other.position={...citizen.position};citizen.knownEntityIds.push(other.id);
  citizen.relationships[other.id]={familiarity:.8,trust:.8,affection:.4,fear:0,obligation:.2};
  learn(citizen,`tested:${object.id}`,{kind:'experiment',eventId:'tested',evidence:{entityId:object.id,property:'hardness',value:.25}});
  const candidates=enumerateAffordances(world,citizen,200);
  assert.ok(candidates.some(x=>x.family==='transfer'));
  assert.ok(candidates.some(x=>x.family==='transform'));
  assert.equal(candidates.some(x=>x.proposal.actions.some(a=>a.type==='COOPERATE')),false);
});

test('resolved local plans feed bounded outcome learning',()=>{
  const world=createSovereignGenesis({seed:53,realEpochMs:0});
  const citizen=world.citizens[0],deposit=world.resourceDeposits.find(d=>d.type==='timber');
  reveal(world,citizen,deposit);citizen.body.hydration=90;citizen.body.calories=90;citizen.body.sleepPressure=10;
  const selected=chooseAffordance(world,citizen,0);
  assert.equal(selected.affordanceFamily,'gather');
  applyAcceptedPlan(world,citizen,selected,0);
  advanceWorldTo(world,20_000);
  assert.equal(citizen.cognition.local.outcomes.gather.successes,1);
});
