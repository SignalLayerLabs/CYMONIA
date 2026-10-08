import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';
import {encodeWorldSnapshotParts,decodeWorldSnapshot} from '../worker/src/persistence.js';
import {archiveDigest} from '../worker/src/archive-digest.js';

const entries=n=>Array.from({length:n},(_,i)=>({concept:`packed:${i}`,confidence:.7,active:true,
 provenance:[{kind:'observation',eventId:`private:${i}`,evidence:{entityId:`object:${i}`,text:createHash('sha256').update(String(i)).digest('hex')}}]}));

test('bounded archive SHA-256 matches standard vectors and padding boundaries',()=>{
 for(const n of [0,1,55,56,63,64,65,1000,1048576]){
  const bytes=Uint8Array.from({length:n},(_,i)=>(i*197+13)%256);
  assert.equal(archiveDigest(bytes),createHash('sha256').update(bytes).digest('hex'));
 }
});

test('UTC rollover charges every staged bin and part to the new day',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 storage.sql.exec("UPDATE persistence_budget SET day='2026-01-01',rows_written=40000 WHERE id=1");
 instance.world.citizens[0].knowledge=entries(1000);instance.collectKnowledgeBins=()=>{};
 const result=await instance.persist({forceSeal:true});
 assert.equal(instance.readPersistenceBudget().rowsWritten,result.rowWrites);
 assert.equal(storage.sql.exec('SELECT day FROM persistence_budget WHERE id=1')[0].day,new Date(Date.now()).toISOString().slice(0,10));
});

test('legacy absent concepts remain distinct from explicit null across packed restart and exports',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 instance.world.citizens[0].knowledge=[{id:'legacy-only-id',active:true,confidence:.7,provenance:[{kind:'observation',eventId:'old-proof'}]},
  {concept:null,active:true,confidence:.8,provenance:[]}];
 const expected=JSON.stringify(instance.world.citizens[0].knowledge);
 await instance.persist({forceSeal:true});const {instance:restored}=await wake(storage);
 assert.equal(JSON.stringify(restored.world.citizens[0].knowledge),expected);
 const encoded=await encodeWorldSnapshotParts({clock:{worldMinute:0},citizens:[{knowledge:restored.world.citizens[0].knowledge}]});
 assert.ok(encoded.parts.length);
});

test('malformed packed envelopes cannot fall back to an older private state at the same minute',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 instance.world.citizens[0].knowledge=entries(100);await instance.persist({forceSeal:true});
 instance.world.citizens[0].knowledge[0].confidence=.9;await instance.persist({forceSeal:true});
 const meta=storage.sql.exec('SELECT generation,chunk_count FROM world_state_manifest')[0];
 const world=await decodeWorldSnapshot(instance.storedSnapshotParts(meta.generation,meta.chunk_count));
 delete world.citizens[0].knowledge.bins;
 const encoded=await encodeWorldSnapshotParts(world),base=meta.generation==='slot-b'?1000000:0;
 encoded.parts.forEach((part,i)=>storage.sql.exec('UPDATE world_state_chunks_v2 SET state_part=? WHERE id=?',part,base+i));
 storage.sql.exec('UPDATE world_state_manifest SET chunk_count=? WHERE id=1',encoded.parts.length);
 await assert.rejects(wake(storage),/sovereign_world_snapshot_unavailable_below_clock_guard/);
});

test('packed checkpoints store each logical concept once and recover page identities from its index',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 instance.world.citizens[0].knowledge=entries(3000).map((entry,i)=>({...entry,concept:`long:${i}:`+'private-meaning:'.repeat(16)}));
 await instance.persist({forceSeal:true});
 const meta=storage.sql.exec('SELECT generation,chunk_count FROM world_state_manifest')[0];
 const encoded=await decodeWorldSnapshot(instance.storedSnapshotParts(meta.generation,meta.chunk_count));
 const saved=encoded.citizens[0].knowledge;
 assert.ok(saved.pages.every(page=>!Object.hasOwn(page,'concepts')),'page directories must not duplicate the entire logical concept index');
 const expected=JSON.stringify(instance.world.citizens[0].knowledge);
 const {instance:restored}=await wake(storage);
 assert.equal(JSON.stringify(restored.world.citizens[0].knowledge),expected);
});

