import test from 'node:test';
import assert from 'node:assert/strict';
import {SovereignWorld} from '../worker/src/index.js';
import {createSovereignGenesis,advanceWorldTo,REAL_MS_PER_WORLD_MINUTE} from '../world/index.js';

// Cloudflare owns storage and scheduling. Exercise the real handler with
// deterministic clock/storage boundaries; do not construct a fake SQL engine.
function runtime(t){
  t.mock.method(Date,'now',()=>60_000);
  const alarms=[];
  const status=new Map();
  let scheduledAlarm=null;
  const instance=Object.create(SovereignWorld.prototype);
  Object.assign(instance,{
    world:createSovereignGenesis({realEpochMs:59_000}),
    env:{},lastPersistedWorldMinute:0,
    ctx:{storage:{
      getAlarm:async()=>scheduledAlarm,
      setAlarm:async value=>{scheduledAlarm=value;alarms.push(value);},
      get:async key=>status.get(key),
      put:async(key,value)=>{status.set(key,structuredClone(value));},
    },getWebSockets:()=>[]},
  });
  return {instance,alarms,alarmTime:()=>scheduledAlarm,setStoredAlarm:value=>{scheduledAlarm=value;}};
}

async function wakeWorld(storage,persistedWorld=createSovereignGenesis({realEpochMs:59_000})){
  let initialized;
  class WakingWorld extends SovereignWorld {
    initializeSQLite(){}
    async loadWorld(){
      this.lastPersistedGeneration='slot-b';
      return structuredClone(persistedWorld);
    }
  }
  const ctx={
    storage:{sql:{},get:async()=>null,...storage},
    getWebSockets:()=>[],
    blockConcurrencyWhile:callback=>{initialized=callback();},
  };
  const instance=new WakingWorld(ctx,{});
  await initialized;
  return instance;
}

test('constructor never reads or schedules an alarm while a Durable Object wakes',async t=>{
  t.mock.method(Date,'now',()=>60_000);
  const reads=[],writes=[];
  await wakeWorld({
    getAlarm:async()=>{reads.push(true);return null;},
    setAlarm:async value=>{writes.push(value);},
  });
  assert.deepEqual(reads,[]);
  assert.deepEqual(writes,[]);
});

test('an ordinary HTTP fetch repairs a missing alarm without advancing the world',async t=>{
  const {instance,alarmTime}=runtime(t);
  const before=instance.world.clock.worldMinute;
  const response=await instance.fetch(new Request('https://example.com/world/state'));
  assert.equal(response.status,200);
  assert.equal(alarmTime(),120_000);
  assert.equal(instance.world.clock.worldMinute,before);
});

test('an HTTP fetch repairs a long-overdue alarm once without postponing its replacement',async t=>{
  const {instance,alarms,alarmTime,setStoredAlarm}=runtime(t);
  setStoredAlarm(-180_000);
  await instance.fetch(new Request('https://example.com/world/state'));
  assert.equal(alarmTime(),120_000);
  await instance.fetch(new Request('https://example.com/world/state'));
  assert.deepEqual(alarms,[120_000]);
});

test('alarm stores its successor before running the world tick',async t=>{
  const {instance,alarmTime}=runtime(t);
  instance.tick=async()=>{assert.equal(alarmTime(),120_000);};
  await instance.alarm();
  assert.equal(instance.world.runtime.lastTickError,null);
});

test('a tick exception leaves its successor armed and records the failure',async t=>{
  const {instance,alarmTime}=runtime(t);
  t.mock.method(console,'error',()=>{});
  instance.tick=async()=>{
    assert.equal(alarmTime(),120_000);
    throw new Error('injected fatal tick');
  };
  await assert.doesNotReject(instance.alarm({retryCount:1}));
  assert.equal(alarmTime(),120_000);
  assert.match(instance.world.runtime.lastTickError,/injected fatal tick/);
  assert.equal(instance.world.runtime.lastAlarmRetryCount,1);
});

test('repeated hibernation and wakeup preserve an existing due alarm',async t=>{
  t.mock.method(Date,'now',()=>60_000);
  let scheduledAlarm=30_000,reads=0,writes=0;
  const storage={
    getAlarm:async()=>{reads++;return scheduledAlarm;},
    setAlarm:async value=>{writes++;scheduledAlarm=value;},
  };
  for(let wake=0;wake<3;wake++){
    const instance=await wakeWorld(storage);
    assert.equal(reads,wake,'constructor must not inspect a waking alarm');
    assert.equal(scheduledAlarm,30_000);
    const response=await instance.fetch(new Request('https://example.com/world/state'));
    assert.equal(response.status,200);
    assert.equal(scheduledAlarm,30_000);
    assert.equal(writes,0);
  }
  assert.equal(reads,3);
});

test('health reports the real alarm and tick diagnostics without synthetic advancement',async t=>{
  const {instance,alarmTime}=runtime(t);
  instance.readPersistenceBudget=()=>({day:'1970-01-01',rowsWritten:0});
  instance.world.runtime={
    lastTickRealMs:55_000,
    lastTickWorldMinute:7,
    lastTickError:'previous tick failed',
    lastAlarmRetryCount:2,
  };
  const before=instance.world.clock.worldMinute;
  const response=await instance.fetch(new Request('https://example.com/world/health'));
  const health=await response.json();
  assert.equal(response.status,200);
  assert.equal(alarmTime(),120_000);
  assert.deepEqual(health.heartbeat,{
    scheduledAlarmRealMs:120_000,
    nextAlarmRealMs:120_000,
    lastTickRealMs:55_000,
    lastTickWorldMinute:7,
    lastTickError:'previous tick failed',
    lastAlarmRetryCount:2,
  });
  assert.equal(health.world_minute,before);
  assert.equal(instance.world.clock.worldMinute,before);
});

