import test from 'node:test';
import assert from 'node:assert/strict';
import {learn,forget,knows,advanceWorldTo,publicWorld} from '../world/index.js';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';

const entries=()=>Array.from({length:2400},(_,i)=>({concept:`archive:${i}`,confidence:.7,active:true,
  provenance:[{kind:'observation',eventId:`event:${i}`,evidence:{entityId:`object:${i}`,appearance:'observed matter'}}],learnedWorldMinute:i}));

test('a newly learned entry remains a live reference after page flushing and restart',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage),c=instance.world.citizens[0];
  const learned=learn(c,'new-reference',{kind:'observation',eventId:'original'},.7,1);
  instance.knowledgeArchive.flush();
  learned.confidence=.9;learned.provenance[0].eventId='updated';learned.active=false;
  assert.equal(c.knowledge[0].confidence,.9);
  assert.equal(c.knowledge[0].provenance[0].eventId,'updated');
  assert.equal(knows(c,'new-reference'),false);
  await instance.persist({forceSeal:true});
  const {instance:restarted}=await wake(storage),restored=restarted.world.citizens[0];
  assert.equal(restored.knowledge[0].confidence,.9);
  assert.equal(restored.knowledge[0].provenance[0].eventId,'updated');
  assert.equal(knows(restored,'new-reference'),false);
});

test('private knowledge survives restart while resident records stay bounded',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);const citizen=instance.world.citizens[0];
  citizen.knowledge=entries();await instance.persist({forceSeal:true});
  const {instance:restarted}=await wake(storage),c=restarted.world.citizens[0];
  assert.ok(restarted.knowledgeArchive,'knowledge must be backed by SQLite pages');
  assert.equal(c.knowledge.length,2400);
  for(let i=0;i<2400;i++)assert.equal(c.knowledge[i].provenance[0].eventId,`event:${i}`);
  assert.ok(restarted.knowledgeArchive.stats().cachedCodeUnits<=524288);
  assert.ok(knows(c,'archive:0')&&knows(c,'archive:2399'));
  learn(c,'archive:0',{kind:'teaching',eventId:'new-proof'},.9,2500);
  forget(c,'archive:2399');
  for(let i=0;i<2400;i++)void c.knowledge[i];
  assert.equal(c.knowledge[0].confidence,.9);
  assert.equal(c.knowledge[0].provenance.at(-1).eventId,'new-proof');
  assert.equal(knows(c,'archive:2399'),false);
  restarted.world.clock.worldMinute++;
  await restarted.persist({forceSeal:true});
  const {instance:third}=await wake(storage),last=third.world.citizens[0];
  assert.equal(last.knowledge.length,2400);
  assert.equal(last.knowledge[0].confidence,.9);
  assert.equal(last.knowledge[0].provenance.length,2);
  assert.equal(knows(last,'archive:2399'),false);
});

test('an interrupted archive checkpoint leaves the previous knowledge authoritative',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);instance.world.citizens[0].knowledge=entries();
  await instance.persist({forceSeal:true});
  learn(instance.world.citizens[0],'uncommitted',{kind:'observation',eventId:'pending'},.8,1);
  instance.world.clock.worldMinute++;
  const exec=storage.sql.exec;
  storage.sql.exec=function(query,...args){if(query.includes('INSERT INTO world_state_manifest'))throw new Error('interrupted-publication');return exec.call(this,query,...args);};
  await assert.rejects(instance.persist({forceSeal:true}),/interrupted-publication/);
  storage.sql.exec=exec;
  const {instance:restored}=await wake(storage);
  assert.equal(restored.world.citizens[0].knowledge.length,2400);
  assert.equal(knows(restored.world.citizens[0],'uncommitted'),false);
});

test('ordinary and paged knowledge produce the same canonical simulation',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);instance.world.citizens[0].knowledge=entries();
  const ordinary=JSON.parse(JSON.stringify(instance.world));
  await instance.persist({forceSeal:true});
  // Persistence bookkeeping is runtime-only; start both physical kernels
  // with precisely the same full canonical state.
  const plain=JSON.parse(JSON.stringify(instance.world));
  const until=plain.clock.realEpochMs+20_000;
  advanceWorldTo(plain,until);advanceWorldTo(instance.world,until);
  assert.equal(JSON.stringify(instance.world),JSON.stringify(plain));
  assert.equal(ordinary.citizens[0].knowledge.length,2400);
});

test('previous nested references keep changing the logical record after page eviction and flush',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);const c=instance.world.citizens[0];c.knowledge=entries();
  await instance.persist({forceSeal:true});
  const source=c.knowledge[0].provenance[0],sources=c.knowledge[0].provenance;
  for(let i=0;i<2400;i++)void c.knowledge[i].confidence;
  source.eventId='retained-reference';sources.push({kind:'teaching',eventId:'second-source'});
  instance.knowledgeArchive.flush();
  for(let i=0;i<2400;i++)void c.knowledge[i].confidence;
  source.eventId='retained-after-flush';
  assert.equal(c.knowledge[0].provenance[0].eventId,'retained-after-flush');
  assert.equal(c.knowledge[0].provenance[1].eventId,'second-source');
});

