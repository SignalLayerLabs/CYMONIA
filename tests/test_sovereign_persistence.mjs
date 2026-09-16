import test from 'node:test';
import assert from 'node:assert/strict';
import {splitSnapshot,joinSnapshot} from '../worker/src/index.js';

test('large canonical snapshots round-trip through rows safely below Cloudflare limits',()=>{
  const payload=JSON.stringify({world:'🌍'.repeat(700_000),ledger:Array.from({length:4000},(_,i)=>({i,text:`event-${i}`}))});
  assert.ok(Buffer.byteLength(payload,'utf8')>2*1024*1024);
  const parts=splitSnapshot(payload);
  assert.ok(parts.length>2);
  assert.equal(joinSnapshot(parts),payload);
  for(const part of parts)assert.ok(Buffer.byteLength(part,'utf8')<1024*1024,`chunk too large: ${Buffer.byteLength(part,'utf8')}`);
});
