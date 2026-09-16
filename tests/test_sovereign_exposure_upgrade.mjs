import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {advanceBody} from '../world/biology.js';

test('canonical shelter materially reduces rain exposure',()=>{
  const shelteredWorld=createSovereignGenesis({seed:20260915,realEpochMs:0});
  const exposedWorld=createSovereignGenesis({seed:20260915,realEpochMs:0});
  shelteredWorld.environment.precipitation=.9;exposedWorld.environment.precipitation=.9;
  const s=shelteredWorld.citizens[0],e=exposedWorld.citizens[0];
  const shelter=shelteredWorld.objects.find(o=>o.kind==='temporary_shelter');
  s.position={...shelter.position};e.position={x:90,y:90};
  const sleepS=s.body.sleepPressure,sleepE=e.body.sleepPressure;
  advanceBody(shelteredWorld,s,240);advanceBody(exposedWorld,e,240);
  assert.ok(s.body.exposure.precipitationProtection>e.body.exposure.precipitationProtection);
  assert.ok((s.body.sleepPressure-sleepS)<(e.body.sleepPressure-sleepE));
});
