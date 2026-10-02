import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteStorage,wake,readWorld} from './helpers/sovereign-sqlite.mjs';
import {worldDate} from '../world/clock.js';
import {decodeSnapshot} from '../worker/src/persistence.js';
import {publicWorld} from '../world/index.js';

const YEAR=525600;

test('committed readers retain public evidence without duplicating private Citizen memory',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance,messages}=await wake(storage);
  const citizen=instance.world.citizens[0];
  citizen.knowledge=[{concept:'public-evidence',confidence:.9,active:true,provenance:[{kind:'observation',eventId:'proof'}]}];
  citizen.memories=[{id:'private-memory',content:{evidence:'retain me'},confidence:.9}];
  citizen.language.heard={privateSignal:[{source:'private-evidence'}]};
  await instance.persist({forceSeal:true});
  assert.deepEqual((await (await instance.fetch(new Request('https://example.com/world/state'))).json()).world,publicWorld(instance.world));
  assert.equal(instance.committedWorld,null);
  assert.equal(instance.committedSnapshot,null);
  assert.equal(instance.committedStats.worldId,instance.world.worldId);
  assert.equal(instance.committedStats.citizens,undefined);
  const {instance:restarted}=await wake(storage);
  assert.deepEqual(restarted.world.citizens[0].memories,citizen.memories);
  assert.deepEqual(restarted.world.citizens[0].language.heard,citizen.language.heard);
  assert.deepEqual((await (await restarted.fetch(new Request('https://example.com/world/state'))).json()).world,publicWorld(restarted.world));
  instance.broadcastWorldSignal('world_signal');
  assert.deepEqual(messages.at(-1),{
    type:'world_signal',
    version:2,
    worldId:instance.world.worldId,
    worldMinute:instance.readableWorld().clock.worldMinute,
    ledgerHead:instance.readableWorld().ledgerHead,
    persistedGeneration:instance.lastPersistedGeneration
  });
});

test('failed writes recover private memory from the compressed committed snapshot',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);
  instance.world.citizens[0].memories=[{id:'private-memory',content:{evidence:'committed'}}];
  await instance.persist({forceSeal:true});
  storage.transactionSync=()=>{throw new Error('injected failure');};
  await assert.rejects(instance.mutateWorld(async()=>{
    instance.world.citizens[0].memories[0].content.evidence='uncommitted';
    await instance.persist({forceSeal:true});
  }),/injected failure/);
  assert.equal(instance.world.citizens[0].memories[0].content.evidence,'committed');
});

test('a retry after decoder failure preserves neurons already consumed by inference',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);
  instance.world.citizens[0].memories=[{id:'private-memory'}];
  await instance.persist({forceSeal:true});
  const NativeDecompression=globalThis.DecompressionStream;
  let fail=true;
  t.mock.method(globalThis,'DecompressionStream',function(...args){
    if(fail){fail=false;throw new Error('injected decoder outage');}
    return new NativeDecompression(...args);
  });
  await assert.rejects(instance.mutateWorld(async()=>{
    instance.world.runtime.neuronBudget.usedNeurons=77;
    throw new Error('injected failed write');
  }),/injected failed write/);
  await instance.mutateWorld(async()=>{
    assert.equal(instance.world.runtime.neuronBudget.usedNeurons,77);
    assert.equal(instance.world.citizens[0].memories[0].id,'private-memory');
  });
});

test('wake loads only the newest valid snapshot instead of retaining both full worlds',async t=>{
  const storage=sqliteStorage();
  t.after(()=>storage.db.close());
  const {instance}=await wake(storage);
  instance.world.clock.worldMinute=60;
  await instance.persist({forceSeal:true});
  const manifest=storage.sql.exec('SELECT * FROM world_state_manifest')[0];
  const reads=[];
  const exec=storage.sql.exec;
  storage.sql.exec=(query,...args)=>{
    if(query.includes('SELECT state_part FROM world_state_chunks_v2'))reads.push(args[0]);
    return exec(query,...args);
  };
  const {instance:restarted}=await wake(storage);
  assert.equal(restarted.world.clock.worldMinute,60);
  assert.deepEqual(reads,[manifest.generation==='slot-b'?1_000_000:0]);
});