test('successful tick diagnostics survive a wakeup after the world snapshot',async t=>{
  const {instance}=runtime(t);
  let persistedWorld;
  instance.tick=async()=>{
    instance.world.clock.worldMinute=60;
    persistedWorld=structuredClone(instance.world);
  };
  await instance.alarm();
  assert.equal(persistedWorld.runtime?.lastTickRealMs,undefined);
  const waking=await wakeWorld(instance.ctx.storage,persistedWorld);
  waking.readPersistenceBudget=()=>({day:'1970-01-01',rowsWritten:0});
  const health=await (await waking.fetch(new Request('https://example.com/world/health'))).json();
  assert.equal(health.world_minute,60);
  assert.equal(health.heartbeat.lastTickRealMs,60_000);
  assert.equal(health.heartbeat.lastTickWorldMinute,60);
  assert.equal(health.heartbeat.lastTickError,null);
});

test('failed tick diagnostics survive a wakeup and leave the alarm armed',async t=>{
  const {instance,alarmTime}=runtime(t);
  t.mock.method(console,'error',()=>{});
  instance.tick=async()=>{throw new Error('malformed action');};
  await instance.alarm({retryCount:3});
  const waking=await wakeWorld(instance.ctx.storage);
  waking.readPersistenceBudget=()=>({day:'1970-01-01',rowsWritten:0});
  const health=await (await waking.fetch(new Request('https://example.com/world/health'))).json();
  assert.equal(alarmTime(),120_000);
  assert.match(health.heartbeat.lastTickError,/malformed action/);
  assert.equal(health.heartbeat.lastAlarmRetryCount,3);
});

test('ensureAlarm preserves existing due and future alarms',async t=>{
  const {instance,alarms}=runtime(t);
  for(const current of [0,30_000,90_000]){
    instance.ctx.storage.getAlarm=async()=>current;
    await instance.ensureAlarm();
  }
  assert.deepEqual(alarms,[]);
});

test('ensureAlarm arms a missing alarm one minute ahead',async t=>{
  const {instance,alarms}=runtime(t);
  await instance.ensureAlarm();
  assert.deepEqual(alarms,[120_000]);
});

test('successful alarm advances the real world and schedules the next heartbeat',async t=>{
  const {instance,alarms}=runtime(t);
  instance.world.runtime={lastTickError:'previous failure'};
  await instance.alarm();
  assert.ok(instance.world.clock.worldMinute>0);
  assert.ok(instance.world.citizens.some(c=>c.currentActionId));
  assert.equal(instance.world.runtime.lastTickError,null);
  assert.deepEqual(alarms,[120_000]);
});

test('failed tick is diagnosed and the next alarm can recover',async t=>{
  const {instance,alarms}=runtime(t);
  const logs=[];
  t.mock.method(console,'error',(...args)=>logs.push(args));
  const original=instance.processCognition;
  instance.processCognition=async()=>{throw new Error('injected cognition outage');};
  await assert.doesNotReject(instance.alarm({retryCount:2,isRetry:true}));
  assert.match(instance.world.runtime.lastTickError,/injected cognition outage/);
  assert.equal(instance.world.runtime.lastAlarmRetryCount,2);
  assert.equal(logs[0][0],'CYMONIA_TICK_FAILED');
  assert.deepEqual(alarms,[120_000]);
  instance.processCognition=original;
  await instance.alarm();
  assert.equal(instance.world.runtime.lastTickError,null);
  assert.deepEqual(alarms,[120_000,120_000]);
});

test('rescheduling failure remains visible to Cloudflare for retry',async t=>{
  const {instance}=runtime(t);
  instance.ctx.storage.setAlarm=async()=>{throw new Error('storage unavailable');};
  await assert.rejects(instance.alarm(),/storage unavailable/);
});

test('one malformed local goal falls back to observation while peers continue',()=>{
  const world=createSovereignGenesis({realEpochMs:0});
  const citizen=world.citizens[0];
  citizen.activeGoal={actionTypes:{invalid:true}};
  assert.doesNotThrow(()=>advanceWorldTo(world,REAL_MS_PER_WORLD_MINUTE));
  assert.equal(world.clock.worldMinute,1);
  assert.equal(world.actions.find(a=>a.id===citizen.currentActionId)?.type,'OBSERVE');
  assert.ok(world.citizens.slice(1).some(c=>c.currentActionId));
  assert.ok(world.ledger.some(e=>e.type==='LOCAL_COGNITION_DEFERRED'&&e.actorId===citizen.id));
});

test('fallback action failure is propagated instead of silently reported as recovery',()=>{
  const world=createSovereignGenesis({realEpochMs:0});
  Object.freeze(world.actions);
  assert.throws(()=>advanceWorldTo(world,REAL_MS_PER_WORLD_MINUTE),TypeError);
  assert.ok(world.ledger.some(e=>e.type==='LOCAL_PLAN_REJECTED'));
});

test('rejected local plan starts observation and does not block peer actions',()=>{
  const world=createSovereignGenesis({realEpochMs:0});
  const citizen=world.citizens[0];
  citizen.plans=null;
  assert.doesNotThrow(()=>advanceWorldTo(world,REAL_MS_PER_WORLD_MINUTE));
  assert.equal(world.actions.find(a=>a.id===citizen.currentActionId)?.type,'OBSERVE');
  assert.ok(world.citizens.slice(1).some(c=>c.currentActionId));
  assert.ok(world.ledger.some(e=>e.type==='LOCAL_PLAN_REJECTED'&&e.actorId===citizen.id));
});
