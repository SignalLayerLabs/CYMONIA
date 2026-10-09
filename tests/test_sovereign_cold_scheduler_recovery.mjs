import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{SovereignWorld} from '../worker/src/index.js';
import {createSovereignGenesis} from '../world/index.js';
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
function fixture(t){
 t.mock.timers.enable({apis:['Date','setTimeout'],now:60000});t.mock.method(console,'log',()=>{});t.mock.method(console,'error',()=>{});
 const instance=Object.create(SovereignWorld.prototype);let alarm=75000;
 Object.assign(instance,{world:createSovereignGenesis({realEpochMs:0}),env:{},awaitingColdCpuRenewal:true,coldCpuRenewalToken:'recovered-nonce',
 ctx:{storage:{getAlarm:async()=>alarm,setAlarm:async value=>{alarm=value;},get:async()=>null,put:async()=>{}},getWebSockets:()=>[]},readPersistenceBudget:()=>({day:'1970-01-01',rowsWritten:0})});
 const requests=[],waits=[];const env={WORLD:{idFromName:name=>name,get:()=>({fetch:async request=>{requests.push(request);return instance.fetch(request);}})}};
 return {instance,requests,waits,env,ctx:{waitUntil:p=>waits.push(p)}};
}
test('a recovered world gets a genuine post-decode CPU renewal before the next twenty-second slot',async t=>{
 const s=fixture(t);worker.scheduled({scheduledTime:60000},s.env,s.ctx);await flush();
 assert.equal(s.instance.awaitingColdCpuRenewal,false,'cold recovery must not wait another20s after decode');
 assert.equal(s.requests.length,2);assert.equal(s.requests[1].headers.get('x-cymonia-cpu-renewal'),'recovered-nonce');
 assert.equal(s.instance.world.clock.worldMinute,0,'renewal must not synthesize physics');
 t.mock.timers.tick(40000);await flush();await Promise.all(s.waits);assert.equal(s.requests.length,4,'warm slots retain one incoming request each');
});
test('an initializing world can await decode then renew without releasing a queued cold request',async t=>{
 const s=fixture(t);let release;const decoding=new Promise(r=>{release=r;});s.instance.ready=decoding;s.instance.initializing=true;
 worker.scheduled({scheduledTime:60000},s.env,s.ctx);await flush();
 assert.equal(s.requests.length,2,'initializing response must start an independent request awaiting readiness');
 assert.equal(s.instance.awaitingColdCpuRenewal,true);
 s.instance.initializing=false;release();await flush();
 assert.equal(s.instance.awaitingColdCpuRenewal,false);assert.equal(s.requests.length,3);
 assert.equal(s.requests[1].headers.get('x-cymonia-cpu-renewal'),null,'queued decode request must not carry the new challenge');
 assert.equal(s.requests[2].headers.get('x-cymonia-cpu-renewal'),'recovered-nonce');
 t.mock.timers.tick(40000);await flush();await Promise.all(s.waits);
});
test('a second reset between challenge and echo is renewed with bounded genuine requests',async t=>{
 const s=fixture(t),get=s.env.WORLD.get;let reset=false;
 s.env.WORLD.get=()=>{const stub=get();return {fetch:async request=>{if(request.headers.get('x-cymonia-cpu-renewal')==='recovered-nonce'&&!reset){reset=true;s.instance.coldCpuRenewalToken='second-nonce';}return stub.fetch(request);}};};
 worker.scheduled({scheduledTime:60000},s.env,s.ctx);await flush();
 assert.equal(s.instance.awaitingColdCpuRenewal,false);assert.equal(s.requests.length,3);assert.equal(s.requests[2].headers.get('x-cymonia-cpu-renewal'),'second-nonce');
 t.mock.timers.tick(40000);await flush();await Promise.all(s.waits);
});