test('lazy recovery still selects a newer legacy snapshot and preserves its world identity',async t=>{
  const storage=sqliteStorage();
  t.after(()=>storage.db.close());
  const {instance}=await wake(storage);
  instance.world.clock.worldMinute=90;
  storage.sql.exec('INSERT INTO world_state VALUES(1,?,?,?,?)',JSON.stringify(instance.world),90,instance.world.ledgerHead,Date.now());
  const {instance:restarted}=await wake(storage);
  assert.equal(restarted.world.clock.worldMinute,90);
  assert.equal(restarted.world.worldId,instance.world.worldId);
});

test('lazy recovery falls back to an intact snapshot at the same durable minute',async t=>{
  const storage=sqliteStorage();
  t.after(()=>storage.db.close());
  const {instance}=await wake(storage);
  instance.world.clock.worldMinute=60;
  await instance.persist({forceSeal:true});
  await instance.persist({forceSeal:true});
  const meta=storage.sql.exec('SELECT * FROM world_state_manifest')[0];
  const base=meta.generation==='slot-b'?1_000_000:0;
  storage.sql.exec("UPDATE world_state_chunks_v2 SET state_part='corrupt' WHERE id>=? AND id<?",base,base+meta.chunk_count);
  t.mock.method(console,'error',()=>{});
  const {instance:restarted}=await wake(storage);
  assert.equal(restarted.world.clock.worldMinute,60);
  assert.equal(restarted.snapshotRecoverySource,`slot:${meta.generation==='slot-a'?'slot-b':'slot-a'}`);
});

async function nearYearBoundary(t){
  let now=Date.parse('2026-09-30T12:00:00Z');
  t.mock.method(Date,'now',()=>now);
  const storage=sqliteStorage();
  t.after(()=>storage.db.close());
  const {instance,messages}=await wake(storage);
  instance.world.clock.worldMinute=YEAR-30;
  instance.world.clock.realEpochMs=now-(YEAR-30)*1000;
  await instance.persist({forceSeal:true});
  return {storage,instance,messages,advance:ms=>{now+=ms;}};
}

test('budget deferral cannot publish a new year that disappears after eviction',async t=>{
  const {storage,instance,messages,advance}=await nearYearBoundary(t);
  t.mock.method(console,'error',()=>{});
  storage.sql.exec('UPDATE persistence_budget SET rows_written=60000');
  advance(60_000);
  await instance.alarm();
  const beforeRestart=await readWorld(instance);
  const {instance:restarted}=await wake(storage);
  const afterRestart=await readWorld(restarted);
  assert.equal(afterRestart.clock.worldMinute,beforeRestart.clock.worldMinute);
  assert.equal(worldDate(beforeRestart.clock.worldMinute).year,1);
  assert.ok(messages.every(m=>m.state.clock.worldMinute<=afterRestart.clock.worldMinute));
  advance(24*60*60_000);
  await restarted.alarm();
  assert.ok((await readWorld(restarted)).clock.worldMinute>afterRestart.clock.worldMinute);
});

test('several world days and repeated evictions retain the year and ledger',async t=>{
  const {storage,instance,advance}=await nearYearBoundary(t);
  // Isolate calendar/persistence endurance from the separately tested biology.
  instance.world.citizens=[];
  await instance.persist({forceSeal:true});
  let running=instance;
  for(let hour=0;hour<72;hour++){
    advance(60_000);
    await running.tick();
    const before=await readWorld(running);
    const {instance:restarted}=await wake(storage);
    const after=await readWorld(restarted);
    assert.equal(after.clock.worldMinute,before.clock.worldMinute);
    assert.equal(after.ledgerHead,before.ledgerHead);
    running=restarted;
  }
  assert.deepEqual(worldDate((await readWorld(running)).clock.worldMinute),{
    year:2,day:3,hour:23,minute:30,label:'Y2 D3 23:30',
  });
});

test('a failed SQLite checkpoint never leaks advanced time through REST or broadcast',async t=>{
  const {storage,instance,messages,advance}=await nearYearBoundary(t);
  t.mock.method(console,'error',()=>{});
  const transaction=storage.transactionSync;
  storage.transactionSync=()=>{throw new Error('injected storage failure');};
  advance(15_000);
  instance.lastPersistedWorldMinute=YEAR-90;
  await instance.alarm();
  assert.equal((await readWorld(instance)).clock.worldMinute,YEAR-30);
  assert.equal(instance.world.clock.worldMinute,YEAR-30);
  assert.equal(messages.length,0);
  storage.transactionSync=transaction;
  advance(15_000);
  instance.lastPersistedWorldMinute=YEAR-90;
  await instance.alarm();
  assert.equal((await readWorld(instance)).clock.worldMinute,YEAR);
  const {instance:restarted}=await wake(storage);
  assert.equal((await readWorld(restarted)).clock.worldMinute,YEAR);
});

