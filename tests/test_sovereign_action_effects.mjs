import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {startAction} from '../world/actions.js';
import {advanceWorldTo} from '../world/engine.js';
import {resourceConceptId} from '../world/perception.js';
import {learn} from '../world/epistemics.js';

test('drinking changes biology and depletes a physical resource',()=>{
  const w=createSovereignGenesis({seed:35,realEpochMs:0});
  const c=w.citizens[0],d=w.resourceDeposits.find(x=>x.type==='water');
  c.position={...d.position};c.body.hydration=20;
  const concept=resourceConceptId(d);learn(c,concept,{kind:'observation',entityId:d.id,evidence:{sensory:['fluid']}},.9,0);c.knownEntityIds.push(d.id);
  const q=d.quantity;
  startAction(w,c,{type:'DRINK',durationMinutes:1,targetId:d.id,purpose:'survival'},0);
  advanceWorldTo(w,1000);
  assert.ok(c.body.hydration>20);
  assert.ok(Math.abs(d.quantity-(q+d.renewPerDay/1440-.7))<1e-6);
  assert.ok(w.ledger.some(e=>e.type==='DRANK_RESOURCE'&&e.payload.depositId===d.id));
});

test('gathering removes matter from a deposit and creates provenance-bound matter',()=>{
  const w=createSovereignGenesis({seed:37,realEpochMs:0});
  const c=w.citizens[0],d=w.resourceDeposits.find(x=>x.type==='timber');
  c.position={...d.position};const q=d.quantity;
  startAction(w,c,{type:'GATHER',durationMinutes:1,targetId:d.id,payload:{quantity:2},purpose:'self-directed'},0);
  advanceWorldTo(w,1000);
  assert.ok(Math.abs(d.quantity-(q+d.renewPerDay/1440-2))<1e-6);
  const gathered=w.objects.find(o=>o.holderId===c.id&&o.provenance?.depositId===d.id);
  assert.ok(gathered);
  assert.ok(c.knownEntityIds.includes(gathered.id));
});
