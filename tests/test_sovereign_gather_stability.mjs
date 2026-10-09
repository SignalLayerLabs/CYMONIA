import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {startAction,interruptAction} from '../world/actions.js';
import {advanceWorldTo} from '../world/engine.js';
import {verifyLedger} from '../world/ledger.js';

function fixture(){const world=createSovereignGenesis({seed:37,realEpochMs:0}),c=world.citizens[0],d=world.resourceDeposits.find(x=>x.type==='timber');world.citizens=[c];c.position={...d.position};d.renewPerDay=0;d.quantity=5000;return {world,c,d};}
function gather(f,quantity=2){const {world,c,d}=f;interruptAction(world,c,'controlled fixture');Object.assign(c.body,{hydration:100,calories:100,health:100,sleepPressure:10});const a=startAction(world,c,{type:'GATHER',durationMinutes:1,targetId:d.id,payload:{quantity},purpose:'self-directed'},world.clock.worldMinute);advanceWorldTo(world,a.endsWorldMinute*1000);return a;}

test('a thousand repeated gathers retain one compatible stack, every harvest receipt, matter and existing IDs',()=>{
  const f=fixture(),ids=f.world.objects.map(o=>o.id),count=ids.length,initialEntities=new Set([...ids,...f.world.resourceDeposits.map(d=>d.id),...f.world.buildings.map(b=>b.id),f.c.id]);
  for(let i=0;i<1000;i++)gather(f);
  const stacks=f.world.objects.filter(o=>o.holderId===f.c.id&&o.provenance?.depositId===f.d.id);
  assert.equal(stacks.length,1);assert.equal(f.world.objects.length,count+1);assert.equal(stacks[0].quantity,2000);assert.equal(f.d.quantity,3000);
  assert.ok(ids.every(id=>f.world.objects.some(o=>o.id===id)));assert.equal(new Set(f.c.possessions).size,f.c.possessions.length);
  assert.deepEqual(f.c.knownEntityIds.filter(id=>!initialEntities.has(id)),[stacks[0].id],'harvests must introduce only one new personal entity membership');
  const receipts=f.world.ledger.filter(e=>e.type==='RESOURCE_GATHERED');assert.equal(receipts.length,1000);assert.equal(new Set(receipts.map(e=>e.causes[0])).size,1000);
  assert.equal(stacks[0].provenance.actionId,receipts[0].causes[0]);assert.equal(stacks[0].lastPhysicalEventId,receipts.at(-1).id);assert.equal(verifyLedger(f.world),true);
});

test('gathering never refills transformed, reserved, foreign or different-source objects',()=>{
  for(const change of [{holderId:'other'},{reservedProjectId:'project:x'},{condition:.5},{temperatureC:80},{geometry:{lengthM:1}},{properties:{processed:true}},{provenance:{type:'GATHERED',depositId:'other'}}]){
    const f=fixture();gather(f);const original=f.world.objects.find(o=>o.holderId===f.c.id&&o.provenance?.depositId===f.d.id);Object.assign(original,change);const quantity=original.quantity;
    gather(f);assert.equal(original.quantity,quantity);assert.equal(f.world.objects.filter(o=>o.kind==='gathered_material').length,2);
  }
});

test('depleted and fractional deposits cannot manufacture matter or go negative',()=>{
  const f=fixture();f.d.quantity=.03;gather(f,2);
  const stack=f.world.objects.find(o=>o.holderId===f.c.id&&o.provenance?.depositId===f.d.id);assert.equal(stack.quantity,.03);assert.equal(f.d.quantity,0);
  gather(f,2);assert.equal(stack.quantity,.03);assert.equal(f.d.quantity,0);assert.equal(f.world.ledger.filter(e=>e.type==='RESOURCE_GATHERED').length,1);
});
