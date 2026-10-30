import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {advanceBody,killCitizen} from '../world/biology.js';
import {survivalFallback} from '../world/cognition.js';
import {perceiveResources} from '../world/perception.js';
import {totalTrackedMass} from '../world/materials.js';
import {classifyHistory} from '../world/observer.js';
import {verifyLedger,compactLedger,appendEvent} from '../world/ledger.js';

test('a nourished hydrated rested citizen recovers health; deprivation still damages',()=>{
  const w=createSovereignGenesis({seed:3,realEpochMs:0}),c=w.citizens[0];
  c.body.health=50;c.body.hydration=90;c.body.calories=90;c.body.sleepPressure=10;
  w.environment.temperatureC=20;w.environment.precipitation=0;
  advanceBody(w,c,30);assert.ok(c.body.health>50);
  c.body.hydration=0;const before=c.body.health;
  advanceBody(w,c,30);assert.ok(c.body.health<before);
});

test('survival skips an exhausted known food deposit',()=>{
  const w=createSovereignGenesis({seed:3,realEpochMs:0}),c=w.citizens[0];
  const d=w.resourceDeposits.find(d=>d.type==='food');c.position={...d.position};
  w.resourceDeposits.push({...d,id:'food:available',position:{x:56,y:46},quantity:10});
  perceiveResources(w,c,0);d.quantity=0;c.body.calories=20;c.body.sleepPressure=0;
  assert.equal(survivalFallback(w,c).actions.at(-1).targetId,'food:available');
});

test('critical nutrition takes priority over sleep',()=>{
  const w=createSovereignGenesis({seed:3,realEpochMs:0}),c=w.citizens[0];
  c.position={x:55,y:46};perceiveResources(w,c,0);
  c.body.calories=0;c.body.hydration=90;c.body.sleepPressure=100;
  assert.equal(survivalFallback(w,c).actions.at(-1).type,'EAT');
});

test('authorized incident repair inserts 100 once, preserves history and mass across reload',async()=>{
  const {applySystemRepair,SYSTEM_REPAIR_ID}=await import('../world/system-repair.js');
  const w=createSovereignGenesis({realEpochMs:0});
  for(const c of w.citizens)killCitizen(w,c,'system_bug',100);
  w.clock.worldMinute=1941000;
  const before=totalTrackedMass(w),dead=w.citizens.map(c=>JSON.stringify(c));
  assert.equal(applySystemRepair(w,null),false);
  assert.equal(applySystemRepair(w,SYSTEM_REPAIR_ID),true);
  assert.equal(w.citizens.filter(c=>c.alive).length,100);
  assert.deepEqual(w.citizens.slice(0,100).map(c=>JSON.stringify(c)),dead);
  assert.equal(new Set(w.citizens.map(c=>c.id)).size,200);
  assert.ok(Math.abs(totalTrackedMass(w)-before)<1e-6);
  assert.ok(verifyLedger(w));
  assert.match(classifyHistory(w).entries.find(e=>e.category==='system').label,/100.*bug di sistema/);
  appendEvent(w,'OBSERVATION','world',{},[],w.clock.worldMinute+1);
  compactLedger(w,1);
  assert.match(classifyHistory(w).entries.find(e=>e.category==='system')?.label||'',/100.*bug di sistema/);
  const loaded=JSON.parse(JSON.stringify(w));
  assert.equal(applySystemRepair(loaded,SYSTEM_REPAIR_ID),false);
  assert.equal(loaded.citizens.length,200);
});

test('production wake commits the incident and a second wake never duplicates it',async t=>{
  const {sqliteStorage,wake,readWorld}=await import('./helpers/sovereign-sqlite.mjs');
  const {SYSTEM_REPAIR_ID}=await import('../world/system-repair.js');
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);
  instance.world.clock.worldMinute=1941000;
  await instance.persist({forceSeal:true});
  const {instance:repaired}=await wake(storage,{SYSTEM_REPAIR_ID});
  assert.equal(repaired.world.citizens.length,200);
  const visible=await readWorld(repaired);
  assert.equal(visible.citizens.filter(c=>c.kind==='SYSTEM_RECOVERY').length,100);
  assert.ok(visible.history.some(e=>e.category==='system'));
  const {instance:reloaded}=await wake(storage,{SYSTEM_REPAIR_ID});
  assert.equal(reloaded.world.citizens.length,200);
  assert.ok(reloaded.world.systemRepairs[SYSTEM_REPAIR_ID]);
});