test('decode spanning a Cron boundary still requires a post-ready request and resumes immediately',async t=>{
 const s=fixture(t);s.instance.awaitingColdCpuRenewal=false;
 worker.scheduled({scheduledTime:60000},s.env,s.ctx);await flush();t.mock.timers.tick(20000);await flush();
 let release;const decoding=new Promise(r=>{release=r;});s.instance.ready=decoding;s.instance.initializing=true;s.instance.awaitingColdCpuRenewal=true;s.instance.coldCpuRenewalToken='boundary-nonce';
 t.mock.timers.tick(20000);await flush();t.mock.timers.tick(20000);worker.scheduled({scheduledTime:120000},s.env,s.ctx);await flush();
 assert.equal(s.instance.awaitingColdCpuRenewal,true,'queued initialization requests cannot count as post-decode renewal');
 s.instance.initializing=false;release();await flush();assert.equal(s.instance.awaitingColdCpuRenewal,false);
 const echoes=s.requests.filter(r=>r.headers.get('x-cymonia-cpu-renewal')==='boundary-nonce');assert.ok(echoes.length>0);
 assert.equal(s.instance.world.clock.worldMinute,0);t.mock.timers.tick(40000);await flush();await Promise.all(s.waits);
});
test('a hung ready-wait request expires without delaying later independent scheduler slots',async t=>{
 const s=fixture(t),get=s.env.WORLD.get;let aborted=0;s.instance.initializing=true;
 t.mock.method(AbortSignal,'timeout',ms=>{const c=new AbortController();setTimeout(()=>c.abort(new DOMException('deadline','TimeoutError')),ms);return c.signal;});
 s.env.WORLD.get=()=>{const stub=get();return {fetch:async request=>{
  if(request.headers.get('x-cymonia-await-ready')==='1'){s.requests.push(request);return new Promise((resolve,reject)=>request.signal.addEventListener('abort',()=>{aborted++;reject(request.signal.reason);},{once:true}));}
  return stub.fetch(request);
 }};};
 worker.scheduled({scheduledTime:60000},s.env,s.ctx);await flush();assert.equal(s.instance.awaitingColdCpuRenewal,true);
 s.instance.initializing=false;t.mock.timers.tick(20000);await flush();assert.equal(s.instance.awaitingColdCpuRenewal,false);
 t.mock.timers.tick(20000);await flush();t.mock.timers.tick(5000);await flush();await Promise.all(s.waits);
 assert.equal(aborted,1);assert.equal(s.requests.length,5);assert.equal(s.instance.world.clock.worldMinute,0);
});
test('repeated replacement cannot create an unbounded challenge retry loop',async t=>{
 const s=fixture(t),get=s.env.WORLD.get;let resets=0;
 s.env.WORLD.get=()=>{const stub=get();return {fetch:request=>{if(request.headers.get('x-cymonia-cpu-renewal'))s.instance.coldCpuRenewalToken=`replacement:${++resets}`;return stub.fetch(request);}};};
 worker.scheduled({scheduledTime:60000},s.env,s.ctx);const rejected=assert.rejects(Promise.all(s.waits),/scheduled_world_heartbeat_unavailable/);await flush();
 assert.equal(s.requests.length,3);assert.equal(s.instance.awaitingColdCpuRenewal,true);
 t.mock.timers.tick(20000);await flush();t.mock.timers.tick(20000);await flush();await rejected;
 assert.ok(s.requests.length<=9);assert.equal(s.instance.world.clock.worldMinute,0);
});

test('overlapping ready-wait heartbeats and the timer share one rollback load and one stable challenge',async t=>{
 const s=fixture(t);s.instance.world=null;s.instance.ready=Promise.resolve();let release,loads=0;
 const waiting=new Promise(r=>{release=r;});
 s.instance.loadCommittedWorldFromStorage=async()=>{loads++;s.instance.coldCpuRenewalToken=`load:${loads}`;s.instance.awaitingColdCpuRenewal=true;await waiting;return createSovereignGenesis({realEpochMs:0});};
 const request=()=>new Request('https://internal/world/runtime-heartbeat',{headers:{'x-cymonia-await-ready':'1'}});
 const first=s.instance.fetch(request()),second=s.instance.fetch(request()),pulse=s.instance.advanceRuntimePulse();await flush();
 assert.equal(loads,1,'parallel readiness requests must not dispose each other\'s archive or duplicate a canonical graph');
 release();const [a,b]=await Promise.all([first,second,pulse]);assert.equal((await a.json()).cpu_renewal_token,'load:1');assert.equal((await b.json()).cpu_renewal_token,'load:1');
 assert.equal(s.instance.awaitingColdCpuRenewal,true);assert.equal(s.instance.world.clock.worldMinute,0);
 await s.instance.fetch(new Request('https://internal/world/runtime-heartbeat',{headers:{'x-cymonia-cpu-renewal':'load:1'}}));assert.equal(s.instance.awaitingColdCpuRenewal,false);
});
test('a failed shared rollback load leaves the next incoming request able to retry',async t=>{
 const s=fixture(t);s.instance.world=null;let loads=0;
 s.instance.loadCommittedWorldFromStorage=async()=>{if(++loads===1)throw new Error('temporary-read-failure');return createSovereignGenesis({realEpochMs:0});};
 const failed=await Promise.allSettled([s.instance.restoreCommittedWorld(),s.instance.restoreCommittedWorld()]);
 assert.equal(loads,1);assert.ok(failed.every(r=>r.status==='rejected'));
 await s.instance.restoreCommittedWorld();assert.equal(loads,2);assert.equal(s.instance.world.clock.worldMinute,0);
});
