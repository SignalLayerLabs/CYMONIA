import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {transformMaterials,totalTrackedMass} from '../world/materials.js';

test('generic transformations conserve tracked mass',()=>{
  const w=createSovereignGenesis({seed:33,realEpochMs:0});
  const c=w.citizens[0];
  const o=w.objects.find(x=>x.material==='timber');o.holderId=c.id;
  const before=totalTrackedMass(w);
  const result=transformMaterials(w,c,{inputObjectIds:[o.id],consume:[{objectId:o.id,quantity:10}],output:{material:'timber',quantity:10,massPerUnitKg:1,kind:'shaped_material'},process:'shape'},0);
  assert.equal(result.provenance.type,'TRANSFORMATION');
  assert.equal(totalTrackedMass(w),before);
  assert.ok(c.knownEntityIds.includes(result.id));
  assert.ok(c.possessions.includes(result.id));
});
