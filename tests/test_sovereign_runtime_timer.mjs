import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';

const flush=async()=>{for(let i=0;i<40;i++)await new Promise(resolve=>setImmediate(resolve));};
async function runtime(t){
  let now=100000;t.mock.method(Date,'now',()=>now);
  t.mock.method(console,'log',()=>{});t.mock.method(console,'error',()=>{});
  const storage=sqliteStorage(),{instance}=await wake(storage);
  t.mock.timers.enable({apis:['setTimeout']});
  const advance=ms=>{now+=ms;t.mock.timers.tick(ms);};
  const work=[];instance.ctx.waitUntil=p=>work.push(p);instance.ctx.getWebSockets=()=>[];
  instance.yieldRuntime=async()=>{};
  t.after(async()=>{clearTimeout(instance.runtimeTimer);await Promise.all(work);storage.db.close();});
  const heartbeat=async token=>(await instance.fetch(new Request('https://internal/world/runtime-heartbeat',{
    headers:token?{'x-cymonia-cpu-renewal':token}:{}
  }))).json();
  return {storage,instance,work,heartbeat,advance};
}

test('an unattended timer saves genuine chronological physics when no alarms are delivered',async t=>{
  const {instance,storage,heartbeat,advance,work}=await runtime(t),before=instance.world.clock.worldMinute;
  const bodies=JSON.stringify(instance.world.citizens.map(c=>c.body)),ids=instance.world.citizens.map(c=>c.id);
  const first=await heartbeat();
  advance(2500);await flush();
  assert.equal(instance.world.clock.worldMinute,before,'cold recovery must await a post-decode CPU renewal');
  await heartbeat(first.cpu_renewal_token);
  for(let i=0;i<64;i++){
    if(i%8===0)await heartbeat(first.cpu_renewal_token);
    advance(2500);await flush();await Promise.all(work);
  }
  assert.ok(instance.lastPersistedWorldMinute-before>=120,'timers must save physical progress without alarm delivery');
  assert.notEqual(JSON.stringify(instance.world.citizens.map(c=>c.body)),bodies);
  assert.ok(!instance.world.ledger.some(e=>e.type==='RUNTIME_LAG_REBASED'),'healthy unattended time cannot be discarded as an outage');
  clearTimeout(instance.runtimeTimer);t.mock.timers.reset();
  const {instance:restored}=await wake(storage);
  assert.equal(restored.world.clock.worldMinute,instance.lastPersistedWorldMinute);
  assert.deepEqual(restored.world.citizens.map(c=>c.id),ids);
});

test('a delayed alarm and timer share one in-flight physical phase without a writer queue',async t=>{
  const {instance,heartbeat,advance}=await runtime(t);
  const first=await heartbeat();await heartbeat(first.cpu_renewal_token);
  let release,calls=0;const blocked=new Promise(resolve=>{release=resolve;});
  instance.tick=async()=>{calls++;await blocked;};
  advance(2500);await flush();
  const alarm=instance.alarm();await flush();
  await heartbeat(first.cpu_renewal_token);advance(10000);await flush();
  assert.equal(calls,1,'concurrent drivers must not queue extra phases');
  release();await alarm;await flush();
  assert.equal(calls,1);
  advance(2500);await flush();assert.equal(calls,2);
});

test('ordinary Observer reads do not activate the autonomous timer or synthesize time',async t=>{
  const {instance,advance}=await runtime(t),minute=instance.world.clock.worldMinute;
  await instance.fetch(new Request('https://internal/world/health'));
  advance(20000);await flush();
  assert.equal(instance.runtimeTimer??null,null);
  assert.equal(instance.world.clock.worldMinute,minute);
});

test('a timer waits for incoming CPU renewal after a network gap and then resumes real physics',async t=>{
  const {instance,heartbeat,advance,work}=await runtime(t);
  const first=await heartbeat();await heartbeat(first.cpu_renewal_token);
  const minute=instance.world.clock.worldMinute;
  advance(30000);await flush();await Promise.all(work);
  assert.equal(instance.world.clock.worldMinute,minute,'a timer cannot renew its own CPU window');
  await heartbeat(first.cpu_renewal_token);
  advance(2500);await flush();await Promise.all(work);
  assert.ok(instance.world.clock.worldMinute>minute);
  assert.ok(!instance.world.ledger.some(e=>e.type==='RUNTIME_LAG_REBASED'));
});

test('cold recovery respects CPU renewal and backs off failed reloads without a live world',async t=>{
  const {instance,heartbeat,advance,work}=await runtime(t);
  const first=await heartbeat();await heartbeat(first.cpu_renewal_token);
  const savedWorld=instance.world;instance.world=null;
  let reloads=0;
  instance.restoreCommittedWorld=async()=>{reloads++;throw new Error('knowledge_bin_checksum_mismatch');};
  advance(30000);await flush();await Promise.all(work);
  assert.equal(reloads,0,'expired CPU windows must not start a large cold recovery');
  await heartbeat();advance(2500);await flush();await Promise.all(work);
  assert.equal(reloads,1);
  assert.match(instance.runtimeLoopError,/knowledge_bin_checksum_mismatch/);
  advance(2500);await flush();await Promise.all(work);
  assert.equal(reloads,1,'a failed reload must retain its backoff even with world=null');
  advance(10000);await heartbeat();advance(2500);await flush();await Promise.all(work);
  assert.equal(reloads,2,'the recovery retry becomes eligible after fifteen seconds');
  instance.restoreCommittedWorld=async()=>{reloads++;instance.world=savedWorld;};
  let ticks=0;instance.tick=async()=>{ticks++;};
  await heartbeat();advance(15000);await heartbeat();await flush();await Promise.all(work);
  assert.equal(reloads,3);
  assert.equal(instance.runtimeLoopError,null);
  advance(2500);await flush();await Promise.all(work);
  assert.equal(ticks,2,'successful recovery restores the normal timer cadence');
});

test('an expired recovery alarm leaves a successor and timer ready for the next incoming renewal',async t=>{
  const {instance,storage,heartbeat,advance,work}=await runtime(t);
  const first=await heartbeat();await heartbeat(first.cpu_renewal_token);
  clearTimeout(instance.runtimeTimer);instance.runtimeTimer=null;
  const savedWorld=instance.world;instance.world=null;
  let reloads=0;instance.restoreCommittedWorld=async()=>{reloads++;instance.world=savedWorld;};
  instance.tick=async()=>{};
  advance(30000);await instance.alarm();
  assert.equal(reloads,0);
  assert.ok(await storage.getAlarm()>Date.now(),'CPU protection must not consume the only recovery alarm');
  assert.ok(instance.runtimeTimer!=null,'recovery must remain wakeable after skipping the expired alarm');
  await heartbeat();advance(2500);await flush();await Promise.all(work);
  assert.equal(reloads,1);
  assert.equal(instance.world,savedWorld);
});
