import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
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


test('production CI recognizes a durable checkpoint after slots cycle back to the same name',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
  const block=[...workflow.matchAll(/node <<'NODE'\n([\s\S]*?)\n          NODE/g)].find(match=>match[1].includes('health-c.json'))[1];
  const health=minute=>({ok:true,service:'cymonia-sovereign-world',world_id:'canonical',world_minute:minute,clock_high_water_mark:minute,persisted_generation:'slot-a',heartbeat:{lastTickError:null,tick_stalled:false}});
  const states={a:health(100),b:health(160),c:health(220)};
  const verify=()=>runInNewContext(block,{require:()=>({readFileSync:path=>JSON.stringify(states[path.match(/health-([abc])/)[1]])}),console:{log(){}}});
  assert.doesNotThrow(verify);
  states.c.clock_high_water_mark=100;
  assert.throws(verify,/canonical snapshot was not persisted/);
  states.c.clock_high_water_mark=220;states.c.heartbeat.tick_stalled=true;
  assert.throws(verify,/heartbeat remains unhealthy/);
});
