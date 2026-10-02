import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {objectConceptId,perceiveObjects} from '../world/perception.js';
import * as epistemics from '../world/epistemics.js';

test('repeated perception of known objects does not rescan every known entity',()=>{
  const world=createSovereignGenesis({realEpochMs:0});
  const citizen=world.citizens[0];
  citizen.position={x:50,y:50};
  world.objects=Array.from({length:500},(_,i)=>({id:`o:${i}`,kind:'artifact',material:'stone',quantity:1,holderId:null,position:{x:50,y:50}}));
  citizen.knowledge=world.objects.map(object=>({concept:objectConceptId(object),active:true,provenance:[]}));
  const ids=[...Array.from({length:1000},(_,i)=>`old:${i}`),...world.objects.map(o=>o.id)];
  let reads=0;
  citizen.knownEntityIds=new Proxy(ids,{get(target,key,receiver){
    if(typeof key==='string'&&/^\d+$/.test(key))reads++;
    return Reflect.get(target,key,receiver);
  }});
  for(let at=1;at<=3;at++)assert.deepEqual(perceiveObjects(world,citizen,at),[]);
  assert.equal(citizen.knowledge.length,500);
  assert.ok(reads<=ids.length+10,`quadratic known-entity reads: ${reads}`);
});

test('known-entity index handles appended IDs, replaced arrays and truncation',()=>{
  const citizen={knownEntityIds:['a']};
  assert.equal(epistemics.knowsEntity(citizen,'a'),true);
  assert.equal(epistemics.knowsEntity(citizen,'b'),false);
  citizen.knownEntityIds.push('b');
  assert.equal(epistemics.knowsEntity(citizen,'b'),true);
  citizen.knownEntityIds=['replacement'];
  assert.equal(epistemics.knowsEntity(citizen,'a'),false);
  assert.equal(epistemics.knowsEntity(citizen,'replacement'),true);
  citizen.knownEntityIds.length=0;
  assert.equal(epistemics.knowsEntity(citizen,'replacement'),false);
});
