import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{SovereignWorld} from '../worker/src/index.js';
import {createSovereignGenesis} from '../world/index.js';

const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function setup(t,{failFirst=false}={}){
  t.mock.timers.enable({apis:['Date','setTimeout'],now:60000});
  t.mock.method(console,'log',()=>{});t.mock.method(console,'error',()=>{});
  let alarm=null,requests=0;
  const instance=Object.create(SovereignWorld.prototype);
  Object.assign(instance,{world:createSovereignGenesis({realEpochMs:0}),env:{},
    ctx:{storage:{getAlarm:async()=>alarm,setAlarm:async value=>{alarm=value;},get:async()=>null,put:async()=>{}},getWebSockets:()=>[]},
    readPersistenceBudget:()=>({day:'1970-01-01',rowsWritten:0})});
  const windows=[],waits=[];
  const env={WORLD:{
    idFromName:name=>{assert.equal(name,'canonical-v2','scheduled work must target the existing world');return name;},
    get:id=>({fetch:async request=>{
      assert.equal(id,'canonical-v2');requests++;
      if(failFirst&&requests===1)throw new Error('temporary object reset');
      const response=await instance.fetch(new Request(request));
      assert.equal(response.status,200,'heartbeat must reach the actual read handler');
      windows.push(Date.now());return response;
    }})}};
  const ctx={waitUntil:p=>waits.push(p)};
  return {instance,windows,waits,env,ctx,alarm:()=>alarm};
}

test('scheduled heartbeat gives an unattended existing world incoming requests throughout the minute',async t=>{
  const s=setup(t);assert.equal(typeof worker.scheduled,'function','autonomous CPU-window renewal is missing');
  worker.scheduled({scheduledTime:60000,cron:'* * * * *'},s.env,s.ctx);
  await flush();
  assert.deepEqual(s.windows,[60000]);
  t.mock.timers.tick(20000);await flush();
  assert.deepEqual(s.windows,[60000,80000]);
  t.mock.timers.tick(20000);await flush();await Promise.all(s.waits);
  assert.deepEqual(s.windows,[60000,80000,100000]);
  assert.equal(s.instance.world.clock.worldMinute,0,'scheduler requests must not invent simulation time');
  assert.equal(s.alarm(),75000,'later heartbeats must preserve the real existing alarm');
});

test('an object reset in one scheduled pulse does not suppress later CPU-window renewals',async t=>{
  const s=setup(t,{failFirst:true});assert.equal(typeof worker.scheduled,'function');
  worker.scheduled({scheduledTime:60000,cron:'* * * * *'},s.env,s.ctx);
  await flush();t.mock.timers.tick(20000);await flush();t.mock.timers.tick(20000);await flush();
  await Promise.all(s.waits);
  assert.deepEqual(s.windows,[80000,100000]);
  assert.equal(s.instance.world.clock.worldMinute,0);
});

test('one slow scheduled request cannot delay the next incoming CPU renewal',async t=>{
  const s=setup(t);assert.equal(typeof worker.scheduled,'function');
  let release;const slow=new Promise(resolve=>{release=resolve;});let calls=0;
  const original=s.env.WORLD.get;
  s.env.WORLD.get=id=>{const stub=original(id);return {fetch:async request=>{calls++;if(calls===1)await slow;return stub.fetch(request);}};};
  worker.scheduled({scheduledTime:60000,cron:'* * * * *'},s.env,s.ctx);
  await flush();t.mock.timers.tick(20000);await flush();
  assert.deepEqual(s.windows,[80000],'second pulse must enter while the first response is pending');
  release();await flush();t.mock.timers.tick(20000);await flush();await Promise.all(s.waits);
  assert.deepEqual(s.windows,[80000,80000,100000]);
});

test('public requests cannot impersonate the scheduler-only heartbeat',async()=>{
  const response=await worker.fetch(new Request('https://worker.example/runtime-heartbeat'),{
    WORLD:{idFromName(){throw new Error('public request reached the private scheduler route');}}
  });
  assert.equal(response.status,404);
});

test('real scheduled requests expose activation without extra storage writes',async t=>{
  const s=setup(t);
  worker.scheduled({scheduledTime:60000,cron:'* * * * *'},s.env,s.ctx);
  await flush();
  const h=await (await s.instance.fetch(new Request('https://internal/world/health'))).json();
  assert.equal(h.scheduler?.last_received_real_ms,60000,'deploy verification must know the actual scheduler arrived');
  t.mock.timers.tick(40000);await flush();await Promise.all(s.waits);
});

test('an aborted scheduled request leaves the later independent slots running',async t=>{
  const s=setup(t);let first=true;const get=s.env.WORLD.get;
  s.env.WORLD.get=id=>{const stub=get(id);return {fetch:request=>{
    if(first){first=false;return Promise.reject(new DOMException('deadline elapsed','AbortError'));}
    return stub.fetch(request);
  }};};
  worker.scheduled({scheduledTime:60000,cron:'* * * * *'},s.env,s.ctx);
  await flush();t.mock.timers.tick(20000);await flush();t.mock.timers.tick(20000);await flush();
  await Promise.all(s.waits);
  assert.deepEqual(s.windows,[80000,100000]);
});

test('three failed responses are cancelled and fail the scheduled invocation',async t=>{
  const s=setup(t);let cancelled=0;
  s.env.WORLD.get=()=>({fetch:async()=>new Response(new ReadableStream({cancel(){cancelled++;}}),{status:503})});
  worker.scheduled({scheduledTime:60000,cron:'* * * * *'},s.env,s.ctx);
  const rejected=assert.rejects(Promise.all(s.waits),/scheduled_world_heartbeat_unavailable/);
  await flush();t.mock.timers.tick(20000);await flush();t.mock.timers.tick(20000);await flush();
  await rejected;assert.equal(cancelled,3);
});
