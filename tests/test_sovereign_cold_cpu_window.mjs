import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';

test('a cold alarm waits for an incoming request before consuming another CPU phase',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());
 const {instance}=await wake(storage);instance.ctx.getWebSockets=()=>[];
 let ticks=0;instance.tick=async()=>{ticks++;};
 await instance.alarm();assert.equal(ticks,0,'cold decode must not share its CPU window with simulation or compression');
 assert.ok(await storage.getAlarm());
 await instance.fetch(new Request('https://internal/world/health'));await instance.alarm();assert.equal(ticks,0);
 const first=await (await instance.fetch(new Request('https://internal/world/runtime-heartbeat'))).json();
 await instance.alarm();assert.equal(ticks,0,'the request causing or queued during cold recovery cannot release the gate');
 await instance.fetch(new Request('https://internal/world/runtime-heartbeat',{headers:{'x-cymonia-cpu-renewal':first.cpu_renewal_token}}));
 await instance.alarm();assert.equal(ticks,1,'a genuine incoming heartbeat releases the waiting phase');
});

test('a renewal token from an evicted object cannot release its recovered replacement',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 const old=await (await instance.fetch(new Request('https://internal/world/runtime-heartbeat'))).json();
 const {instance:restored}=await wake(storage);
 const response=await (await restored.fetch(new Request('https://internal/world/runtime-heartbeat',{headers:{'x-cymonia-cpu-renewal':old.cpu_renewal_token}}))).json();
 assert.equal(restored.awaitingColdCpuRenewal,true);assert.notEqual(response.cpu_renewal_token,old.cpu_renewal_token);
 await restored.fetch(new Request('https://internal/world/runtime-heartbeat',{headers:{'x-cymonia-cpu-renewal':response.cpu_renewal_token}}));
 assert.equal(restored.awaitingColdCpuRenewal,false);
});

test('incoming scheduler requests can renew CPU while canonical recovery is still pending',async t=>{
 const {SovereignWorld}=await import('../worker/src/index.js'),storage=sqliteStorage();t.after(()=>storage.db.close());
 let release;const delayed=new Promise(r=>{release=r;});let schemaReady;
 class SlowRecovery extends SovereignWorld{async loadWorld(){await delayed;return super.loadWorld();}}
 const instance=new SlowRecovery({storage,blockConcurrencyWhile:fn=>(schemaReady=fn()),getWebSockets:()=>[],waitUntil:()=>{}},{});
 await schemaReady;
 const heartbeat=await (await instance.fetch(new Request('https://internal/world/runtime-heartbeat'))).json();
 assert.equal(heartbeat.initializing,true);assert.equal(heartbeat.world_minute,null);assert.equal(heartbeat.cpu_renewal_token,undefined);
 let published=false;const publicRead=instance.fetch(new Request('https://internal/world/health')).then(r=>{published=true;return r;});
 await Promise.resolve();assert.equal(published,false,'canonical readers must wait for verified complete recovery');
 release();await instance.ready;assert.equal((await (await publicRead).json()).ok,true);
});
