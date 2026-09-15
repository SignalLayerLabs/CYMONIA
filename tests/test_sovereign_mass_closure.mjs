import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {totalTrackedMass} from '../world/materials.js';
import {advanceWorldTo,markCitizenDead} from '../world/engine.js';
import {conceive,advancePregnancies} from '../world/reproduction.js';
import {learn} from '../world/epistemics.js';
import {registerDesign,beginConstruction,applyConstructionWork} from '../world/artifacts.js';

const close=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);

test('environmental renewal transfers matter from explicit natural reservoirs',()=>{
  const w=createSovereignGenesis({seed:51,realEpochMs:0});
  const before=totalTrackedMass(w);
  advanceWorldTo(w,1440_000);
  close(totalTrackedMass(w),before,.0001);
  assert.ok(w.environment.naturalReservoirs.waterKg>=0);
  assert.ok(w.environment.naturalReservoirs.biomassKg>=0);
});

test('death transfers biological mass into a physical corpse instead of deleting it',()=>{
  const w=createSovereignGenesis({seed:53,realEpochMs:0});
  const c=w.citizens[0],before=totalTrackedMass(w),mass=c.body.massKg;
  markCitizenDead(w,c.id,'test',10);
  const corpse=w.objects.find(o=>o.provenance?.type==='CORPSE'&&o.provenance?.citizenId===c.id);
  assert.ok(corpse);
  close(corpse.quantity*corpse.massPerUnitKg,mass);
  close(totalTrackedMass(w),before);
});

test('birth moves biomass from gestating parent into the newborn',()=>{
  const w=createSovereignGenesis({seed:55,realEpochMs:0});
  const a=w.citizens.find(c=>c.body.reproductiveRole==='gestating');
  const b=w.citizens.find(c=>c.body.reproductiveRole==='non_gestating');
  const p=conceive(w,a,b,0),before=totalTrackedMass(w);
  const born=advancePregnancies(w,p.dueWorldMinute);
  assert.equal(born.length,1);
  close(totalTrackedMass(w),before);
  assert.ok(a.body.massKg<80);
});

test('construction transfers material mass into the completed structure',()=>{
  const w=createSovereignGenesis({seed:57,realEpochMs:0});
  const c=w.citizens[0],o=w.objects.find(x=>x.material==='timber');
  o.holderId=c.id;c.possessions.push(o.id);learn(c,'k:shelter',{kind:'experiment',evidence:{}},1,0);
  const d=registerDesign(w,c,{concepts:['k:shelter'],materials:{timber:10},workMinutes:5},0);
  const before=totalTrackedMass(w),p=beginConstruction(w,c,d.id,{x:51,y:51},[o.id],0);
  applyConstructionWork(w,c,p.id,5,5);
  const building=w.buildings.at(-1);
  assert.ok(building.massKg>=10);
  close(totalTrackedMass(w),before);
});
