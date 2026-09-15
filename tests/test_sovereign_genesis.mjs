import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {worldMinuteAt} from '../world/clock.js';

test('Genesis starts with 100 epistemically minimal Citizens and no society',()=>{
  const world=createSovereignGenesis({seed:42,realEpochMs:1000});
  assert.equal(world.version,2);
  assert.equal(world.citizens.length,100);
  assert.equal(world.organizations.length,0);
  assert.equal(world.claims.length,0);
  assert.equal(world.currencySystems.length,0);
  assert.equal(world.buildings.length,0);
  assert.ok(world.objects.some(x=>x.provenance?.type==='GENESIS_ENDOWMENT'));
  assert.ok(world.reserves.observerEmbodimentKg>0);
  for(const c of world.citizens){
    assert.equal(c.kind,'GENESIS');
    assert.equal(c.selfName,null);
    assert.equal(c.knowledge.some(k=>/english|italian|government|religion|company|money/i.test(k.concept)),false);
    assert.deepEqual(new Set(c.language.primitiveSignals),new Set(['attention','danger','need','point','accept','reject']));
  }
});

test('constitutional time is one world minute per real second',()=>{
  const world=createSovereignGenesis({seed:1,realEpochMs:10_000});
  assert.equal(worldMinuteAt(world,10_000),0);
  assert.equal(worldMinuteAt(world,70_000),60);
  assert.equal(worldMinuteAt(world,3_610_000),3600);
});
