import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {learn} from '../world/epistemics.js';
import {resourceConceptId} from '../world/perception.js';
import {beginEmpiricalConstruction,applyConstructionWork} from '../world/artifacts.js';
import {publicWorld} from '../world/engine.js';

test('construction stages carried material at the physical site',()=>{
  const world=createSovereignGenesis({seed:20260915,realEpochMs:0}),citizen=world.citizens[0],deposit=world.resourceDeposits.find(d=>d.type==='timber');
  citizen.position={x:70,y:70};
  const ids=[];
  for(let i=0;i<2;i++){const object={id:`mat:${i}`,kind:'gathered_material',material:'timber',quantity:1,massPerUnitKg:1,holderId:citizen.id,position:{...citizen.position},condition:1,provenance:{type:'GATHERED'}};world.objects.push(object);citizen.possessions.push(object.id);citizen.knownEntityIds.push(object.id);learn(citizen,`tested:${i}`,{kind:'experiment',evidence:{entityId:object.id,property:'hardness',value:.4}},.9,0);ids.push(object.id);}
  const project=beginEmpiricalConstruction(world,citizen,{concepts:['tested:0','tested:1'],inputObjectIds:ids,workMinutes:100,form:'structure',site:{x:70,y:70},whySummary:'physical shelter'},0);
  for(const id of ids){const object=world.objects.find(x=>x.id===id);assert.equal(object.holderId,null);assert.deepEqual(object.position,project.site);assert.equal(object.reservedProjectId,project.id);assert.equal(citizen.possessions.includes(id),false);}
  assert.equal(project.phase,'site');
  applyConstructionWork(world,citizen,project.id,30,30);
  assert.notEqual(project.phase,'site');
});

test('public state exposes living-world evidence and building-use compatible fields',()=>{
  const world=createSovereignGenesis({seed:20260915,realEpochMs:0});
  const publicState=publicWorld(world,0);
  assert.ok(publicState.livingWorld);
  assert.ok(Array.isArray(publicState.livingWorld.trails));
  assert.ok(Array.isArray(publicState.livingWorld.stockpiles));
  assert.ok(Array.isArray(publicState.livingWorld.settlements));
  assert.ok(publicState.livingWorld.river);
  assert.ok(publicState.citizens.every(c=>c.skills&&c.reputation));
});
