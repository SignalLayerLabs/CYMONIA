import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';

async function fixture(t){
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);
  instance.refreshPublicSnapshot=async()=>{};instance.collectKnowledgeBins=()=>{};
  // Binary rows fit more compressed data than base64 rows. Keep this fixture
  // across two complete batches so the sixth-part interruption remains real.
  instance.world.runtime.batchProbe=randomBytes(12*1024*1024).toString('base64');
  return {storage,instance};
}

test('a mature hot checkpoint fits the saved-state freshness window without raising the daily budget',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
  instance.lastSnapshotChunkCount=20;
  const cadence=instance.checkpointIntervalWorldMinutes();
  assert.ok(cadence<=100,`twenty-part checkpoints need room for physical work and encoding inside 120s: ${cadence}`);
  assert.equal(instance.readPersistenceBudget().limit,40000);
});

test('multi-part checkpoint staging shares bounded atomic charges and restores the exact saved data',async t=>{
  const {storage,instance}=await fixture(t),before=instance.readPersistenceBudget().rowsWritten;
  const exec=storage.sql.exec,transaction=storage.transactionSync;const batches=[];let active;
  storage.transactionSync=callback=>{
    active={parts:0,charges:0};
    try{const result=transaction(callback);if(active.parts)batches.push(active);return result;}
    finally{active=null;}
  };
  storage.sql.exec=(query,...args)=>{
    if(active&&query.includes('INSERT INTO world_state_chunks_v2'))active.parts++;
    if(active&&query.includes('UPDATE persistence_budget SET'))active.charges++;
    return exec(query,...args);
  };
  const result=await instance.persist({forceSeal:true});
  assert.ok(result.chunkCount>=5,'the fixture must cross the bounded transaction size');
  assert.ok(batches.length<result.chunkCount,'one budget write per part needlessly delays mature checkpoints');
  assert.ok(batches.every(batch=>batch.parts<=4&&batch.charges===1));
  assert.equal(instance.readPersistenceBudget().rowsWritten-before,result.rowWrites);
  storage.sql.exec=exec;storage.transactionSync=transaction;
  const {instance:restored}=await wake(storage);
  assert.equal(restored.world.runtime.batchProbe,instance.world.runtime.batchProbe);
  assert.equal(restored.world.clock.worldMinute,instance.lastPersistedWorldMinute);
});

test('a failed staging batch rolls back its parts and charge while prior durable batches stay charged',async t=>{
  const {storage,instance}=await fixture(t),before=instance.readPersistenceBudget().rowsWritten;
  const generation=instance.lastPersistedGeneration,exec=storage.sql.exec;let parts=0;
  storage.sql.exec=(query,...args)=>{
    if(query.includes('INSERT INTO world_state_chunks_v2')&&++parts===6)throw new Error('batch-staging-interrupted');
    return exec(query,...args);
  };
  await assert.rejects(instance.persist({forceSeal:true}),/batch-staging-interrupted/);
  storage.sql.exec=exec;
  assert.equal(instance.readPersistenceBudget().rowsWritten-before,5,'four committed parts cost five rows; the interrupted batch is atomic');
  assert.equal(storage.sql.exec('SELECT generation FROM world_state_manifest WHERE id=1')[0].generation,generation);
  const {instance:restored}=await wake(storage);
  assert.equal(restored.world.runtime.batchProbe,undefined);
});
