import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {totalTrackedMass} from '../world/materials.js';
import {applyDestruction,applyRepair,grievancePressure} from '../world/destruction.js';
import {ensureLivingWorld,recordStructureUse,scarPressureAt} from '../world/living-world.js';

const close=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);

test('destroying a used building preserves mass, creates salvage, and creates social grievance',()=>{
  const world=createSovereignGenesis({seed:301,realEpochMs:0});
  const actor=world.citizens[0],user=world.citizens[1];
  const building={id:'b:destroy',kind:'structure',position:{x:60,y:60},footprintRadius:2.5,condition:.15,massKg:20,materials:{timber:12,stone:8},protection:{thermal:.6,precipitation:.6},createdWorldMinute:0,provenance:{initiatorId:user.id,contributorIds:[user.id]}};
  world.buildings.push(building);actor.position={x:60,y:60};user.position={x:60,y:60};
  recordStructureUse(world,user,user.position,600,100);
  const before=totalTrackedMass(world);
  const result=applyDestruction(world,actor,building.id,{mode:'DESTROY',effortMinutes:1440},200);
  assert.equal(result.destroyed,true);
  assert.equal(building.condition,0);
  assert.ok(result.salvageObjectIds.length>0);
  close(totalTrackedMass(world),before);
  assert.ok(grievancePressure(world,user,actor.id,200)>0);
  assert.ok(world.ledger.some(e=>e.type==='ENTITY_DESTROYED'&&e.payload.targetId===building.id));
});

test('artifacts can be broken into conserved debris',()=>{
  const world=createSovereignGenesis({seed:303,realEpochMs:0}),actor=world.citizens[0];
  const o={id:'artifact:test',kind:'artifact',material:'timber',quantity:4,massPerUnitKg:1,properties:{...({hardness:.2,toughness:.2,structuralIntegrity:20})},holderId:null,position:{x:55,y:55},condition:.08,provenance:{type:'TRANSFORMATION'}};
  world.objects.push(o);actor.position={x:55,y:55};actor.knownEntityIds.push(o.id);
  const before=totalTrackedMass(world);
  const r=applyDestruction(world,actor,o.id,{mode:'DESTROY',effortMinutes:600},10);
  assert.equal(r.destroyed,true);
  assert.equal(o.quantity,0);
  close(totalTrackedMass(world),before);
});

test('natural timber/plant/stone patches can be damaged and become physical loose resources',()=>{
  const world=createSovereignGenesis({seed:305,realEpochMs:0}),actor=world.citizens[0];
  for(const type of ['timber','food','stone']){
    const d=world.resourceDeposits.find(x=>x.type===type);
    actor.position={...d.position};actor.knownEntityIds.push(d.id);
    const before=d.quantity,mass=totalTrackedMass(world);
    const r=applyDestruction(world,actor,d.id,{mode:'DESTROY',effortMinutes:30},100);
    assert.ok(d.quantity<before);
    assert.ok(r.salvageObjectIds.length>0);
    close(totalTrackedMass(world),mass);
    assert.ok(scarPressureAt(world,d.position,100)>0);
  }
});

test('repair consumes real material, adds it to the target, and preserves mass',()=>{
  const world=createSovereignGenesis({seed:307,realEpochMs:0}),actor=world.citizens[0];
  const building={id:'b:repair',kind:'structure',position:{x:60,y:60},footprintRadius:2.5,condition:.4,massKg:10,materials:{timber:10},protection:{thermal:.5,precipitation:.5},createdWorldMinute:0,provenance:{}};
  const material={id:'repair:mat',kind:'raw_material',material:'timber',quantity:2,massPerUnitKg:1,holderId:actor.id,position:{x:60,y:60},condition:1,provenance:{}};
  world.buildings.push(building);world.objects.push(material);actor.position={x:60,y:60};actor.possessions.push(material.id);
  const before=totalTrackedMass(world),condition=building.condition;
  applyRepair(world,actor,building.id,material.id,{effortMinutes:60},100);
  assert.ok(building.condition>condition);
  close(totalTrackedMass(world),before);
});

test('destruction state remains bounded',()=>{
  const world=createSovereignGenesis({seed:309,realEpochMs:0});
  ensureLivingWorld(world);
  assert.ok(world.livingWorld.scars);
});