test('reads during asynchronous snapshot encoding only expose the committed calendar',async t=>{
  const {instance,advance}=await nearYearBoundary(t);
  advance(60_000);
  const ticking=instance.tick();
  const during=await readWorld(instance);
  await ticking;
  assert.equal(during.clock.worldMinute,YEAR-30);
  assert.equal((await readWorld(instance)).clock.worldMinute,YEAR+30);
});

test('snapshot metadata is captured from the same state as its encoded payload',async t=>{
  const {storage,instance}=await nearYearBoundary(t);
  instance.world.clock.worldMinute=YEAR+30;
  const saving=instance.persist();
  // persistSnapshot captures its clock before the streaming gzip await.
  await Promise.resolve();
  instance.world.clock.worldMinute=YEAR+90;
  await saving;
  const meta=storage.sql.exec('SELECT * FROM world_state_manifest')[0];
  const base=meta.generation==='slot-b'?1_000_000:0;
  const parts=storage.sql.exec('SELECT state_part FROM world_state_chunks_v2 WHERE id>=? AND id<? ORDER BY id',base,base+meta.chunk_count);
  const saved=JSON.parse(await decodeSnapshot(parts.map(r=>r.state_part).join('')));
  assert.equal(meta.world_minute,saved.clock.worldMinute);
  assert.equal(instance.lastPersistedWorldMinute,saved.clock.worldMinute);
  assert.equal(instance.readableWorld().clock.worldMinute,saved.clock.worldMinute);
});

test('legacy recovery cannot restart Genesis when existing snapshots are corrupt',async t=>{
  const {storage}=await nearYearBoundary(t);
  t.mock.method(console,'error',()=>{});
  storage.sql.exec('DELETE FROM world_clock_guard');
  storage.sql.exec("UPDATE world_state_chunks_v2 SET state_part='corrupt'");
  await assert.rejects(wake(storage),/snapshot_unavailable|clock_regression/);
});

test('legacy recovery cannot select an older year when newer durable evidence exists',async t=>{
  const {storage,instance}=await nearYearBoundary(t);
  t.mock.method(console,'error',()=>{});
  instance.world.clock.worldMinute=YEAR+30;
  await instance.persist({forceSeal:true});
  storage.sql.exec('DELETE FROM world_clock_guard');
  const meta=storage.sql.exec('SELECT * FROM world_state_manifest')[0];
  const base=meta.generation==='slot-b'?1_000_000:0;
  storage.sql.exec("UPDATE world_state_chunks_v2 SET state_part='corrupt' WHERE id>=? AND id<?",base,base+meta.chunk_count);
  await assert.rejects(wake(storage),/snapshot_unavailable|clock_regression/);
});

test('acknowledged avatars and the year survive concurrent tick persistence and restart',async t=>{
  const {storage,instance,advance}=await nearYearBoundary(t);
  advance(60_000);
  const ticking=instance.tick();
  const response=await instance.fetch(new Request('https://example.com/world/avatar',{
    method:'POST',body:JSON.stringify({actor:{id:'calendar-test',github_id:'1234'}}),
  }));
  assert.equal(response.status,200);
  const avatar=await response.json();
  await ticking;
  const {instance:restarted}=await wake(storage);
  const world=await readWorld(restarted);
  assert.equal(worldDate(world.clock.worldMinute).year,2);
  assert.ok(world.citizens.some(c=>c.id===avatar.citizenId));
});

test('write budget exhaustion never acknowledges an avatar that was not saved',async t=>{
  const {storage,instance}=await nearYearBoundary(t);
  storage.sql.exec('UPDATE persistence_budget SET rows_written=60000');
  const response=await instance.fetch(new Request('https://example.com/world/avatar',{
    method:'POST',body:JSON.stringify({actor:{id:'calendar-test',github_id:'1234'}}),
  }));
  assert.equal(response.status,503);
  assert.equal((await readWorld(instance)).citizens.length,100);
  assert.equal(instance.world.citizens.length,100);
});
