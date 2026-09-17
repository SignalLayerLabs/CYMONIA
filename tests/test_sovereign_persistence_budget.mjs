import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FREE_TIER_ROW_WRITE_BUDGET,
  SAFE_ROW_WRITE_BUDGET,
  EMERGENCY_ROW_WRITE_BUDGET,
  encodeSnapshot,
  decodeSnapshot,
  estimateSnapshotRowWrites,
  createWriteBudget,
  reserveWriteBudget,
  simulateDay,
  nextSnapshotSlot,
  nextUtcDayStart,
} from '../worker/src/persistence.js';

test('gzip snapshot codec round-trips unicode JSON and compresses repetitive state',async()=>{
  const source=JSON.stringify({name:'CYMONIA 🜁',ledger:Array.from({length:4000},(_,i)=>({seq:i,type:'MOVE',payload:{x:i%17,y:i%13,note:'same-repeated-value'}}))});
  const encoded=await encodeSnapshot(source);
  assert.match(encoded,/^gzip-base64-v1:/);
  assert.equal(await decodeSnapshot(encoded),source);
  assert.ok(encoded.length<source.length*0.35,{source:source.length,encoded:encoded.length});
});

test('snapshot write estimate counts only rows actually mutated',()=>{
  assert.equal(estimateSnapshotRowWrites({chunkCount:4,sealDue:false}),6); // 4 chunks + manifest + budget row
  assert.equal(estimateSnapshotRowWrites({chunkCount:4,sealDue:true}),7);  // plus seal row
  assert.equal(estimateSnapshotRowWrites({chunkCount:4,sealDue:true,sealPruneRows:1}),8);
});

test('snapshot slots alternate without unbounded generations',()=>{
  assert.equal(nextSnapshotSlot(null),'slot-a');
  assert.equal(nextSnapshotSlot('legacy-1723'),'slot-a');
  assert.equal(nextSnapshotSlot('slot-a'),'slot-b');
  assert.equal(nextSnapshotSlot('slot-b'),'slot-a');
});


test('budget backoff resumes exactly at next UTC day',()=>{
  assert.equal(new Date(nextUtcDayStart(Date.parse('2026-09-17T23:59:59.000Z'))).toISOString(),'2026-09-18T00:00:00.000Z');
});

test('write budget is conservative below Cloudflare free-tier ceiling',()=>{
  assert.equal(FREE_TIER_ROW_WRITE_BUDGET,100_000);
  assert.ok(SAFE_ROW_WRITE_BUDGET<FREE_TIER_ROW_WRITE_BUDGET);
  assert.equal(SAFE_ROW_WRITE_BUDGET,72_000);
  assert.ok(EMERGENCY_ROW_WRITE_BUDGET<FREE_TIER_ROW_WRITE_BUDGET);
});

test('budget reservation is atomic in-memory semantics and never overspends',()=>{
  let budget=createWriteBudget('2026-09-17',SAFE_ROW_WRITE_BUDGET-5);
  let result=reserveWriteBudget(budget,5);
  assert.equal(result.allowed,true);
  budget=result.budget;
  assert.equal(budget.rowsWritten,SAFE_ROW_WRITE_BUDGET);
  result=reserveWriteBudget(budget,1);
  assert.equal(result.allowed,false);
  assert.equal(result.budget.rowsWritten,SAFE_ROW_WRITE_BUDGET);
});

test('24h simulation remains below safety budget even under large snapshots',()=>{
  const result=simulateDay({checkpointEverySeconds:60,cognitionPersists:200,chunkCount:64,sealEveryCheckpoints:1,alarmEverySeconds:10});
  assert.ok(result.rowsWritten<=SAFE_ROW_WRITE_BUDGET,result);
  assert.equal(result.alarmRowsWritten,8_640);
  assert.ok(result.totalRowsWritten<FREE_TIER_ROW_WRITE_BUDGET,result);
  assert.ok(result.acceptedPersists>0,result);
  assert.ok(result.deferredPersists>0,result);
});
