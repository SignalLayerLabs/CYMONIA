import test from 'node:test';
import assert from 'node:assert/strict';
import {resourceConceptId,structureConceptId,objectConceptId,perceiveObjects} from '../world/perception.js';
import {stableId} from '../world/rng.js';
import {createSovereignGenesis} from '../world/index.js';
import {forget,knows} from '../world/epistemics.js';

test('concept IDs retain their namespace and track changed entity IDs',()=>{
  const entity={id:'physical:one'};
  for(const [derive,prefix] of [[resourceConceptId,'k'],[structureConceptId,'kstruct'],[objectConceptId,'kobject']]){
    for(let i=0;i<3;i++)assert.equal(derive(entity),stableId(prefix,entity.id));
    entity.id='physical:two';
    assert.equal(derive(entity),stableId(prefix,entity.id));
    entity.id='physical:one';
  }
});
test('cached concept identity still relearns forgotten knowledge about a known object',()=>{
  const world=createSovereignGenesis({realEpochMs:0}),citizen=world.citizens[0];
  const object={id:'loose:test',quantity:1,kind:'matter',material:'stone',position:{...citizen.position}};
  world.objects=[object];
  const concept=objectConceptId(object);
  assert.deepEqual(perceiveObjects(world,citizen,1),[concept]);
  assert.equal(knows(citizen,concept),true);
  forget(citizen,concept);
  assert.ok(citizen.knownEntityIds.includes(object.id));
  assert.deepEqual(perceiveObjects(world,citizen,2),[concept]);
  assert.equal(knows(citizen,concept),true);
  const knowledge=citizen.knowledge.findLast(k=>k.concept===concept);
  assert.equal(knowledge.provenance.at(-1).evidence.entityId,object.id);
});
