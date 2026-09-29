import test from 'node:test';
import assert from 'node:assert/strict';
import {splitSnapshot,joinSnapshot,advanceWorldBounded} from '../worker/src/index.js';
import {createSovereignGenesis} from '../world/index.js';
import {selectNewestSnapshot,assertMonotonicSnapshot} from '../worker/src/persistence.js';

test('large canonical snapshots round-trip through rows safely below Cloudflare limits',()=>{
  const payload=JSON.stringify({world:'🌍'.repeat(700_000),ledger:Array.from({length:4000},(_,i)=>({i,text:`event-${i}`}))});
  assert.ok(Buffer.byteLength(payload,'utf8')>2*1024*1024);
  const parts=splitSnapshot(payload);
  assert.ok(parts.length>2);
  assert.equal(joinSnapshot(parts),payload);
  for(const part of parts)assert.ok(Buffer.byteLength(part,'utf8')<1024*1024,`chunk too large: ${Buffer.byteLength(part,'utf8')}`);
});

test('stalled Genesis recovers without an unbounded catch-up',()=>{
  const now=Date.now(),world=createSovereignGenesis({realEpochMs:now-60_000_000});
  const result=advanceWorldBounded(world,now,360);
  assert.equal(result.recovered,true);
  assert.ok(result.skippedWorldMinutes>360);
  assert.equal(world.clock.worldMinute,1);
  assert.ok(world.citizens.some(c=>c.currentActionId));
  assert.ok(world.ledger.some(e=>e.type==='RUNTIME_LAG_REBASED'));
});

test('an evolved world rebases a long runtime outage and advances one safe minute',()=>{
  const world=createSovereignGenesis({realEpochMs:0});
  advanceWorldBounded(world,88_000,360);
  const before=world.clock.worldMinute;
  const result=advanceWorldBounded(world,40_000_000,360);
  assert.equal(result.recovered,true);
  assert.equal(world.clock.worldMinute,before+1);
  assert.ok(result.skippedWorldMinutes>360);
});


test('snapshot selection chooses the highest valid world minute',()=>{
  const base=createSovereignGenesis({realEpochMs:0}),a=structuredClone(base),b=structuredClone(base);
  a.clock.worldMinute=1200;b.clock.worldMinute=2400;
  const selected=selectNewestSnapshot([{world:a,generation:'slot-a',updatedAt:20},{world:b,generation:'slot-b',updatedAt:10}]);
  assert.equal(selected.generation,'slot-b');assert.equal(selected.world.clock.worldMinute,2400);
});

test('clock guard rejects rollback and world identity drift',()=>{
  const world=createSovereignGenesis({realEpochMs:0});world.clock.worldMinute=5000;
  assert.doesNotThrow(()=>assertMonotonicSnapshot(world,{highWaterMark:5000,worldId:world.worldId}));
  assert.throws(()=>assertMonotonicSnapshot(world,{highWaterMark:5001,worldId:world.worldId}),/clock_regression/);
  assert.throws(()=>assertMonotonicSnapshot(world,{highWaterMark:5000,worldId:'wrong'}),/identity_regression/);
});