test('failed scratch inserts are charged and leave dirty knowledge readable',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage),c=instance.world.citizens[0];
  learn(c,'pending',{kind:'observation',eventId:'pending-proof'},.9,1);
  const before=instance.readPersistenceBudget().rowsWritten,exec=storage.sql.exec;
  storage.sql.exec=function(query,...args){if(query.includes('INSERT INTO world_knowledge_scratch'))throw new Error('scratch-write-interrupted');return exec.call(this,query,...args);};
  assert.throws(()=>instance.knowledgeArchive.flush(),/scratch-write-interrupted/);
  storage.sql.exec=exec;
  assert.ok(instance.readPersistenceBudget().rowsWritten>before);
  assert.equal(c.knowledge[0].provenance[0].eventId,'pending-proof');
  instance.knowledgeArchive.flush();assert.equal(knows(c,'pending'),true);
});

test('oversized ordinary page records are preserved without retaining an oversized cache page',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage),c=instance.world.citizens[0];
  c.knowledge=[{concept:'large',confidence:.7,active:true,provenance:[{kind:'observation',evidence:{text:'x'.repeat(700_000)}}]}];
  await instance.persist({forceSeal:true});
  assert.equal(c.knowledge[0].provenance[0].evidence.text.length,700_000);
  assert.ok(instance.knowledgeArchive.stats().cachedCodeUnits<=524288);
  const {instance:restarted}=await wake(storage);
  assert.equal(restarted.world.citizens[0].knowledge[0].provenance[0].evidence.text.length,700_000);
});

test('scratch corruption is detected and recovery uses the intact complete checkpoint',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage),c=instance.world.citizens[0];c.knowledge=entries();
  instance.world.citizens[1].knowledge=entries();
  await instance.persist({forceSeal:true});
  storage.sql.exec("UPDATE world_knowledge_scratch SET state_json=json_replace(state_json,'$[0].provenance[0].eventId','damaged') WHERE id=(SELECT MIN(id) FROM world_knowledge_scratch)");
  await assert.rejects(instance.mutateWorld(()=>c.knowledge[0].provenance[0].eventId),/knowledge_scratch_checksum/);
  assert.equal(instance.world.citizens[0].knowledge[0].provenance[0].eventId,'event:0');
  assert.equal(instance.world.citizens[0].knowledge.length,2400);
});

test('partial immutable pages are compacted without keeping obsolete private records',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage),c=instance.world.citizens[0];c.knowledge=entries();
  await instance.persist({forceSeal:true});
  for(let i=0;i<2400;i++)if(i%5)c.knowledge[i].confidence=.9;
  instance.knowledgeArchive.flush();instance.knowledgeArchive.reclaim();
  const retained=[...storage.sql.exec('SELECT SUM(json_array_length(state_json)) AS count FROM world_knowledge_scratch')][0].count;
  assert.ok(retained<3000,'scratch pages must not retain thousands of superseded records');
  for(let i=0;i<2400;i++)assert.equal(c.knowledge[i].confidence,i%5?.9:.7);
});

test('paging preserves opaque concepts including unpaired UTF-16 surrogates',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage),c=instance.world.citizens[0];
  c.knowledge=[{concept:'\uD800:private',confidence:.7,active:true,provenance:[{kind:'observation',eventId:'original'}]}];
  await instance.persist({forceSeal:true});
  assert.equal(knows(c,'\uD800:private'),true);
  assert.equal(c.knowledge[0].concept,'\uD800:private');
});

test('scratch quota exhaustion does not publish or lose pending knowledge',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage),c=instance.world.citizens[0];
  learn(c,'pending',{kind:'observation',eventId:'pending-proof'},.8,1);
  const guard=instance.clockHighWaterMark;
  storage.sql.exec('UPDATE persistence_budget SET rows_written=40000 WHERE id=1');
  assert.throws(()=>instance.knowledgeArchive.flush(),/knowledge_write_budget_exhausted/);
  assert.equal(instance.clockHighWaterMark,guard);
  assert.equal(c.knowledge[0].provenance[0].eventId,'pending-proof');
  storage.sql.exec('UPDATE persistence_budget SET rows_written=100 WHERE id=1');
  instance.knowledgeArchive.flush();assert.equal(knows(c,'pending'),true);
});

test('GC failures remain charged and do not delete a live logical record',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage),c=instance.world.citizens[0];c.knowledge=entries();
  await instance.persist({forceSeal:true});
  for(let i=0;i<2400;i++)c.knowledge[i].confidence=.9;
  instance.knowledgeArchive.flush();
  const before=instance.readPersistenceBudget().rowsWritten,exec=storage.sql.exec;
  storage.sql.exec=function(query,...args){if(query.startsWith('DELETE FROM world_knowledge_scratch'))throw new Error('gc-interrupted');return exec.call(this,query,...args);};
  assert.throws(()=>instance.knowledgeArchive.reclaim(),/gc-interrupted/);
  storage.sql.exec=exec;
  assert.ok(instance.readPersistenceBudget().rowsWritten>before);
  assert.equal(c.knowledge[0].confidence,.9);
  instance.knowledgeArchive.reclaim();
  assert.equal(c.knowledge[2399].provenance[0].eventId,'event:2399');
});

test('Observer previews contain ordinary data without retaining private runtime adapters',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);instance.world.citizens[0].knowledge=entries();
  await instance.persist({forceSeal:true});
  const view=structuredClone(publicWorld(instance.world));
  assert.equal(view.citizens[0].knowledge.count,2400);
  assert.equal(view.citizens[0].knowledge.items[0].provenance[0].eventId,'event:2372');
});
