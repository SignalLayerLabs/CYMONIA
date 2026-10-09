import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {KnowledgeArchive} from '../worker/src/knowledge-archive.js';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';
import {knows,forget,knowsEntity} from '../world/epistemics.js';

test('shared immutable index strings preserve private membership, ordering and sources after cold recovery',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);
  const [a,b]=instance.world.citizens;
  const entry=(concept,eventId)=>({concept,active:true,confidence:.8,provenance:[{kind:'observation',eventId,evidence:{entityId:'object:shared-physical-id'}}]});
  a.knowledge=[entry('concept:shared-physical-id','private:a'),entry('concept:only-a','private:secret')];
  b.knowledge=[entry('concept:shared-physical-id','private:b')];
  a.knownEntityIds=['object:shared-physical-id','object:only-a'];b.knownEntityIds=['object:shared-physical-id'];
  const expected=JSON.stringify([a.knowledge,b.knowledge]);
  await instance.persist({forceSeal:true});const {instance:restored}=await wake(storage);
  const [ra,rb]=restored.world.citizens;
  assert.equal(JSON.stringify([ra.knowledge,rb.knowledge]),expected);
  assert.deepEqual(ra.knownEntityIds,a.knownEntityIds);assert.deepEqual(rb.knownEntityIds,b.knownEntityIds);
  assert.ok(restored.knowledgeArchive.stats().indexStringPoolHits>=3,'cold duplicates should reuse detached strings');
  assert.equal(knows(rb,'concept:only-a'),false);assert.equal(knowsEntity(rb,'object:only-a'),false);
  forget(ra,'concept:shared-physical-id');
  assert.equal(knows(ra,'concept:shared-physical-id'),false);assert.equal(knows(rb,'concept:shared-physical-id'),true);
  assert.equal(rb.knowledge[0].provenance[0].eventId,'private:b');
});

test('index string sharing has finite entry and character bounds without changing uncached values',()=>{
  const archive=new KnowledgeArchive(null,{maxIndexStrings:3,maxIndexStringUnits:40});
  for(let i=0;i<100;i++)assert.equal(archive.internIndexString(`entity:${i}`),`entity:${i}`);
  const oversized='private-long-meaning:'.repeat(200);
  assert.equal(archive.internIndexString(oversized),oversized);
  assert.equal(archive.internIndexString(null),null);assert.equal(archive.internIndexString(undefined),undefined);
  assert.ok(archive.stats().indexStringPoolEntries<=3);assert.ok(archive.stats().indexStringPoolUnits<=40);
  archive.dispose();assert.equal(archive.stats().indexStringPoolEntries,0);assert.equal(archive.stats().indexStringPoolUnits,0);
});

test('actual repeated physical-ID shapes retain substantially less heap when shared',()=>{
  const probe=spawnSync(process.execPath,['--expose-gc','--input-type=module','-e',`
    import v8 from 'node:v8';
    import {KnowledgeArchive} from './worker/src/knowledge-archive.js';
    function measure(shared){
      global.gc();const before=v8.getHeapStatistics().used_heap_size;
      const archive=new KnowledgeArchive(null,{maxIndexStrings:shared?65536:0});
      const values=[];
      for(let i=0;i<120000;i++)values.push(archive.internIndexString('kobject:'+String(i%512).padStart(8,'0')));
      global.gc();const retained=v8.getHeapStatistics().used_heap_size-before;
      if(values[119999]!=='kobject:'+String(119999%512).padStart(8,'0'))throw new Error('index value changed');
      return retained;
    }
    const unshared=measure(false),shared=measure(true);
    console.log(JSON.stringify({unshared,shared}));
  `],{encoding:'utf8'});
  assert.equal(probe.status,0,probe.stderr);
  const {unshared,shared}=JSON.parse(probe.stdout);
  assert.ok(shared<unshared*.5,`repeated IDs must not retain one allocation per record: ${probe.stdout}`);
});
