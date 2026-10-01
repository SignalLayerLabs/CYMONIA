import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as persistence from '../worker/src/persistence.js';
import {
  FREE_TIER_ROW_WRITE_BUDGET,
  ACCOUNT_RESERVE_ROW_WRITE_BUDGET,
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

test('snapshot compression never allocates a whole-world UTF-8 buffer',async t=>{
  const source=JSON.stringify({memory:'x'.repeat(65535)+'🌍'+'y'.repeat(300000)});
  const sizes=[];
  const encode=TextEncoder.prototype.encode;
  t.mock.method(TextEncoder.prototype,'encode',function(value){
    sizes.push(value.length);
    return encode.call(this,value);
  });
  const encoded=await encodeSnapshot(source);
  assert.equal(await decodeSnapshot(encoded),source);
  assert.ok(sizes.length>1);
  assert.ok(Math.max(...sizes)<=65536,`unbounded encoding: ${Math.max(...sizes)}`);
});

test('world checkpoints stream JSON records and retain the exact canonical SHA-256 seal',async t=>{
  const world={version:2,clock:{worldMinute:128566},citizens:Array.from({length:4},(_,i)=>({id:i,memories:'🌍'.repeat(40000)})),ledger:[],optional:undefined};
  const expected=JSON.stringify(world);
  const stringify=JSON.stringify;
  t.mock.method(JSON,'stringify',function(value,...args){
    assert.notEqual(value,world,'whole-world JSON must not be allocated');
    return stringify(value,...args);
  });
  const result=await persistence.encodeWorldSnapshot(world,{sealDue:true});
  assert.equal(await decodeSnapshot(result.encoded),expected);
  assert.equal(result.stateSha256,createHash('sha256').update(expected).digest('hex'));
});

test('Cloudflare seals stream the exact JSON bytes into SHA-256 in bounded chunks',async t=>{
  const sizes=[];
  class DigestStream extends WritableStream {
    constructor(){
      const hash=createHash('sha256');
      let resolve;
      const digest=new Promise(r=>{resolve=r;});
      super({write(chunk){sizes.push(chunk.byteLength);hash.update(chunk);},close(){resolve(hash.digest());}});
      this.digest=digest;
    }
  }
  const descriptor=Object.getOwnPropertyDescriptor(crypto,'DigestStream');
  Object.defineProperty(crypto,'DigestStream',{configurable:true,value:DigestStream});
  t.after(()=>{if(descriptor)Object.defineProperty(crypto,'DigestStream',descriptor);else delete crypto.DigestStream;});
  const source='x'.repeat(65535)+'🌍'+'z'.repeat(300000);
  assert.equal(await persistence.sha256Snapshot(source),createHash('sha256').update(source).digest('hex'));
  const world={clock:{worldMinute:42},citizens:[{memories:[source]}],ledger:[],runtime:{phase:'test'}};
  const expected=JSON.stringify(world);
  const result=await persistence.encodeWorldSnapshot(world,{sealDue:true});
  assert.equal(await decodeSnapshot(result.encoded),expected);
  assert.equal(result.stateSha256,createHash('sha256').update(expected).digest('hex'));
  assert.ok(sizes.length>1);
  assert.ok(Math.max(...sizes)<=3*65536);
});

test('snapshot write estimate counts only rows actually mutated',()=>{
  assert.equal(estimateSnapshotRowWrites({chunkCount:4,sealDue:false}),8); // chunks + manifest + slot metadata + clock guard + budget
  assert.equal(estimateSnapshotRowWrites({chunkCount:4,sealDue:true}),9);  // plus seal row
  assert.equal(estimateSnapshotRowWrites({chunkCount:4,sealDue:true,sealPruneRows:1}),10);
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

test('write budget leaves deliberate account headroom below Cloudflare free-tier ceiling',()=>{
  assert.equal(FREE_TIER_ROW_WRITE_BUDGET,100_000);
  assert.equal(ACCOUNT_RESERVE_ROW_WRITE_BUDGET,40_000);
  assert.equal(SAFE_ROW_WRITE_BUDGET,40_000);
  assert.equal(EMERGENCY_ROW_WRITE_BUDGET,60_000);
  assert.ok(SAFE_ROW_WRITE_BUDGET<EMERGENCY_ROW_WRITE_BUDGET);
  assert.ok(EMERGENCY_ROW_WRITE_BUDGET<=FREE_TIER_ROW_WRITE_BUDGET-ACCOUNT_RESERVE_ROW_WRITE_BUDGET);
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

test('expected 24h production envelope fits without persistence deferral',()=>{
  const result=simulateDay({checkpointEverySeconds:60,cognitionPersists:200,chunkCount:8,sealEveryCheckpoints:60,alarmEverySeconds:60});
  assert.equal(result.alarmRowsWritten,1_440);
  assert.equal(result.heartbeatDiagnosticRowsWritten,1_440);
  assert.ok(result.rowsWritten<=SAFE_ROW_WRITE_BUDGET,result);
  assert.ok(result.totalRowsWritten<SAFE_ROW_WRITE_BUDGET,result);
  assert.equal(result.deferredPersists,0,result);
});

test('stress envelope is throttled while preserving free-tier account headroom',()=>{
  const result=simulateDay({checkpointEverySeconds:60,cognitionPersists:200,chunkCount:64,sealEveryCheckpoints:1,alarmEverySeconds:60});
  assert.ok(result.rowsWritten<=SAFE_ROW_WRITE_BUDGET,result);
  assert.equal(result.alarmRowsWritten,1_440);
  assert.equal(result.heartbeatDiagnosticRowsWritten,1_440);
  assert.ok(result.totalRowsWritten<=FREE_TIER_ROW_WRITE_BUDGET-ACCOUNT_RESERVE_ROW_WRITE_BUDGET,result);
  assert.ok(result.freeTierHeadroom>=ACCOUNT_RESERVE_ROW_WRITE_BUDGET,result);
  assert.ok(result.acceptedPersists>0,result);
  assert.ok(result.deferredPersists>0,result);
});
