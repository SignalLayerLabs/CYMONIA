import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  encodeWorldSnapshotParts,
  decodeSnapshot,
  decodeWorldSnapshot,
  snapshotGzipSize,
} from '../worker/src/persistence.js';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';
import {recordMemory} from '../world/memory.js';

test('new private memories keep a bounded recent window with provenance',()=>{
  const citizen={id:'memory-cap',memories:[]};
  for(let minute=0;minute<520;minute++)recordMemory(citizen,{content:{minute},source:{kind:'observation',eventId:`e:${minute}`},worldMinute:minute});
  assert.equal(citizen.memories.length,512);
  assert.equal(citizen.memories[0].createdWorldMinute,8);
  assert.equal(citizen.memories.at(-1).source.eventId,'e:519');
});

test('a legacy oversized memory snapshot is compacted and remains bounded after wake',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);
  instance.world.citizens[0].memories=Array.from({length:1500},(_,i)=>({id:`legacy:${i}`,kind:'episodic',content:{i},source:{kind:'observation',eventId:`e:${i}`},confidence:1,salience:.9,createdWorldMinute:i,lastRecalledWorldMinute:i}));
  await instance.persist({forceSeal:true});
  const {instance:restarted}=await wake(storage);
  await restarted.tick(0);
  const {instance:verified}=await wake(storage);
  const memories=verified.world.citizens[0].memories;
  assert.equal(memories.length,512);
  assert.equal(memories[0].id,'legacy:988');
  assert.equal(memories.at(-1).source.eventId,'e:1499');
});

test('canonical snapshot compression emits bounded parts without a whole compressed ArrayBuffer',async t=>{
  const world={
    version:2,
    worldId:'memory-path-v2',
    clock:{worldMinute:42,realEpochMs:0},
    citizens:Array.from({length:5},(_,i)=>({
      id:`citizen:${i}`,
      memories:Array.from({length:160},(_,j)=>({
        id:`memory:${i}:${j}`,
        // Deterministic high-entropy content: the original repeated emoji
        // compressed so well that the entire checkpoint legitimately fit in
        // one <=4 KiB part, making `parts.length > 1` a broken test premise.
        // Hash-derived payloads force this fixture across multiple bounded
        // parts without introducing randomness or changing production code.
        note:createHash('sha256')
          .update(`memory-path-v2:${i}:${j}`)
          .digest('hex'),
      })),
    })),
    ledger:[],
    ledgerHead:'head',
    runtime:{},
  };
  const expected=JSON.stringify(world);

  t.mock.method(Response.prototype,'arrayBuffer',()=>{
    throw new Error('whole compressed ArrayBuffer allocated');
  });

  const result=await encodeWorldSnapshotParts(world,{
    sealDue:true,
    maxCodeUnits:4096,
  });

  assert.ok(result.parts.length>1);
  assert.ok(result.parts.every(part=>part.length<=4096));
  assert.equal(await decodeSnapshot(result.parts.join('')),expected);
  assert.equal(
    result.stateSha256,
    createHash('sha256').update(expected).digest('hex'),
  );
});

test('a public projection failure cannot roll back an already committed canonical checkpoint',async t=>{
  const storage=sqliteStorage();
  t.after(()=>storage.db.close());
  const {instance}=await wake(storage);

  instance.world.clock.worldMinute=60;
  t.mock.method(console,'error',()=>{});
  instance.refreshPublicSnapshot=async()=>{
    throw new Error('injected public projection outage');
  };

  await assert.doesNotReject(instance.persist({forceSeal:true}));

  const manifest=storage.sql.exec(
    'SELECT generation,world_minute FROM world_state_manifest WHERE id=1',
  )[0];
  assert.equal(Number(manifest.world_minute),60);
  assert.equal(instance.lastPersistedWorldMinute,60);
  assert.equal(instance.committedStats.clock.worldMinute,60);

  const {instance:restarted}=await wake(storage);
  assert.equal(restarted.world.clock.worldMinute,60);
});

test('wake and health do not build the Observer projection; state builds it lazily from committed state',async t=>{
  const storage=sqliteStorage();
  t.after(()=>storage.db.close());

  const {instance}=await wake(storage);
  instance.world.clock.worldMinute=60;
  await instance.persist({forceSeal:true});

  const {instance:restarted}=await wake(storage);
  assert.equal(restarted.committedPublicSnapshot,null);
  assert.equal(restarted.committedPublicWorldMinute,null);

  const health=await restarted.fetch(
    new Request('https://example.com/world/health'),
  );
  assert.equal(health.status,200);
  assert.equal(restarted.committedPublicSnapshot,null);

  const state=await restarted.fetch(
    new Request('https://example.com/world/state'),
  );
  assert.equal(state.status,200);
  const body=await state.json();
  assert.equal(body.ok,true);
  assert.equal(body.world.clock.worldMinute,60);
  assert.ok(restarted.committedPublicSnapshot);
  assert.equal(restarted.committedPublicWorldMinute,60);
});

