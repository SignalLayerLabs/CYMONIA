import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';

test('cold recovery serves the durable public view after physics advances before the first Observer read',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);instance.world.clock.worldMinute=60;
  await instance.persist({forceSeal:true});
  const expected=await (await instance.fetch(new Request('https://internal/world/state'))).json();
  const {instance:r}=await wake(storage);
  r.refreshPublicSnapshot=async()=>{throw new Error('cold public view must not be rebuilt from live physics');};
  r.world.clock.realEpochMs=Date.now()-90_000;
  await r.tick(30,360,{maxSegments:30,deferCheckpoint:true});
  assert.equal(r.world.clock.worldMinute,90);
  for(const encoding of ['gzip','gzip;q=0']){
    const response=await r.fetch(new Request('https://internal/world/state',{headers:{'accept-encoding':encoding}}));
    assert.equal(response.status,200,'saved public state must survive eviction and in-flight physics');
    const body=encoding==='gzip'?new Response(response.body.pipeThrough(new DecompressionStream('gzip'))):response;
    assert.deepEqual(await body.json(),expected);
  }
});

test('interrupted canonical publication cannot expose the staged public future',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
  const old=await (await instance.fetch(new Request('https://internal/world/state'))).json();
  const exec=storage.sql.exec;instance.world.clock.worldMinute=30;
  storage.sql.exec=(query,...args)=>{if(query.includes('INSERT INTO world_state_manifest'))throw new Error('interrupted-publication');return exec(query,...args);};
  await assert.rejects(instance.persist({forceSeal:true}),/interrupted-publication/);storage.sql.exec=exec;
  const {instance:r}=await wake(storage);r.world.clock.worldMinute=10;
  const response=await r.fetch(new Request('https://internal/world/state'));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),old);
});

test('projection failure preserves the last public view while the private world still commits',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
  const old=await (await instance.fetch(new Request('https://internal/world/state'))).json();
  instance.world.clock.worldMinute=60;instance.refreshPublicSnapshot=async()=>{throw new Error('projection-unavailable');};
  await instance.persist({forceSeal:true});
  const {instance:r}=await wake(storage);
  assert.equal(r.world.clock.worldMinute,60);r.world.clock.worldMinute=61;
  const response=await r.fetch(new Request('https://internal/world/state'));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),old);
});
