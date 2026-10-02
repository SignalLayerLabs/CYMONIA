import test from 'node:test';
import assert from 'node:assert/strict';
import {SovereignWorld,advanceWorldBounded} from '../worker/src/index.js';
import {createSovereignGenesis,advanceWorldTo} from '../world/index.js';

function activeWorld(){
  const world=createSovereignGenesis({realEpochMs:0});
  advanceWorldTo(world,1000);
  return world;
}
test('one CPU pulse completes a single simulation boundary and reports the remaining lag',()=>{
  const world=activeWorld();
  const earliest=Math.min(...world.actions.filter(a=>a.status==='active').map(a=>a.endsWorldMinute));
  assert.ok(earliest<30);
  const progress=advanceWorldBounded(world,30000,30,360,{maxSegments:1});
  assert.equal(world.clock.worldMinute,earliest);
  assert.equal(progress.lagWorldMinutes,30-earliest);
  assert.ok(world.citizens.every(c=>c.cognition.lastReflectionMinute<=earliest));
});
test('separate pulses preserve the deterministic simulation result',()=>{
  const full=activeWorld();
  for(const c of full.citizens)c.cognition.lastReflectionMinute=null;
  const pulsed=structuredClone(full);
  advanceWorldTo(full,30000);
  while(pulsed.clock.worldMinute<30)advanceWorldTo(pulsed,30000,{maxSegments:1});
  assert.deepEqual(pulsed,full);
});
function pulseRuntime(t){
  t.mock.method(Date,'now',()=>61000);
  const world=activeWorld();
  const instance=Object.create(SovereignWorld.prototype);
  const saved=[],alarms=[];
  Object.assign(instance,{world,env:{},lastPersistedWorldMinute:0,
    mutateWorld:fn=>fn(),processCognition:async()=>false,
    persist:async options=>{saved.push({minute:world.clock.worldMinute,options});return {persisted:true};},
    ctx:{getWebSockets:()=>[],storage:{setAlarm:async value=>alarms.push(value),sync:async()=>{},put:async()=>{}}}});
  return {instance,saved,alarms};
}
test('recovery checkpoint gets its own invocation and does not advance again while saving',async t=>{
  const {instance,saved}=pulseRuntime(t);
  instance.pendingTrimmedMemories=1;
  await instance.tick(30,360,{maxSegments:1,deferCheckpoint:true});
  assert.equal(saved.length,0,'advancement must not share CPU with compression');
  const minute=instance.world.clock.worldMinute;
  await instance.tick(30,360,{maxSegments:1,deferCheckpoint:true});
  assert.deepEqual(saved,[{minute,options:{forceSeal:true}}]);
  assert.equal(instance.world.clock.worldMinute,minute);
  assert.equal(instance.pendingTrimmedMemories,0);
});
test('a pending checkpoint remains queued when durable saving fails',async t=>{
  const {instance}=pulseRuntime(t);
  instance.pendingTrimmedMemories=1;
  await instance.tick(30,360,{maxSegments:1,deferCheckpoint:true});
  instance.persist=async()=>{throw new Error('write budget deferred');};
  await assert.rejects(instance.tick(30,360,{maxSegments:1,deferCheckpoint:true}),/write budget deferred/);
  assert.equal(instance.pendingCheckpoint,true);
  assert.equal(instance.pendingTrimmedMemories,1);
});
test('alarm drains a healthy backlog promptly after committing its fallback successor',async t=>{
  const {instance,alarms}=pulseRuntime(t);
  await instance.alarm();
  assert.deepEqual(alarms,[63500],'one healthy pulse must write exactly one alarm');
  assert.equal(instance.world.runtime.nextAlarmRealMs,alarms[0]);
  assert.ok(instance.world.clock.worldMinute<31,'alarm must use the segment bound');
});

test('caught-up uncommitted progress keeps the object warm before the ten-second hibernation window',async t=>{
  const {instance,alarms}=pulseRuntime(t);
  instance.world.clock.realEpochMs=60000; // target equals its existing minute
  await instance.alarm();
  assert.equal(instance.pendingCheckpoint,undefined);
  assert.ok(alarms.at(-1)>61000&&alarms.at(-1)<71000);
});

test('runtime pulses finish their original catch-up target before scheduling reflection',async t=>{
  const {instance}=pulseRuntime(t);
  for(const c of instance.world.citizens)c.cognition.lastReflectionMinute=null;
  for(let i=0;i<40&&instance.world.clock.worldMinute<31;i++)await instance.tick(30,360,{maxSegments:1,deferCheckpoint:true});
  assert.equal(instance.world.clock.worldMinute,31);
  assert.ok(instance.world.citizens.every(c=>c.cognition.lastReflectionMinute===31));
});

test('quiet production alarms retain unsaved minutes until a durable checkpoint',async t=>{
  const {sqliteStorage,wake,readWorld}=await import('./helpers/sovereign-sqlite.mjs');
  let now=61000;
  t.mock.method(Date,'now',()=>now);
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  let {instance}=await wake(storage);
  instance.ctx.getWebSockets=()=>[];
  instance.world.citizens=[];
  instance.world.clock.realEpochMs=now;
  await instance.persist({forceSeal:true});
  await instance.ensureAlarm();
  const initialId=instance.world.worldId;
  for(let i=0;i<40;i++){
    const next=await storage.getAlarm();
    if(next-now>=10000){
      ({instance}=await wake(storage));
      instance.ctx.getWebSockets=()=>[];
    }
    now=next;
    await instance.alarm();
    if(instance.lastPersistedWorldMinute>=60)break;
  }
  assert.ok(instance.lastPersistedWorldMinute>=60,'silent world must save progress before its next cold wake');
  const {instance:restarted}=await wake(storage);
  assert.equal((await readWorld(restarted)).clock.worldMinute,instance.lastPersistedWorldMinute);
  assert.equal(restarted.world.worldId,initialId);
});

test('cognition at a committed clock still has a warm successor for its pending checkpoint',async t=>{
  const {instance,alarms}=pulseRuntime(t);
  instance.world.clock.realEpochMs=60000;
  instance.lastPersistedWorldMinute=instance.world.clock.worldMinute;
  instance.processCognition=async()=>true;
  await instance.alarm();
  assert.equal(instance.pendingCheckpoint,true);
  assert.ok(alarms.at(-1)<71000,'new private mutations must be saved before hibernation');
});
