import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {KnowledgeArchive} from '../worker/src/knowledge-archive.js';
import {encodeWorldSnapshotParts,decodeSnapshot,decodeWorldSnapshot} from '../worker/src/persistence.js';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';

const mode='shared-indices-v1';
async function packed(world,options={}){
  return encodeWorldSnapshotParts(world,{packedKnowledge:mode,...options});
}
async function fixture(t,{count=1200,citizens=12}={}){
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage),base=JSON.parse(JSON.stringify(instance.world.citizens[0]));
  const concepts=Array.from({length:count},(_,i)=>createHash('sha256').update(`object:${i}`).digest('hex').slice(0,16));
  instance.world.citizens=Array.from({length:citizens},(_,ci)=>({...structuredClone(base),id:`citizen:${ci}`,
    knownEntityIds:concepts.map(id=>`entity:${id}`),knowledge:concepts.map((id,i)=>({concept:`concept:${id}`,active:i%5!==0,confidence:.7,
      provenance:[{kind:'observation',eventId:`private:${ci}:${i}`,evidence:{entityId:`entity:${id}`,appearance:'original matter'}}]}))}));
  await instance.persist({forceSeal:true});
  return {storage,instance};
}

test('shared checkpoint indices reduce repeated private index storage while preserving every source after cold recovery',async t=>{
  const {storage,instance}=await fixture(t);
  const pageReads=instance.knowledgeArchive.pageReads;
  const legacy=await encodeWorldSnapshotParts(instance.world,{packedKnowledge:true});
  const encoded=await packed(instance.world);
  assert.equal(instance.knowledgeArchive.pageReads,pageReads,'saving indices must not hydrate archived private records');
  assert.ok(encoded.parts.join('').length<legacy.parts.join('').length*.7,'repeated strings must not consume the old checkpoint row cadence');
  const wire=JSON.parse(await decodeSnapshot(encoded.parts.join('')));
  assert.equal(wire.checkpointIndexStrings.format,'checkpoint-index-strings-v1');
  assert.equal(wire.citizens[0].knowledge.format,'knowledge-packed-v3');
  assert.equal(wire.citizens[0].knownEntityIds.format,'checkpoint-index-refs-v1');
  assert.ok(wire.checkpointIndexStrings.strings.length<3000);
  const oldArchive=new KnowledgeArchive(instance.sql);
  const old=await decodeWorldSnapshot(legacy.parts,{onArrayItem:(key,item)=>{if(key==='citizens')oldArchive.attach(item);return item;}});
  assert.equal(old.citizens.at(-1).knowledge.at(-1).provenance[0].eventId,'private:11:1199');
  const {instance:restored}=await wake(storage);
  for(let ci=0;ci<restored.world.citizens.length;ci++){
    const a=instance.world.citizens[ci],b=restored.world.citizens[ci];
    assert.deepEqual(b.knownEntityIds,a.knownEntityIds);
    assert.equal(JSON.stringify(b.knowledge),JSON.stringify(a.knowledge));
    assert.equal(b.knowledge.at(-1).provenance[0].eventId,`private:${ci}:1199`);
  }
});

test('shared refs preserve undefined, non-string concepts, multi-entity evidence and private membership',async t=>{
  const {instance}=await fixture(t,{count:8,citizens:2});
  const records=[{id:'fallback',active:true,provenance:[]},{concept:null,active:false,provenance:[]},
    {concept:42,active:true,provenance:[{evidence:{entityId:'private-a'}},{evidence:{entityId:'private-b'}}]},
    {concept:'\uD800:opaque',active:true,provenance:[{evidence:{entityId:'x'.repeat(5000)}}]}];
  const c=instance.world.citizens[0];c.knowledge=records;c.knownEntityIds=['private-a',undefined,null,42,'\uD800:opaque'];
  await instance.persist({forceSeal:true});
  const encoded=await packed(instance.world);
  const archive=new KnowledgeArchive(instance.sql);
  const restored=await decodeWorldSnapshot(encoded.parts,{onArrayItem:(key,item)=>{if(key==='citizens')archive.attach(item);return item;}});
  assert.equal(restored.checkpointIndexStrings,undefined);
  assert.deepEqual(restored.citizens[0].knownEntityIds,c.knownEntityIds);
  assert.equal(restored.citizens[0].knowledge[0].concept,undefined);
  assert.equal(JSON.stringify(restored.citizens[0].knowledge),JSON.stringify(c.knowledge));
  assert.ok(!restored.citizens[1].knownEntityIds.includes('private-a'));
});

