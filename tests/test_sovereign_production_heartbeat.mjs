import test from 'node:test';
import assert from 'node:assert/strict';
import {SovereignWorld} from '../worker/src/index.js';
import {createSovereignGenesis} from '../world/index.js';

function instanceAt(t,now=60_000){
  t.mock.method(Date,'now',()=>now);
  let scheduledAlarm=-180_000;
  const alarmWrites=[];
  const instance=Object.create(SovereignWorld.prototype);
  Object.assign(instance,{
    world:createSovereignGenesis({realEpochMs:59_000}),
    committedWorld:null,
    env:{},
    ctx:{
      storage:{
        getAlarm:async()=>scheduledAlarm,
        setAlarm:async value=>{scheduledAlarm=value;alarmWrites.push(value);},
        get:async()=>null,
        put:async()=>{},
      },
      getWebSockets:()=>[],
    },
    readPersistenceBudget:()=>({day:'1970-01-01',rowsWritten:0}),
  });
  return {instance,alarmWrites,alarmTime:()=>scheduledAlarm};
}

test('repeated health polling preserves an overdue alarm for Cloudflare delivery',async t=>{
  const {instance,alarmWrites,alarmTime}=instanceAt(t);
  const first=await instance.ensureAlarm();
  assert.equal(first,-180_000);
  assert.equal(alarmTime(),-180_000);
  for(let i=0;i<50;i++){
    const current=await instance.ensureAlarm();
    assert.equal(current,-180_000);
  }
  assert.deepEqual(alarmWrites,[]);
  assert.equal(instance.world.runtime.lastAlarmRecoveryReason,'overdue_alarm_preserved');
});

test('health exposes stale-heartbeat diagnostics without advancing canonical time',async t=>{
  const {instance}=instanceAt(t);
  instance.world.runtime={
    lastTickRealMs:-70_000,
    lastTickWorldMinute:0,
    lastTickError:null,
    lastAlarmRetryCount:0,
  };
  const before=instance.world.clock.worldMinute;
  const response=await instance.fetch(new Request('https://example.com/world/health'));
  const health=await response.json();
  assert.equal(response.status,200);
  assert.equal(instance.world.clock.worldMinute,before);
  assert.equal(health.heartbeat.scheduledAlarmRealMs,-180_000);
  assert.ok(health.heartbeat.alarm_overdue_ms>0);
  assert.equal(health.heartbeat.tick_stalled,true);
  assert.ok(health.heartbeat.tick_stale_ms>=50_000);
});

test('a recent due alarm remains untouched while Cloudflare is expected to deliver it',async t=>{
  t.mock.method(Date,'now',()=>60_000);
  let scheduledAlarm=30_000,writes=0;
  const instance=Object.create(SovereignWorld.prototype);
  Object.assign(instance,{
    world:createSovereignGenesis({realEpochMs:59_000}),
    ctx:{storage:{
      getAlarm:async()=>scheduledAlarm,
      setAlarm:async value=>{writes++;scheduledAlarm=value;},
    }},
  });
  assert.equal(await instance.ensureAlarm(),30_000);
  assert.equal(writes,0);
});
