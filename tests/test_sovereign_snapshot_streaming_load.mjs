import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {encodeSnapshot,snapshotJsonStream,decodeWorldSnapshot} from '../worker/src/persistence.js';

test('compressed snapshot decoding never materializes the entire base64 payload',async t=>{
  const value={version:2,clock:{worldMinute:42},citizens:[],payload:randomBytes(600000).toString('hex')};
  const encoded=await encodeSnapshot(JSON.stringify(value));
  const native=globalThis.atob;let largest=0;
  t.mock.method(globalThis,'atob',text=>{largest=Math.max(largest,text.length);return native(text);});
  const decoded=await new Response(snapshotJsonStream(encoded)).json();
  assert.deepEqual(decoded,value);
  assert.ok(largest<=65536,`base64 decoding allocated ${largest} code units in one call`);
});
test('snapshot decoder accepts lazy chunks split inside header and base64 quartets',async()=>{
  const value={version:2,clock:{worldMinute:91},citizens:[{id:'é🙂',knowledge:[],memories:[]}],payload:randomBytes(200000).toString('hex')};
  const encoded=await encodeSnapshot(JSON.stringify(value));
  let yielded=0;
  function* parts(){yielded++;yield encoded.slice(0,3);for(let at=3;at<encoded.length;at+=101){yielded++;yield encoded.slice(at,at+101);}}
  const stream=snapshotJsonStream(parts()),reader=stream.getReader();
  await reader.read();
  assert.ok(yielded<Math.ceil(encoded.length/101),'first output must not read the whole snapshot');
  await reader.cancel();
  assert.deepEqual(await decodeWorldSnapshot(parts()),value);
});
test('truncated compressed chunks cannot produce a valid canonical world',async()=>{
  const encoded=await encodeSnapshot(JSON.stringify({version:2,citizens:[{id:'retained'}]}));
  await assert.rejects(decodeWorldSnapshot([encoded.slice(0,-12)]));
});

test('SQLite snapshot rows are consumed lazily and missing rows remain fatal',async()=>{
  const {SovereignWorld}=await import('../worker/src/index.js');
  const instance=Object.create(SovereignWorld.prototype);
  let reads=0;
  instance.sql={exec:function*(){for(const part of ['first','second']){reads++;yield {state_part:part};}}};
  const parts=instance.storedSnapshotParts('slot-b',2);
  assert.equal(reads,0);
  assert.equal(parts.next().value,'first');
  assert.equal(reads,1);
  assert.equal(parts.next().value,'second');
  assert.equal(parts.next().done,true);
  assert.throws(()=>[...instance.storedSnapshotParts('slot-a',3)],/chunk_count_mismatch/);
});

test('canceling the public prefix stops SQLite-style iterator reads immediately',async()=>{
  const encoded=await encodeSnapshot(JSON.stringify({payload:randomBytes(500000).toString('hex')}));
  let offset=0,reads=0,returned=0;
  const parts={
    [Symbol.iterator](){return this;},
    next(){reads++;if(offset>=encoded.length)return {done:true};const value=encoded.slice(offset,offset+101);offset+=101;return {done:false,value};},
    return(){returned++;return {done:true};}
  };
  const reader=snapshotJsonStream(parts,{prefix:'prefix'}).getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value),'prefix');
  const before=reads;
  await reader.cancel('observer disconnected');
  assert.equal(returned,1,'cancellation must close the upstream iterator');
  assert.ok(reads<=before+2,`cancellation read ${reads-before} additional chunks`);
});
