import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {executePhysicalOperations} from '../world/physical-operations.js';
import {rememberProcedure,procedureProposal,PROCEDURE_LIMITS} from '../world/procedures.js';
import {localDeliberation,applyAcceptedPlan} from '../world/cognition.js';
import {recordAffordanceOutcome} from '../world/cognition-state.js';
import {acceptAIStrategy,sanitizeAIStrategy} from '../world/strategy.js';
import {learn} from '../world/epistemics.js';
import {stableId} from '../world/rng.js';
import {advanceWorldTo,publicWorld} from '../world/engine.js';
import {enumerateAffordances} from '../world/affordances.js';

function matureCitizen(at=120){
  const world=createSovereignGenesis({seed:20260915,realEpochMs:0}),citizen=world.citizens[0];
  for(const person of world.citizens)person.position={x:50,y:50};
  citizen.psychology.curiosity=1;citizen.psychology.noveltySeeking=1;citizen.psychology.socialDrive=0;
  citizen.body.hydration=95;citizen.body.calories=95;citizen.body.sleepPressure=10;
  const object={id:'held:remembered-clay',kind:'raw_material',material:'clay',quantity:2,massPerUnitKg:1,holderId:citizen.id,position:{x:50,y:50},condition:1,properties:{hardness:.25},provenance:{type:'TEST_INPUT'}};
  world.objects.push(object);citizen.possessions.push(object.id);citizen.knownEntityIds.push(object.id);
  learn(citizen,stableId('kprop',object.id,'hardness'),{kind:'observation',eventId:'seen:clay',entityId:object.id,evidence:{entityId:object.id,property:'hardness',value:.25}});
  for(let i=0;i<PROCEDURE_LIMITS.personal;i++){
    const receipt=executePhysicalOperations(world,citizen,[{primitive:'rotate',target:0,angle:i+1,workJ:10}],{inputObjectIds:[object.id],at:at-120,workMinutes:1});
    rememberProcedure(world,citizen,receipt,at-120);
  }
  world.clock.worldMinute=at;
  return {world,citizen};
}

test('a full memory of procedures cannot starve an active exploration strategy',()=>{
  const {world,citizen}=matureCitizen();
  assert.equal(citizen.procedureKnowledge.length,24);
  assert.ok(procedureProposal(world,citizen,120),'the regression requires a runnable remembered procedure');
  acceptAIStrategy(world,citizen.id,sanitizeAIStrategy({intent:'explore',actionBias:['MOVE'],horizonMinutes:4320,confidence:.8}),120);
  const selected=localDeliberation(world,citizen,120);
  assert.equal(selected.affordanceFamily,'explore');
  assert.equal(selected.actions[0].type,'MOVE');
  assert.ok(Math.hypot(selected.actions[0].targetPosition.x-50,selected.actions[0].targetPosition.y-50)>20);
});

test('recent practice applies to the activity family even when another remembered procedure is runnable',()=>{
  const {world,citizen}=matureCitizen();
  recordAffordanceOutcome(citizen,'experiment',{ok:true},120);
  assert.ok(procedureProposal(world,citizen,121));
  assert.notEqual(localDeliberation(world,citizen,121).actions[0].type,'EXPERIMENT');
});

test('a reliable remembered skill can win deliberation instead of always inventing another hypothesis',()=>{
  const {world,citizen}=matureCitizen();
  citizen.psychology.curiosity=.2;citizen.psychology.noveltySeeking=.2;
  for(const other of world.citizens.slice(1))other.position={x:95,y:95};
  const entry=citizen.procedureKnowledge[0],object=world.objects.find(o=>o.holderId===citizen.id);
  const record=world.procedures.find(p=>p.id===entry.procedureId);
  for(let at=1;at<=5;at++){
    const receipt=executePhysicalOperations(world,citizen,record.operations,{inputObjectIds:[object.id],at,procedureId:record.id,workMinutes:1});
    rememberProcedure(world,citizen,receipt,at);
  }
  const selected=localDeliberation(world,citizen,240);
  assert.equal(selected.source,'personal-procedure');
  assert.equal(selected.affordanceFamily,'experiment');
  assert.equal(selected.actions[0].payload.procedureId,record.id);
});

test('a legacy practice description cannot bias a mature citizen into repeating experiments forever',()=>{
  const {world,citizen}=matureCitizen();
  citizen.activeGoal={source:'personal-procedure',concepts:[],actionTypes:['EXPERIMENT']};
  recordAffordanceOutcome(citizen,'experiment',{ok:true},120);
  assert.notEqual(localDeliberation(world,citizen,121).actions[0].type,'EXPERIMENT');
});

test('practicing a personal procedure preserves the persistent strategy that selected it',()=>{
  const {world,citizen}=matureCitizen();
  acceptAIStrategy(world,citizen.id,sanitizeAIStrategy({intent:'understand',actionBias:['EXPERIMENT'],horizonMinutes:4320,confidence:.8}),120);
  const before=structuredClone(citizen.activeGoal);
  applyAcceptedPlan(world,citizen,procedureProposal(world,citizen,120),120);
  assert.deepEqual(citizen.activeGoal,before);
});

test('a mature crowded citizen physically leaves the center without an AI call or position reset',()=>{
  // A warm-season fixture isolates routine starvation from the legitimate
  // winter shelter reflex that keeps a cold citizen near shelter.
  const start=196560,{world,citizen}=matureCitizen(start),ids=world.citizens.map(c=>c.id);
  let furthest=0;
  for(let minute=start+10;minute<=start+240;minute+=10){
    advanceWorldTo(world,minute*1000);
    const position=publicWorld(world).citizens.find(c=>c.id===citizen.id).position;
    furthest=Math.max(furthest,Math.hypot(position.x-50,position.y-50));
  }
  assert.ok(furthest>12,`citizen remained within ${furthest.toFixed(2)} units of the central cluster`);
  assert.ok(citizen.plans.some(plan=>plan.affordanceFamily==='explore'));
  assert.deepEqual(world.citizens.map(c=>c.id),ids);
  assert.ok(citizen.alive);
});

test('dense social deliberation stays bounded and rotates attention without permanently excluding citizens',()=>{
  const world=createSovereignGenesis({seed:20260915,realEpochMs:0}),citizen=world.citizens[0];
  learn(citizen,'shared:observed',{kind:'observation',eventId:'shared'});
  for(const person of world.citizens){person.position={x:50,y:50};citizen.knownEntityIds.push(person.id);}
  const attended=new Set();
  for(let at=0;at<1200;at+=120){
    const contacts=enumerateAffordances(world,citizen,at).filter(candidate=>candidate.family==='communicate');
    assert.ok(contacts.length<=12,'one deliberation cannot compare every concept with every nearby mind');
    for(const candidate of contacts)attended.add(candidate.targetId);
  }
  assert.equal(attended.size,99,'bounded attention must eventually cover every known neighbor');
});