test('index dictionary overflow stays bounded and keeps uncached original identifiers',async t=>{
  const {instance}=await fixture(t,{count:1,citizens:1});
  const c=instance.world.citizens[0];
  c.knownEntityIds=Array.from({length:65550},(_,i)=>`bounded-private:${i}`);
  const encoded=await packed(instance.world),wire=JSON.parse(await decodeSnapshot(encoded.parts.join('')));
  assert.ok(wire.checkpointIndexStrings.strings.length<=65536);
  assert.ok(wire.checkpointIndexStrings.strings.reduce((n,v)=>n+v.length,0)<=2*1024*1024);
  const restored=await decodeWorldSnapshot(encoded.parts);
  assert.deepEqual(restored.citizens[0].knownEntityIds,c.knownEntityIds);
  c.knownEntityIds=Array.from({length:600},(_,i)=>`${i}:`+'x'.repeat(4080));
  const large=await packed(instance.world),largeWire=JSON.parse(await decodeSnapshot(large.parts.join('')));
  assert.ok(largeWire.checkpointIndexStrings.strings.reduce((n,v)=>n+v.length,0)<=2*1024*1024);
  assert.deepEqual((await decodeWorldSnapshot(large.parts)).citizens[0].knownEntityIds,c.knownEntityIds);
});

test('damaged or missing shared references fail closed before citizen hydration',async()=>{
  const make=(dictionary,refs)=>JSON.stringify({...(dictionary===undefined?{}:{checkpointIndexStrings:dictionary}),
    clock:{worldMinute:12},citizens:[{knownEntityIds:{format:'checkpoint-index-refs-v1',refs},knowledge:[]}],ledger:[]});
  const dict={format:'checkpoint-index-strings-v1',strings:['private']};
  const invalidKnown=known=>JSON.stringify({checkpointIndexStrings:dict,clock:{worldMinute:12},
    citizens:[{knownEntityIds:known,knowledge:[]}],ledger:[]});
  for(const source of [make(undefined,[0]),make(undefined,[]),make(dict,[1]),make(dict,[-1]),make(dict,[.5]),
    make(dict,[[1,2]]),make({format:dict.format,strings:[42]},[0]),make([],[]),
    invalidKnown({format:'unknown',refs:[0]}),invalidKnown({refs:[0]}),invalidKnown('invalid')]){
    let hydrated=0;
    await assert.rejects(decodeWorldSnapshot(source,{onArrayItem:(key,item)=>{if(key==='citizens')hydrated++;return item;}}),/knowledge_index_/);
    assert.equal(hydrated,0);
  }
});

test('shared index seals cover the exact wire bytes and ordinary exports keep complete private records',async t=>{
  const {instance}=await fixture(t,{count:20,citizens:2});
  const encoded=await packed(instance.world,{sealDue:true}),wire=await decodeSnapshot(encoded.parts.join(''));
  assert.equal(encoded.stateSha256,createHash('sha256').update(wire).digest('hex'));
  const ordinary=await encodeWorldSnapshotParts(instance.world),exported=await decodeWorldSnapshot(ordinary.parts);
  assert.equal(exported.checkpointIndexStrings,undefined);
  assert.ok(Array.isArray(exported.citizens[0].knowledge));
  assert.equal(exported.citizens[0].knowledge.at(-1).provenance[0].eventId,'private:0:19');
});
