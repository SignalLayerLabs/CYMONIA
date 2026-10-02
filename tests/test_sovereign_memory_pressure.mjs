import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createSovereignGenesis,publicWorld} from '../world/index.js';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';

function inflateCitizen(c,count=5000){
  c.knowledge=Array.from({length:count},(_,i)=>({
    concept:`memory-pressure:${i}`,
    confidence:.9,
    active:true,
    provenance:[{kind:'observation',eventId:`event:${i}`}],
  }));
  c.language.lexicon=Object.fromEntries(
    Array.from({length:count},(_,i)=>[`memory-pressure:${i}`,`sig${i}`])
  );
  c.knownEntityIds=Array.from({length:count},(_,i)=>`entity:${i}`);
  c.possessions=Array.from({length:count},(_,i)=>`object:${i}`);
  c.relationships=Object.fromEntries(
    Array.from({length:256},(_,i)=>[`citizen:${i}`,{
      trust:(i%10)/10,
      affection:((i+3)%10)/10,
      fear:((i+7)%10)/10,
      familiarity:.5,
    }])
  );
}

test('Observer projection stays bounded while canonical knowledge keeps growing',()=>{
  const world=createSovereignGenesis({seed:20261001,realEpochMs:0});
  const citizen=world.citizens[0];
  inflateCitizen(citizen);

  const view=publicWorld(world,0);
  const publicCitizen=view.citizens[0];

  assert.equal(citizen.knowledge.length,5000);
  assert.equal(publicCitizen.knowledge.count,5000);
  assert.equal(publicCitizen.knowledge.items.length,28);

  assert.equal(publicCitizen.language.lexiconCount,5000);
  assert.ok(Object.keys(publicCitizen.language.lexicon).length<=32);

  assert.equal(publicCitizen.knownEntityCount,5000);
  assert.ok(publicCitizen.knownEntityIds.length<=64);

  assert.equal(publicCitizen.possessionCount,5000);
  assert.ok(publicCitizen.possessions.length<=64);

  assert.equal(publicCitizen.relationshipCount,256);
  assert.ok(Object.keys(publicCitizen.relationships).length<=32);

  // Growth in private cognition must not make one Citizen's public payload unbounded.
  assert.ok(JSON.stringify(publicCitizen).length<100_000);
  assert.equal(citizen.knowledge.at(-1).concept,'memory-pressure:4999');
});

test('Durable Object retains one full canonical graph and keeps public/diagnostic readers bounded',async t=>{
  const storage=sqliteStorage();
  t.after(()=>storage.db.close());
  const {instance}=await wake(storage);

  inflateCitizen(instance.world.citizens[0],1200);
  await instance.persist({forceSeal:true});

  assert.equal(instance.committedWorld,null);
  assert.equal(instance.committedSnapshot,null);
  assert.ok(instance.committedPublicSnapshot);
  assert.ok(instance.committedStats);
  assert.equal(instance.committedStats.citizens,undefined);
  assert.ok(instance.committedCausalWorld.ledger.length<=512);
  assert.ok(instance.committedCausalWorld.physicalReceipts.length<=64);
  assert.ok(instance.committedCausalWorld.objects.length<=256);
  assert.ok(instance.committedCausalWorld.procedures.length<=256);

  const canonicalCount=instance.world.citizens[0].knowledge.length;
  assert.equal(canonicalCount,1200);

  const {instance:restarted}=await wake(storage);
  assert.equal(restarted.world.citizens[0].knowledge.length,canonicalCount);
  assert.equal(restarted.committedWorld,null);
  assert.equal(restarted.committedSnapshot,null);
});

test('checkpoint writes inactive chunks outside the metadata transaction',async t=>{
  const storage=sqliteStorage();
  t.after(()=>storage.db.close());
  const {instance}=await wake(storage);
  const originalExec=storage.sql.exec;
  const originalTransaction=storage.transactionSync;
  let insideTransaction=false,chunkWrites=0,manifestWrites=0;
  storage.sql.exec=function(query,...args){
    if(query.includes('INSERT INTO world_state_chunks_v2')){
      chunkWrites++;
      assert.equal(insideTransaction,false,'large chunks must be staged individually');
    }
    if(query.includes('INSERT INTO world_state_manifest')){
      manifestWrites++;
      assert.equal(insideTransaction,true,'manifest must commit atomically with the clock guard');
    }
    return originalExec.call(this,query,...args);
  };
  storage.transactionSync=function(callback){
    return originalTransaction.call(this,()=>{
      insideTransaction=true;
      try{return callback();}finally{insideTransaction=false;}
    });
  };
  instance.world.clock.worldMinute++;
  await instance.persist({forceSeal:true});
  assert.ok(chunkWrites>0);
  assert.equal(manifestWrites,1);
});

test('an interrupted staged snapshot cannot replace the committed world',async t=>{
  const storage=sqliteStorage();
  t.after(()=>storage.db.close());
  const {instance}=await wake(storage);
  const originalExec=storage.sql.exec;
  const committedMinute=instance.world.clock.worldMinute;
  instance.world.clock.worldMinute++;
  instance.world.privateCheckpointStress=randomBytes(2_000_000).toString('base64');
  let staged=0;
  storage.sql.exec=function(query,...args){
    if(query.includes('INSERT INTO world_state_chunks_v2')&&++staged===2){
      throw new Error('interrupted_before_manifest');
    }
    return originalExec.call(this,query,...args);
  };
  await assert.rejects(instance.persist({forceSeal:true}),/interrupted_before_manifest/);
  assert.equal(staged,2,'failure must occur after the first chunk was staged');
  storage.sql.exec=originalExec;
  const {instance:restarted}=await wake(storage);
  assert.equal(restarted.world.clock.worldMinute,committedMinute);
  assert.equal(restarted.world.privateCheckpointStress,undefined);
  assert.equal(restarted.clockHighWaterMark,committedMinute);
});
