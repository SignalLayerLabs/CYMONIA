import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {advanceBody} from '../world/biology.js';
import {perceiveStructures} from '../world/perception.js';

test('Genesis temporary shelters are physical endowment objects, not decorative spawned buildings',()=>{
  const w=createSovereignGenesis({seed:73,realEpochMs:0});
  assert.equal(w.buildings.length,0);
  const shelters=w.objects.filter(o=>o.kind==='temporary_shelter');
  assert.ok(shelters.length>=6);
  assert.ok(shelters.every(o=>o.provenance?.type==='GENESIS_ENDOWMENT'));
});

test('physical shelter reduces environmental thermal harm and can be perceived',()=>{
  const w=createSovereignGenesis({seed:75,realEpochMs:0});
  const shelter=w.objects.find(o=>o.kind==='temporary_shelter'),inside=w.citizens[0],outside=w.citizens[1];
  inside.position={...shelter.position};outside.position={x:90,y:90};w.environment.temperatureC=-8;inside.body.health=100;outside.body.health=100;
  const learned=perceiveStructures(w,inside,0,5);
  assert.ok(learned.length>0);
  advanceBody(w,inside,360);advanceBody(w,outside,360);
  assert.ok(inside.body.health>outside.body.health);
});
