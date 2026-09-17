import test from 'node:test';
import assert from 'node:assert/strict';
import {appendEvent,verifyLedger,compactLedger} from '../world/ledger.js';

function world(){return {worldId:'w',clock:{worldMinute:0},ledger:[],ledgerHead:'GENESIS'};}

test('compaction preserves absolute sequence and hash-chain continuity',()=>{
  const w=world();
  for(let i=0;i<20;i++)appendEvent(w,'MOVE','c',{i},[],i);
  const originalHead=w.ledgerHead;
  compactLedger(w,8);
  assert.equal(w.ledger.length,8);
  assert.equal(w.ledger[0].seq,12);
  assert.equal(w.ledgerBaseSeq,12);
  assert.equal(w.ledgerBaseHash,w.ledger[0].previousHash);
  assert.equal(w.ledgerHead,originalHead);
  assert.equal(verifyLedger(w),true);
  const next=appendEvent(w,'REST','c',{},[],21);
  assert.equal(next.seq,20);
  assert.equal(next.previousHash,originalHead);
  assert.equal(verifyLedger(w),true);
});

test('compaction is idempotent and does not renumber retained events',()=>{
  const w=world();
  for(let i=0;i<9;i++)appendEvent(w,'OBSERVE','c',{i},[],i);
  compactLedger(w,4);
  const snapshot=JSON.stringify(w);
  compactLedger(w,4);
  assert.equal(JSON.stringify(w),snapshot);
});