test('packed v1 directories remain readable while compact indices grow after restart',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 instance.world.citizens[0].knowledge=entries(1000);await instance.persist({forceSeal:true});
 const meta=storage.sql.exec('SELECT generation,chunk_count FROM world_state_manifest')[0];
 const saved=await decodeWorldSnapshot(instance.storedSnapshotParts(meta.generation,meta.chunk_count));
 for(const c of saved.citizens){const k=c.knowledge;k.format='knowledge-packed-v1';
  for(const p of k.pages){p.concepts=new Array(p.ends.length).fill(null);p.undefinedConcepts=[];}
  const pages=new Map(k.pages.map(p=>[p.id,p]));
  for(let i=0;i<k.rows.length;i++)pages.get(k.rows[i]).concepts[k.offsets[i]]=k.concepts[i];
 }
 const encoded=await encodeWorldSnapshotParts(saved),base=meta.generation==='slot-b'?1000000:0;
 encoded.parts.forEach((part,i)=>storage.sql.exec('UPDATE world_state_chunks_v2 SET state_part=? WHERE id=?',part,base+i));
 storage.sql.exec('UPDATE world_state_manifest SET chunk_count=? WHERE id=1',encoded.parts.length);
 const {instance:r}=await wake(storage),c=r.world.citizens[0];
 assert.equal(c.knowledge.length,1000);assert.equal(c.knowledge[999].provenance[0].eventId,'private:999');
 for(let i=1000;i<2200;i++)c.knowledge.push({concept:`append:${i}`,confidence:.8,active:true,provenance:[{kind:'teaching',eventId:`new:${i}`} ]});
 await r.persist({forceSeal:true});const {instance:again}=await wake(storage);
 assert.equal(again.world.citizens[0].knowledge.length,2200);assert.equal(again.world.citizens[0].knowledge[2199].provenance[0].eventId,'new:2199');
});

test('persisted history exceeds a small resident backing limit without losing sources or scanning rows per record',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 instance.world.citizens[0].knowledge=entries(5000);await instance.persist({forceSeal:true});
 const {instance:r}=await wake(storage),archive=r.knowledgeArchive,c=r.world.citizens[0];
 archive.maxBackingBytes=16000;archive.maxBinCacheBytes=32000;archive.binCache.clear();archive.binCacheBytes=0;
 const before=archive.sqlRowsRead;
 for(let i=0;i<c.knowledge.length;i+=137)assert.equal(c.knowledge[i].provenance[0].eventId,`private:${i}`);
 assert.ok(archive.binCacheBytes<=32000);assert.equal(archive.backingBytes,0);
 c.knowledge[0].provenance[0].eventId='changed';await r.persist({forceSeal:true});
 const {instance:verified}=await wake(storage);
 assert.equal(verified.world.citizens[0].knowledge.length,5000);
 assert.equal(verified.world.citizens[0].knowledge[0].provenance[0].eventId,'changed');
 assert.ok(archive.sqlRowsRead-before<100,'bin point loads must not become per-record database reads');
});

test('missing or corrupted canonical archive bins fail closed at the clock guard',async t=>{
 for(const minute of [0,50])for(const corrupt of [false,true]){
  const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
  instance.world.citizens[0].knowledge=entries(1000);instance.world.clock.worldMinute=minute;
  await instance.persist({forceSeal:true});
  const row=storage.sql.exec('SELECT id,data FROM knowledge_bins LIMIT 1')[0];
  if(corrupt){const data=new Uint8Array(row.data);data[0]^=1;storage.sql.exec('UPDATE knowledge_bins SET data=? WHERE id=?',data,row.id);}
  else storage.sql.exec('DELETE FROM knowledge_bins WHERE id=?',row.id);
  await assert.rejects(wake(storage),/sovereign_world_snapshot_unavailable_below_clock_guard/);
  assert.equal(storage.sql.exec('SELECT highest_world_minute FROM world_clock_guard')[0].highest_world_minute,minute);
 }
});