test('retained causal diagnostics are bounded independently of canonical object growth',async t=>{
  const storage=sqliteStorage();
  t.after(()=>storage.db.close());
  const {instance}=await wake(storage);

  instance.world.objects=Array.from({length:2000},(_,i)=>({
    id:`object:${i}`,
    kind:'artifact',
    quantity:1,
    lastPhysicalEventId:`event:${i}`,
    provenance:{eventId:`event:${i}`},
  }));
  instance.world.procedures=Array.from({length:1200},(_,i)=>({
    id:`procedure:${i}`,
    evidenceEventId:`event:${i}`,
  }));

  await instance.persist({forceSeal:true});

  assert.ok(instance.committedCausalWorld.ledger.length<=512);
  assert.ok(instance.committedCausalWorld.physicalReceipts.length<=64);
  assert.ok(instance.committedCausalWorld.objects.length<=256);
  assert.ok(instance.committedCausalWorld.procedures.length<=256);

  // Canonical truth is not truncated by the diagnostic reader.
  assert.equal(instance.world.objects.length,2000);
  assert.equal(instance.world.procedures.length,1200);
});


test('nested Citizen checkpoint fields are serialized in bounded records',async t=>{
  const memories=Array.from({length:5000},(_,i)=>({id:i,note:'evidence 🌍'.repeat(10)}));
  const citizen={id:'large-citizen',knowledge:[],memories,language:{heard:{},lexicon:{}}};
  const world={version:2,worldId:'bounded',clock:{worldMinute:42},citizens:[citizen],ledger:[],ledgerHead:'head'};
  const expected=JSON.stringify(world);
  const stringify=JSON.stringify;
  t.mock.method(JSON,'stringify',function(value,...args){
    assert.notEqual(value,citizen,'whole Citizen JSON allocated');
    assert.notEqual(value,memories,'whole private memory array allocated');
    return stringify(value,...args);
  });
  const {parts}=await encodeWorldSnapshotParts(world);
  assert.equal(await decodeSnapshot(parts.join('')),expected);
});

test('canonical wake parses streamed records without a whole-world JSON string',async t=>{
  const world={version:2,worldId:'🜁',clock:{worldMinute:42},citizens:Array.from({length:8},(_,i)=>({id:i,memories:[{note:'🌍\\"[,{}]:'.repeat(10000)}]})),ledger:[],ledgerHead:'head',runtime:{value:null,finite:1}};
  const expected=JSON.stringify(world);
  const {parts}=await encodeWorldSnapshotParts(world);
  const parse=JSON.parse;
  t.mock.method(Response.prototype,'text',()=>{throw new Error('whole-world text decoded');});
  t.mock.method(JSON,'parse',function(text,...args){
    assert.ok(text.length<expected.length/2,'whole-world JSON parsed');
    return parse(text,...args);
  });
  assert.deepEqual(await decodeWorldSnapshot(parts.join('')),world);
});

test('streamed canonical decoder rejects incomplete and malformed state',async()=>{
  for(const source of ['{"citizens":[{}]','{"clock":{},"citizens":[1,,2]}','{"clock":{}} trailing','{"citizens":[]\u00a0}']){
    await assert.rejects(decodeWorldSnapshot(source),/JSON|snapshot/);
  }
});


test('checkpoint diagnostics read the gzip footer without inflating private state',async()=>{
  const world={clock:{worldMinute:42},citizens:[{memory:'🌍'.repeat(12000)}]};
  const {parts}=await encodeWorldSnapshotParts(world);
  assert.equal(snapshotGzipSize(parts.join('')),new TextEncoder().encode(JSON.stringify(world)).byteLength);
});


test('bounded checkpoint records use native JSON serialization for small evidence objects',async t=>{
  const world={clock:{worldMinute:42},citizens:[{id:'large',memories:Array.from({length:1000},(_,i)=>({id:i,kind:'episodic',content:{entity:`object:${i}`,position:{x:i%7,y:i%13}},source:{kind:'observation'},confidence:.8,salience:.9}))}]};
  const expected=JSON.stringify(world);
  const stringify=JSON.stringify;let calls=0;
  t.mock.method(JSON,'stringify',function(...args){calls++;return stringify(...args);});
  const {parts}=await encodeWorldSnapshotParts(world);
  assert.equal(await decodeSnapshot(parts.join('')),expected);
  assert.ok(calls<2000,`private evidence processed field by field: ${calls} stringify calls`);
});
