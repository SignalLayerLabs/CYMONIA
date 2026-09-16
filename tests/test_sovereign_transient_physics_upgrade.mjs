import test from 'node:test';
import assert from 'node:assert/strict';
import {fragmentVisualSpecs} from '../site/transient-physics.js';

test('canonical fracture event maps to deterministic observer-only debris specs',()=>{
  const event={id:'evt:abc',type:'STRUCTURE_FRACTURED',worldMinute:12,payload:{position:{x:50,y:50},fragments:[{id:'f1',massKg:3},{id:'f2',massKg:8},{id:'f3',massKg:2}]}};
  const a=fragmentVisualSpecs(event),b=fragmentVisualSpecs(structuredClone(event));
  assert.deepEqual(a,b);
  assert.equal(a.length,3);
  assert.ok(a.every(x=>x.x>=48&&x.x<=52&&x.y>=48&&x.y<=52));
  assert.ok(a.every(x=>Number.isFinite(x.vx)&&Number.isFinite(x.vy)&&x.ttlMs>0));
});
