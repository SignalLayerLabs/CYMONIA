import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {encodeWorldSnapshotParts,decodeWorldSnapshot,compressedSnapshotByteStream} from '../worker/src/persistence.js';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';

test('binary gzip parts preserve exact private bytes and seals while avoiding base64 row overhead',async()=>{
  const world={version:2,worldId:'binary-world',clock:{worldMinute:8},citizens:[{id:'private',note:randomBytes(8000).toString('base64')+'🌍\uD800'}],ledger:[]};
  const old=await encodeWorldSnapshotParts(world,{maxCodeUnits:1024});
  const next=await encodeWorldSnapshotParts(world,{maxCodeUnits:1024,binaryParts:true,sealDue:true});
  assert.ok(next.parts.every(p=>p instanceof Uint8Array&&p.byteLength<=1024));
  assert.ok(next.parts.reduce((n,p)=>n+p.byteLength,0)<old.parts.join('').length*.76);
  assert.deepEqual(await decodeWorldSnapshot(next.parts),world);
  assert.equal(next.stateSha256,createHash('sha256').update(JSON.stringify(world)).digest('hex'));
  function* fragmented(){for(const p of next.parts)for(let i=0;i<p.length;i+=7)yield p.slice(i,i+7).buffer;}
  assert.deepEqual(await decodeWorldSnapshot(fragmented()),world);
});

test('binary stream cancellation releases a lazy SQLite iterator and mixed/truncated parts remain fatal',async()=>{
  const world={clock:{worldMinute:1},citizens:[{id:'private',data:randomBytes(12000).toString('base64')}],ledger:[]};
  const encoded=await encodeWorldSnapshotParts(world,{maxCodeUnits:1024,binaryParts:true});let returned=false;
  function* parts(){try{yield* encoded.parts;}finally{returned=true;}}
  const {stream}=compressedSnapshotByteStream(parts()),reader=stream.getReader();await reader.read();await reader.cancel();
  assert.equal(returned,true);
  await assert.rejects(decodeWorldSnapshot([encoded.parts[0],'invalid']),/snapshot|gzip|compressed|chunk/i);
  await assert.rejects(decodeWorldSnapshot(encoded.parts.slice(0,-1)));
});

test('canonical SQLite staging uses bounded binary rows and restores an exact private value',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
  instance.world.runtime.binaryProbe=randomBytes(5*1024*1024).toString('base64');
  // This assertion covers canonical staging. Bin-GC cursor writes have their
  // separate accounting tests and are not part of result.rowWrites.
  instance.collectKnowledgeBins=()=>{};
  const before=instance.readPersistenceBudget().rowsWritten,result=await instance.persist({forceSeal:true});
  const base=result.generation==='slot-b'?1000000:0;
  const rows=storage.sql.exec('SELECT state_part FROM world_state_chunks_v2 WHERE id>=? AND id<? ORDER BY id',base,base+result.chunkCount);
  assert.ok(rows.length>=3);assert.ok(rows.every(r=>r.state_part instanceof Uint8Array&&r.state_part.byteLength<=1900*1024&&r.state_part.byteLength<2000000));
  assert.equal(instance.readPersistenceBudget().rowsWritten-before,result.rowWrites);
  const {instance:r}=await wake(storage);assert.equal(r.world.runtime.binaryProbe,instance.world.runtime.binaryProbe);
});

test('canonical encoding releases disposable read caches after durable bin staging without discarding private evidence',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
  instance.world.citizens[0].knowledge=Array.from({length:3000},(_,i)=>({concept:`cache-proof:${i}`,active:true,confidence:.8,provenance:[{kind:'observation',eventId:`original:${i}`}]}));
  await instance.persist({forceSeal:true});
  const first=instance.world.citizens[0].knowledge[0];assert.equal(first.provenance[0].eventId,'original:0');
  assert.ok(instance.knowledgeArchive.binCacheBytes>0);
  await instance.persist({forceSeal:true});
  assert.equal(instance.knowledgeArchive.binCacheBytes,0);
  assert.equal(instance.knowledgeArchive.cachedCodeUnits,0);
  assert.equal(instance.knowledgeArchive.serializedCodeUnits,0);
  assert.equal(instance.world.citizens[0].knowledge[2999].provenance[0].eventId,'original:2999');
  const {instance:r}=await wake(storage);assert.equal(r.world.citizens[0].knowledge[0].provenance[0].eventId,'original:0');
  assert.equal(r.world.citizens[0].knowledge[2999].provenance[0].eventId,'original:2999');
});
