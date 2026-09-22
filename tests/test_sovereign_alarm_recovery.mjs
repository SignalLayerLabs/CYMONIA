import test from 'node:test';
import assert from 'node:assert/strict';
import {SovereignWorld} from '../worker/src/index.js';
import {createSovereignGenesis,advanceWorldTo,REAL_MS_PER_WORLD_MINUTE} from '../world/index.js';

// Cloudflare owns storage and scheduling. Exercise the real handler with
// deterministic clock/storage boundaries; do not construct a fake SQL engine.
function runtime(t){
  t.mock.method(Date,'now',()=>60_000);
  const alarms=[];
  const instance=Object.create(SovereignWorld.prototype);
  Object.assign(instance,{
    world:createSovereignGenesis({realEpochMs:59_000}),
    env:{},lastPersistedWorldMinute:0,
    ctx:{storage:{getAlarm:async()=>null,setAlarm:async value=>{alarms.push(value);}},getWebSockets:()=>[]},
  });
  return {instance,alarms};
}

test('existing due or future alarms are never postponed during initialization',async t=>{
  const {instance,alarms}=runtime(t);
  for(const current of [0,30_000,90_000]){
    instance.ctx.storage.getAlarm=async()=>current;
    await instance.ensureAlarm();
  }
  assert.deepEqual(alarms,[]);
});

test('initialization arms a missing alarm one minute ahead',async t=>{
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