test('failed publication keeps staged writes charged and old canonical data intact',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 instance.world.citizens[0].knowledge=entries(1000);await instance.persist({forceSeal:true});
 const before=instance.readPersistenceBudget().rowsWritten;
 instance.world.citizens[0].knowledge[0].confidence=.9;instance.world.clock.worldMinute++;
 const exec=storage.sql.exec;
 storage.sql.exec=function(query,...args){if(query.includes('INSERT INTO world_state_manifest'))throw new Error('publication-failed');return exec.call(this,query,...args);};
 await assert.rejects(instance.persist({forceSeal:true}),/publication-failed/);storage.sql.exec=exec;
 assert.ok(instance.readPersistenceBudget().rowsWritten>before,'failed bin and snapshot staging must stay charged');
 const {instance:restored}=await wake(storage);
 assert.equal(restored.world.citizens[0].knowledge[0].confidence,.7);assert.equal(restored.world.clock.worldMinute,0);
});

test('bounded archive collection resumes beyond retained bins after cold eviction',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 const retained=Array.from({length:16},(_,i)=>i.toString(16).padStart(64,'0'));
 const orphan='f'.repeat(64);
 for(const id of [...retained,orphan])storage.sql.exec('INSERT INTO knowledge_bins(id,data) VALUES(?,?)',id,new Uint8Array([1]));
 storage.sql.exec('INSERT INTO knowledge_bin_slots(id,bin_ids) VALUES(1,?)',JSON.stringify(retained));
 instance.collectKnowledgeBins(new Date().toISOString().slice(0,10),40000);
 assert.equal(storage.sql.exec('SELECT id FROM knowledge_bins WHERE id=?',orphan).length,1);
 const {instance:restarted}=await wake(storage);
 restarted.collectKnowledgeBins(new Date().toISOString().slice(0,10),40000);
 assert.equal(storage.sql.exec('SELECT id FROM knowledge_bins WHERE id=?',orphan).length,0);
 for(const id of retained)assert.equal(storage.sql.exec('SELECT id FROM knowledge_bins WHERE id=?',id).length,1);
});

test('canonical checkpoints reuse unchanged compressed history and cold recovery does not inflate it',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 instance.world.citizens[0].knowledge=entries(5000);await instance.persist({forceSeal:true});
 const expected=JSON.stringify(instance.world.citizens[0].knowledge);
 const {instance:r}=await wake(storage);
 assert.equal(r.knowledgeArchive.stats().storage,'packed-sqlite');
 assert.equal(r.knowledgeArchive.stats().pageReads,0);
 const bins=storage.sql.exec('SELECT COUNT(*) AS n FROM knowledge_bins')[0].n;
 r.knowledgeArchive.pageText=()=>{throw new Error('unchanged history inflated');};
 // Projection intentionally accesses recent knowledge; isolate canonical encoding.
 r.refreshPublicSnapshot=async()=>{};r.world.clock.worldMinute++;
 await r.persist({forceSeal:true});
 assert.equal(storage.sql.exec('SELECT COUNT(*) AS n FROM knowledge_bins')[0].n,bins);
 const {instance:verified}=await wake(storage);
 assert.equal(JSON.stringify(verified.world.citizens[0].knowledge),expected);
});

test('legacy full-array snapshots migrate once without changing private logical data',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 instance.world.citizens[0].knowledge=entries(3000);
 const expected=JSON.stringify(instance.world.citizens[0].knowledge);
 const encoded=await encodeWorldSnapshotParts(instance.world);
 const meta=storage.sql.exec('SELECT generation FROM world_state_manifest WHERE id=1')[0];
 const base=meta.generation==='slot-b'?1000000:0;
 encoded.parts.forEach((part,i)=>storage.sql.exec('INSERT OR REPLACE INTO world_state_chunks_v2(id,state_part) VALUES(?,?)',base+i,part));
 storage.sql.exec('UPDATE world_state_manifest SET chunk_count=? WHERE id=1',encoded.parts.length);
 storage.sql.exec('UPDATE world_snapshot_slots SET chunk_count=? WHERE generation=?',encoded.parts.length,meta.generation);
 const {instance:legacy}=await wake(storage);
 assert.equal(JSON.stringify(legacy.world.citizens[0].knowledge),expected);
 await legacy.persist({forceSeal:true});
 const {instance:packed}=await wake(storage);
 assert.equal(packed.knowledgeArchive.stats().storage,'packed-sqlite');
 assert.equal(packed.knowledgeArchive.stats().pageReads,0);
 assert.equal(JSON.stringify(packed.world.citizens[0].knowledge),expected);
});
