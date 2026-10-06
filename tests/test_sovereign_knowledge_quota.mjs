import test from 'node:test';
import assert from 'node:assert/strict';
import {knows} from '../world/index.js';
import {knowledgeForEntity} from '../world/knowledge-storage.js';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';
const entries=()=>Array.from({length:2400},(_,i)=>({concept:`quota:${i}`,active:true,confidence:.7,provenance:[{kind:'observation',eventId:`event:${i}`,evidence:{entityId:`entity:${i%10}`}}]}));

test('cold recovery succeeds at the exhausted legacy scratch budget without scratch SQL',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());
 const {instance}=await wake(storage);instance.world.citizens[0].knowledge=entries();await instance.persist({forceSeal:true});
 storage.sql.exec('UPDATE persistence_budget SET rows_written=60000 WHERE id=1');
 const exec=storage.sql.exec;let scratch=0;
 storage.sql.exec=function(query,...args){if(query.includes('world_knowledge_scratch'))scratch++;return exec.call(this,query,...args);};
 const {instance:restored}=await wake(storage);
 assert.equal(restored.world.citizens[0].knowledge.length,2400);assert.ok(knows(restored.world.citizens[0],'quota:2399'));
 assert.equal(scratch,0,'recovery must not rebuild, query or delete disposable SQL pages');
 assert.equal(restored.readPersistenceBudget().rowsWritten,60000,'spent quota remains accounted');
});

test('entity counts and concepts do not decode private pages',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage),c=instance.world.citizens[0];
 c.knowledge=entries();instance.registerCitizenEvidence();const before=instance.knowledgeArchive.stats().pageReads;
 assert.equal(knowledgeForEntity(c,'entity:2').length,240);
 assert.deepEqual(knowledgeForEntity(c,'entity:2').slice(0,3).map(k=>k.concept),['quota:2','quota:12','quota:22']);
 assert.equal(instance.knowledgeArchive.stats().pageReads,before);
});

test('fragmented serialization inflates each page once per bounded logical window',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage),c=instance.world.citizens[0];
 c.knowledge=entries().slice(0,2100).map(k=>({...k,padding:'x'.repeat(3000)}));instance.registerCitizenEvidence();
 for(let round=0;round<20;round++){
  for(let i=round;i<c.knowledge.length;i+=20)c.knowledge[i].confidence=.8;
  instance.knowledgeArchive.flush();
 }
 instance.knowledgeArchive.cache.clear();instance.knowledgeArchive.cachedCodeUnits=0;
 const before=instance.knowledgeArchive.stats().pageReads;
 await instance.persist({forceSeal:true});
 const reads=instance.knowledgeArchive.stats().pageReads-before;
 assert.ok(reads<1200,`fragmented checkpoint inflated ${reads} pages`);
 const {instance:restored}=await wake(storage);
 assert.equal(restored.world.citizens[0].knowledge.length,2100);
 for(let i=0;i<2100;i++)assert.equal(restored.world.citizens[0].knowledge[i].confidence,.8);
});

test('rollback releases the failed archive before reconstructing canonical knowledge',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 instance.world.citizens[0].knowledge=entries();await instance.persist({forceSeal:true});
 const failed=instance.knowledgeArchive;assert.ok(failed.pages.size>0);
 await instance.restoreCommittedWorld();
 assert.equal(failed.pages.size,0,'retained references must not keep failed compressed backing alive');
 assert.equal(failed.stores.size,0);
 assert.equal(instance.world.citizens[0].knowledge[2399].provenance[0].eventId,'event:2399');
});

test('replacing a Citizen knowledge array releases superseded backing and indexes',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage),c=instance.world.citizens[0];
 c.knowledge=entries();instance.registerCitizenEvidence();const archive=instance.knowledgeArchive;
 const stores=archive.stores.size;
 c.knowledge=entries();instance.registerCitizenEvidence();
 assert.equal(archive.stores.size,stores,'only the current logical store belongs to a Citizen');
 assert.equal([...archive.pageRefs.values()].reduce((a,b)=>a+b,0),2400);
 assert.equal(c.knowledge[2399].provenance[0].eventId,'event:2399');
});

test('seal high-water lookup uses an index rather than scanning history',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());await wake(storage);
 const plan=[...storage.sql.exec('EXPLAIN QUERY PLAN SELECT MAX(world_minute) AS world_minute FROM world_seals')];
 assert.ok(plan.some(row=>row.detail.includes('USING COVERING INDEX')),JSON.stringify(plan));
});

test('checkpoint pruning does not count the entire seal history',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 const exec=storage.sql.exec;let unboundedCounts=0;
 storage.sql.exec=function(query,...args){if(query==='SELECT COUNT(*) AS count FROM world_seals')unboundedCounts++;return exec.call(this,query,...args);};
 await instance.persist({forceSeal:true});assert.equal(unboundedCounts,0);
});

test('index migration defers at exhausted quota and retries after the UTC budget day changes',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 storage.sql.exec('DROP INDEX world_seals_minute');storage.sql.exec('DROP TABLE world_seal_inventory');
 storage.sql.exec('UPDATE persistence_budget SET rows_written=60000 WHERE id=1');
 const {instance:restored}=await wake(storage);const minute=restored.clockHighWaterMark;
 assert.equal(restored.sealIndexReady,undefined);assert.equal(restored.readPersistenceBudget().rowsWritten,60000);
 assert.equal(storage.sql.exec("SELECT name FROM sqlite_master WHERE name='world_seal_inventory'").length,0,'new DDL must defer along with its backfill');
 await assert.rejects(restored.persist({forceSeal:true}),/seal_index_migration_budget_exhausted/);
 assert.equal(restored.clockHighWaterMark,minute);
 storage.sql.exec("UPDATE persistence_budget SET day='2000-01-01' WHERE id=1");
 await restored.persist({forceSeal:true});assert.equal(restored.sealIndexReady,true);
 assert.ok(restored.readPersistenceBudget().rowsWritten>0);
 const count=storage.sql.exec('SELECT row_count FROM world_seal_inventory WHERE id=1')[0].row_count;
 assert.equal(count,storage.sql.exec('SELECT COUNT(*) AS n FROM world_seals')[0].n);
});

test('seal retention counts real rows including sequence gaps and out-of-order durable minutes',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 storage.sql.exec("INSERT INTO world_seals(seq,world_minute,ledger_head,state_sha256,created_at) VALUES(10000,0,'head','hash',0)");
 await instance.persist({forceSeal:true});
 assert.equal(storage.sql.exec('SELECT row_count FROM world_seal_inventory WHERE id=1')[0].row_count,3);
 assert.ok(storage.sql.exec('SELECT seq FROM world_seals WHERE seq=1').length);
 storage.sql.exec("UPDATE world_seals SET world_minute=999 WHERE seq=1");
 await assert.rejects(wake(storage),/sovereign_world_snapshot_unavailable_below_clock_guard|sovereign_world_clock_regression/);
});
