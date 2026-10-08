import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/index.js';
import {perceiveObjects,objectConceptId} from '../world/perception.js';
import {knows} from '../world/epistemics.js';
const object=(i,position)=>({id:`attention:${i}`,quantity:1,kind:'matter',material:'stone',holderId:null,position});
test('dense object perception keeps a bounded attention budget and eventually sees every visible object',()=>{
  const world=createSovereignGenesis({realEpochMs:0}),c=world.citizens[0];
  world.objects=Array.from({length:100},(_,i)=>object(i,{...c.position}));
  for(let minute=1;minute<=4;minute++)assert.ok(perceiveObjects(world,c,minute).length<=32);
  assert.ok(world.objects.every(o=>knows(c,objectConceptId(o))));
  assert.equal(world.objects.length,100,'attention must preserve physical matter');
});
test('a large sparse scene bounds scans and does not starve a visible object at the end',()=>{
  const world=createSovereignGenesis({realEpochMs:0}),c=world.citizens[0];
  const items=Array.from({length:1000},(_,i)=>object(i,{x:10000,y:10000}));
  items.at(-1).position={...c.position};let reads=0;
  world.objects=new Proxy(items,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver);}});
  for(let minute=1;minute<=4;minute++){
    const before=reads;perceiveObjects(world,c,minute);
    assert.ok(reads-before<=256,'one sensory pass must not scan the whole historical object list');
  }
  assert.ok(knows(c,objectConceptId(items.at(-1))));
});
test('attention cursor survives serialization and adapts to appended objects',()=>{
  const world=createSovereignGenesis({realEpochMs:0}),c=world.citizens[0];
  world.objects=Array.from({length:64},(_,i)=>object(i,{...c.position}));
  perceiveObjects(world,c,1);
  const restored=JSON.parse(JSON.stringify(c));
  world.objects.push(object(64,{...c.position}));
  perceiveObjects(world,restored,2);perceiveObjects(world,restored,3);
  assert.ok(knows(restored,objectConceptId(world.objects.at(-1))));
});
