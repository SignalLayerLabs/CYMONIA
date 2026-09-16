import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {applyPhysicalImpact,impactKineticEnergyJ} from '../world/impact.js';
import {totalTrackedMass} from '../world/materials.js';

test('kinetic energy follows classical 1/2 m v^2',()=>{
  assert.equal(impactKineticEnergyJ(10,4),80);
});

test('subcritical impact damages structure without inventing or deleting mass',()=>{
  const w=createSovereignGenesis({seed:901,realEpochMs:0});
  w.buildings.push({id:'b:test',kind:'structure',position:{x:60,y:60},condition:1,massKg:100,materials:{timber:100},protection:{thermal:.5,precipitation:.5},createdWorldMinute:0,provenance:{projectId:'p:test'}});
  const before=totalTrackedMass(w);
  const result=applyPhysicalImpact(w,{targetBuildingId:'b:test',projectileMassKg:1,speedMps:2,actorId:'world'},10);
  assert.equal(result.fractured,false);
  assert.ok(w.buildings[0].condition<1);
  assert.equal(totalTrackedMass(w),before);
  assert.ok(w.ledger.some(e=>e.type==='PHYSICAL_IMPACT'));
});

test('supercritical impact fractures a structure canonically and conserves mass',()=>{
  const w=createSovereignGenesis({seed:902,realEpochMs:0});
  w.buildings.push({id:'b:test',kind:'structure',position:{x:60,y:60},condition:1,massKg:120,materials:{clay:120},protection:{thermal:.5,precipitation:.5},createdWorldMinute:0,provenance:{projectId:'p:test'}});
  const before=totalTrackedMass(w);
  const result=applyPhysicalImpact(w,{targetBuildingId:'b:test',projectileMassKg:600,speedMps:30,actorId:'world'},20);
  assert.equal(result.fractured,true);
  assert.equal(w.buildings[0].condition,0);
  assert.equal(w.buildings[0].massKg,0);
  const fragments=w.objects.filter(o=>o.provenance?.type==='FRACTURE'&&o.provenance?.buildingId==='b:test');
  assert.ok(fragments.length>=4);
  const fragmentMass=fragments.reduce((s,o)=>s+o.quantity*o.massPerUnitKg,0);
  assert.ok(Math.abs(fragmentMass-120)<1e-6);
  assert.ok(Math.abs(totalTrackedMass(w)-before)<1e-6);
  const ev=w.ledger.find(e=>e.type==='STRUCTURE_FRACTURED');
  assert.ok(ev);
  assert.equal(ev.payload.buildingId,'b:test');
  assert.ok(Array.isArray(ev.payload.fragments));
});
