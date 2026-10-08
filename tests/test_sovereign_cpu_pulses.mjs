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
  assert.ok(instance.world.clock.worldMinute<=31,'alarm must retain the thirty-minute catch-up bound');
});

test('a delayed alarm completes its bounded thirty-minute target across dense action boundaries',async t=>{
  const {instance,saved}=pulseRuntime(t),world=instance.world,start=world.clock.worldMinute;
  world.actions=world.citizens.map((c,i)=>{
    const action={id:`dense:${i}`,actorId:c.id,type:'REST',status:'active',startedWorldMinute:start,
      endsWorldMinute:start+1+i%30,payload:{},concepts:[]};c.currentActionId=action.id;return action;
  });
  const expected=structuredClone(world);advanceWorldTo(expected,(start+30)*1000);
  await instance.alarm();
  assert.equal(world.clock.worldMinute,start+30,'delayed delivery must not limit a mature world to six one-minute action boundaries');
  assert.equal(saved.length,0,'advancement must remain separate from compression');
  // Runtime alarm diagnostics are distinct from the deterministic kernel.
  delete world.runtime;
  assert.deepEqual(world,expected);
});

test('dense alarm work yields between physical boundaries without extending its target',async t=>{
  const {instance}=pulseRuntime(t),world=instance.world,start=world.clock.worldMinute;
  world.actions=world.citizens.map((c,i)=>{
    const action={id:`cooperative:${i}`,actorId:c.id,type:'REST',status:'active',startedWorldMinute:start,
      endsWorldMinute:start+1+i%30,payload:{},concepts:[]};c.currentActionId=action.id;return action;
  });
  const expected=structuredClone(world);advanceWorldTo(expected,(start+30)*1000);
  const yielded=[];
  instance.yieldRuntime=async()=>{yielded.push(world.clock.worldMinute);};
  await instance.alarm();
  assert.ok(yielded.length>=29,'incoming autonomous heartbeats must be dispatchable between CPU boundaries');
  assert.ok(yielded.every(minute=>minute>start&&minute<start+30));
  delete world.runtime;assert.deepEqual(world,expected);
});

test('dense actions keep pace and save real progress when alarms arrive fifteen seconds apart',async t=>{
  const {instance,saved}=pulseRuntime(t),world=instance.world;
  let now=61000;t.mock.method(Date,'now',()=>now);
  world.actions=world.citizens.map((c,i)=>{
    const action={id:`delayed:${i}`,actorId:c.id,type:'REST',status:'active',startedWorldMinute:1,
      endsWorldMinute:2+i%30,payload:{},concepts:[]};c.currentActionId=action.id;return action;
  });
  const initial=structuredClone(world.citizens.map(c=>c.body));
  instance.persist=async options=>{saved.push({minute:world.clock.worldMinute,options});instance.lastPersistedWorldMinute=world.clock.worldMinute;return {persisted:true};};
  for(let i=0;i<12;i++){await instance.alarm();now+=15000;}
  assert.ok(now/1000-world.clock.worldMinute<30,'physical time must keep up despite delivery jitter and separate saves');
  assert.ok(instance.lastPersistedWorldMinute>=120,'unattended progress must reach a durable checkpoint');
  assert.notDeepEqual(world.citizens.map(c=>c.body),initial,'actual biology must advance with the clock');
  assert.ok(!world.ledger.some(e=>e.type==='RUNTIME_LAG_REBASED'),'healthy delayed alarms must not discard time as an outage');
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
  let lastRenewal=-Infinity;
  let renewalToken=null;
  for(let i=0;i<40;i++){
    const next=await storage.getAlarm();
    if(next-now>=10000){
      ({instance}=await wake(storage));
      instance.ctx.getWebSockets=()=>[];
    }
    now=next;
    if(now-lastRenewal>=20000){
      const response=await instance.fetch(new Request('https://internal/world/runtime-heartbeat',{headers:renewalToken?{'x-cymonia-cpu-renewal':renewalToken}:{}}));
      renewalToken=(await response.json()).cpu_renewal_token;
      lastRenewal=now;
    }
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
  instance.pendingCheckpoint=true;
  instance.processCognition=async()=>true;
  await instance.alarm();
  assert.equal(instance.pendingCheckpoint,false);
  assert.ok(alarms.at(-1)<71000,'new private mutations must be saved before hibernation');
});

test('successful cognition shares a planned checkpoint instead of forcing a save on every physics pulse',async t=>{
  const {instance,saved}=pulseRuntime(t);let cognition=0;
  instance.lastSnapshotChunkCount=25;
  instance.processCognition=async()=>{cognition++;return true;};
  await instance.tick(30,360,{maxSegments:6,deferCheckpoint:true});
  assert.equal(cognition,0,'physics pulses must not enter expensive AI/checkpoint feedback');
  assert.equal(instance.pendingCheckpoint,undefined);
  assert.equal(saved.length,0);
  t.mock.method(Date,'now',()=>180000);
  for(let i=0;i<50&&!instance.pendingCheckpoint;i++)await instance.tick(30,360,{maxSegments:6,deferCheckpoint:true});
  assert.equal(cognition,0);
  assert.ok(instance.world.clock.worldMinute>=80,'large checkpoints must fit the daily normal write budget');
  const minute=instance.world.clock.worldMinute;
  await instance.tick(30,360,{maxSegments:6,deferCheckpoint:true});
  assert.equal(cognition,1);assert.equal(saved.length,1);
  assert.equal(saved[0].minute,minute);assert.equal(instance.world.clock.worldMinute,minute);
  assert.equal(instance.pendingCheckpoint,false);
});
