import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {applyAcceptedPlan} from '../world/cognition.js';
import {riverCenterX,terrainAt} from '../world/terrain.js';

test('a planned sleep on unsafe terrain is preceded by physical escape instead of throwing',()=>{
  const world=createSovereignGenesis({seed:20260915,realEpochMs:0}),citizen=world.citizens[0];
  // The resource marker is not guaranteed to sit on the dynamic river center.
  // Place the Citizen on the canonical procedural river itself.
  citizen.position={x:riverCenterX(world,50),y:50};
  assert.equal(terrainAt(world,citizen.position.x,citizen.position.y).kind,'river');
  const plan=applyAcceptedPlan(world,citizen,{source:'reflex',concepts:[],actions:[{type:'SLEEP',durationMinutes:240,purpose:'survival',concepts:[]}]},0);
  assert.equal(plan.actions[0].type,'MOVE');
  assert.equal(plan.actions[1].type,'SLEEP');
  assert.equal(world.actions.at(-1).type,'MOVE');
});
