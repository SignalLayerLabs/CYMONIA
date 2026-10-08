import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';

test('gzip Observer transport preserves the same complete canonical response as plain JSON',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);
  const gzip=await instance.fetch(new Request('https://internal/world/state',{headers:{'accept-encoding':'gzip, br'}}));
  assert.equal(gzip.headers.get('content-encoding'),'gzip');
  assert.match(gzip.headers.get('vary'),/accept-encoding/i);
  const decoded=await new Response(gzip.body.pipeThrough(new DecompressionStream('gzip'))).json();
  const plain=await instance.fetch(new Request('https://internal/world/state',{headers:{'accept-encoding':'identity'}}));
  assert.equal(plain.headers.get('content-encoding'),null);
  assert.deepEqual(await plain.json(),decoded);
  assert.equal(decoded.ok,true);assert.equal(decoded.world.worldId,instance.world.worldId);
  assert.equal(decoded.world.citizens.length,instance.world.citizens.length);
});
test('an Observer rejecting gzip still receives ordinary JSON',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage);
  const r=await instance.fetch(new Request('https://internal/world/state',{headers:{'accept-encoding':'gzip;q=0, identity'}}));
  assert.equal(r.headers.get('content-encoding'),null);
  assert.equal((await r.json()).ok,true);
});
