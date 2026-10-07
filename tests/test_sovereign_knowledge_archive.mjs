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
  assert.ok(restarted.knowledgeArchive,'knowledge must use bounded compressed pages');
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

test('compressed capacity failure leaves dirty knowledge readable and quota untouched',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage),c=instance.world.citizens[0];
  learn(c,'pending',{kind:'observation',eventId:'pending-proof'},.9,1);
  const before=instance.readPersistenceBudget().rowsWritten;
  instance.knowledgeArchive.maxBackingBytes=0;
  assert.throws(()=>instance.knowledgeArchive.flush(),/knowledge_compressed_capacity_exceeded/);
  assert.equal(instance.readPersistenceBudget().rowsWritten,before);
  assert.equal(c.knowledge[0].provenance[0].eventId,'pending-proof');
  instance.knowledgeArchive.maxBackingBytes=32*1024*1024;
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

test('compressed page corruption is detected and recovery uses the intact complete checkpoint',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage),c=instance.world.citizens[0];c.knowledge=entries();
  instance.world.citizens[1].knowledge=entries();
  await instance.persist({forceSeal:true});
  const archive=instance.knowledgeArchive;archive.cache.clear();archive.cachedCodeUnits=0;
  archive.pages.values().next().value.checksum^=1;
  await assert.rejects(instance.mutateWorld(()=>c.knowledge[0].provenance[0].eventId),/knowledge_page_checksum/);
  assert.equal(instance.world.citizens[0].knowledge[0].provenance[0].eventId,'event:0');
  assert.equal(instance.world.citizens[0].knowledge.length,2400);
});

test('partial immutable pages are compacted without keeping obsolete private records',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage),c=instance.world.citizens[0];c.knowledge=entries();
  await instance.persist({forceSeal:true});
  for(let i=0;i<2400;i++)if(i%5)c.knowledge[i].confidence=.9;
  instance.knowledgeArchive.flush();instance.knowledgeArchive.reclaim();
  const retained=[...instance.knowledgeArchive.pageCounts.values()].reduce((a,b)=>a+b,0);
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

test('exhausted persistence quota does not prevent compressed page flushing',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage),c=instance.world.citizens[0];
  learn(c,'pending',{kind:'observation',eventId:'pending-proof'},.8,1);
  const guard=instance.clockHighWaterMark;
  storage.sql.exec('UPDATE persistence_budget SET rows_written=40000 WHERE id=1');
  instance.knowledgeArchive.flush();
  assert.equal(instance.readPersistenceBudget().rowsWritten,40000);
  assert.equal(instance.clockHighWaterMark,guard);
  assert.equal(c.knowledge[0].provenance[0].eventId,'pending-proof');
  instance.knowledgeArchive.flush();assert.equal(knows(c,'pending'),true);
});

test('compressed garbage collection needs no SQL writes and does not delete live records',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage),c=instance.world.citizens[0];c.knowledge=entries();
  await instance.persist({forceSeal:true});
  for(let i=0;i<2400;i++)c.knowledge[i].confidence=.9;
  instance.knowledgeArchive.flush();
  const before=instance.readPersistenceBudget().rowsWritten;
  instance.knowledgeArchive.reclaim();
  assert.equal(instance.readPersistenceBudget().rowsWritten,before);
  assert.equal(c.knowledge[0].confidence,.9);
  assert.equal(c.knowledge[2399].provenance[0].eventId,'event:2399');
  assert.equal(instance.knowledgeArchive.pages.size,instance.knowledgeArchive.pageRefs.size);
});

test('Observer previews contain ordinary data without retaining private runtime adapters',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);instance.world.citizens[0].knowledge=entries();
  await instance.persist({forceSeal:true});
  const view=structuredClone(publicWorld(instance.world));
  assert.equal(view.citizens[0].knowledge.count,2400);
  assert.equal(view.citizens[0].knowledge.items[0].provenance[0].eventId,'event:2372');
});

test('cold recovery leaves historical evidence compressed and hydrates it only on access',async t=>{
 const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
 const c=instance.world.citizens[0];c.knowledge=entries();
 c.memories=[{kind:'episodic',source:{kind:'observation',evidence:{entityId:'memory-only',position:{x:1,y:2}}}}];
 await instance.persist({forceSeal:true});
 const {instance:restored}=await wake(storage),r=restored.world.citizens[0];
 assert.equal(restored.evidencePool.stats().pooledEvidence,1,'cold recovery must not intern the entire knowledge archive');
 assert.ok(Object.isFrozen(r.memories[0].source.evidence.position));
 assert.equal(r.knowledge[0].provenance[0].evidence.entityId,'object:0');
 assert.ok(Object.isFrozen(r.knowledge[0].provenance[0].evidence.position)||Object.isFrozen(r.knowledge[0].provenance[0].evidence));
 assert.ok(restored.evidencePool.stats().pooledEvidence>1,'accessed evidence must still enter the immutable runtime pool');
});
