import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {registerDesign,beginConstruction,applyConstructionWork} from '../world/artifacts.js';
import {learn} from '../world/epistemics.js';

test('building requires learned design, allocated materials and labor',()=>{
  const w=createSovereignGenesis({seed:11,realEpochMs:0});
  const c=w.citizens[0];
  assert.throws(()=>registerDesign(w,c,{id:'design:shelter',concepts:['joinery'],materials:{timber:10},workMinutes:120}),/unknown_concept/);
  learn(c,'joinery',{kind:'experiment',eventId:'evt:x'});
  const d=registerDesign(w,c,{id:'design:shelter',concepts:['joinery'],materials:{timber:10},workMinutes:120});
  const timber=w.objects.find(o=>o.material==='timber'&&o.quantity>=10);
  timber.holderId=c.id;
  const project=beginConstruction(w,c,d.id,{x:25,y:25},[timber.id],0);
  assert.equal(w.buildings.length,0);
  applyConstructionWork(w,c,project.id,60,60);
  assert.equal(w.buildings.length,0);
  applyConstructionWork(w,c,project.id,60,120);
  assert.equal(w.buildings.length,1);
  assert.equal(w.buildings[0].provenance.projectId,project.id);
});
