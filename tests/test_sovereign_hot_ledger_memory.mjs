import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';
import {verifyLedger,appendEvent} from '../world/ledger.js';

test('a dense discovery burst bounds the live ledger before a checkpoint is due',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);
  for(const c of instance.world.citizens)c.position={x:50,y:50};
  for(let i=0;i<80;i++)instance.world.objects.push({id:`cover:${i}`,kind:'temporary_shelter',material:'fiber',quantity:1,massPerUnitKg:1,condition:1,position:{x:50,y:50}});
  instance.world.clock.realEpochMs=Date.now()-90000;
  let yields=0;
  instance.yieldRuntime=async()=>{
    yields++;
    assert.ok(instance.world.ledger.length<=4096,'ledger must be bounded before each yield');
    assert.ok(verifyLedger(instance.world));
  };
  await instance.tick(120,360,{maxSegments:3,deferCheckpoint:true});
  assert.equal(instance.lastPersistedWorldMinute,0,'must exercise the interval between saved checkpoints');
  assert.ok(instance.world.ledger.length<=4096,`unbounded live ledger: ${instance.world.ledger.length}`);
  assert.ok(instance.world.ledgerBaseSeq>0,'discovery events must actually have exceeded the hot window');
  assert.ok(verifyLedger(instance.world));
  assert.ok(instance.world.citizens.every(c=>c.knowledge.length>0),'compaction cannot discard learned knowledge');
  assert.ok(yields>=2,'exercise multiple simulation boundaries');
  const head=instance.world.ledgerHead,lastSeq=instance.world.ledger.at(-1).seq;
  await instance.persist({forceSeal:true});
  const {instance:reloaded}=await wake(storage);
  assert.equal(reloaded.world.ledgerHead,head);
  const event=appendEvent(reloaded.world,'OBSERVATION','world');
  assert.equal(event.seq,lastSeq+1);assert.equal(event.previousHash,head);
  assert.ok(verifyLedger(reloaded.world));
});
