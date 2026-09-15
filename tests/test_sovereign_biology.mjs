import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {advanceBody,killCitizen} from '../world/biology.js';

test('biological needs progress with simulated time',()=>{
  const w=createSovereignGenesis({seed:3,realEpochMs:0});
  const c=w.citizens[0];
  const before={...c.body};
  advanceBody(w,c,240);
  assert.ok(c.body.hydration<before.hydration);
  assert.ok(c.body.calories<before.calories);
  assert.ok(c.body.sleepPressure>before.sleepPressure);
  assert.ok(c.body.ageMinutes>before.ageMinutes);
});

test('death is permanent and cannot be reversed by body advancement',()=>{
  const w=createSovereignGenesis({seed:3,realEpochMs:0});
  const c=w.citizens[0];
  killCitizen(w,c,'test');
  assert.equal(c.alive,false);
  const death=c.deathWorldMinute;
  advanceBody(w,c,1000);
  assert.equal(c.alive,false);
  assert.equal(c.deathWorldMinute,death);
});
