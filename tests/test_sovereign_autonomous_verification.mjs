import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const url=new URL('../scripts/verify_autonomous_world.mjs',import.meta.url);
async function validator(){assert.ok(existsSync(url),'unattended production verification is missing');return (await import(url)).verifyAutonomousSamples;}
function fixture(){
  const a={ok:true,world_id:'preserved',world_minute:200,clock_high_water_mark:200,last_checkpoint_real_ms:100000};
  const b={...a,world_minute:380,clock_high_water_mark:380,last_checkpoint_real_ms:280000,lag_world_minutes:20,heartbeat:{tick_stalled:false,lastTickError:null},scheduler:{last_received_real_ms:270000}};
  const citizen={id:'existing',position:{x:1,y:1},body:{ageMinutes:200},currentAction:{id:'action-a'}};
  const sa={worldId:'preserved',clock:{worldMinute:200},citizens:[citizen]};
  const sb={worldId:'preserved',clock:{worldMinute:380},citizens:[{...citizen,position:{x:3,y:1},body:{ageMinutes:380},currentAction:{id:'action-b'}}]};
  return {a,b,sa,sb};
}
test('autonomous proof requires confirmed time and real citizen changes with a fresh scheduler',async()=>{
  const verify=await validator(),{a,b,sa,sb}=fixture();
  const result=verify(a,b,sa,sb,300000);
  assert.equal(result.advancedMinutes,180);assert.equal(result.changedActions,1);assert.equal(result.moved,1);
});
test('HTTP success and a recent tick cannot hide a missing autonomous scheduler',async()=>{
  const verify=await validator(),{a,b,sa,sb}=fixture();b.scheduler.last_received_real_ms=null;
  assert.throws(()=>verify(a,b,sa,sb,300000),/scheduler/);
});
test('a moving calendar alone cannot satisfy autonomous world verification',async()=>{
  const verify=await validator(),{a,b,sa,sb}=fixture();sb.citizens=structuredClone(sa.citizens);
  assert.throws(()=>verify(a,b,sa,sb,300000),/citizen state/);
});
test('autonomous verification rejects a stalled heartbeat, a lagging clock and a stale scheduler',async()=>{
  const verify=await validator();
  for(const mutate of [b=>b.heartbeat.tick_stalled=true,b=>b.lag_world_minutes=500,b=>b.scheduler.last_received_real_ms=100000]){
    const {a,b,sa,sb}=fixture();mutate(b);assert.throws(()=>verify(a,b,sa,sb,300000));
  }
});

test('the CI command defaults to a genuine three-minute quiet interval',async()=>{
  const {quietIntervalMs}=await import('../scripts/verify_autonomous_world.mjs');
  assert.equal(typeof quietIntervalMs,'function','CLI quiet interval parsing is missing');
  assert.equal(quietIntervalMs([]),180000);
  assert.equal(quietIntervalMs(['--quiet-ms','600000']),600000);
  assert.throws(()=>quietIntervalMs(['--quiet-ms']));
  assert.throws(()=>quietIntervalMs(['--quiet-ms','1000']));
});

test('the final read cannot rescue a checkpoint and count it as unattended advancement',async()=>{
  const verify=await validator(),{a,b,sa,sb}=fixture();
  a.last_checkpoint_real_ms=100000;b.last_checkpoint_real_ms=295000;
  assert.throws(()=>verify(a,b,sa,sb,300000,{quietEndedRealMs:290000}),/checkpoint.*quiet/);
});
