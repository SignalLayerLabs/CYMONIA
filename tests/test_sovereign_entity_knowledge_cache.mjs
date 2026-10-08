import test from 'node:test';
import assert from 'node:assert/strict';
import {KnowledgeArchive} from '../worker/src/knowledge-archive.js';
import {knowledgeStorage,knowledgeForEntity} from '../world/knowledge-storage.js';

function fixture(n=7400,archive=new KnowledgeArchive(null),shared=false){
  const citizen={knowledge:Array.from({length:n},(_,i)=>({concept:`fact:${i}`,active:true,confidence:.7,
    provenance:[{kind:'observation',evidence:{entityId:shared?'shared':`object:${i%100}`}}]}))};
  archive.attach(citizen);
  return {citizen,store:knowledgeStorage(citizen.knowledge)};
}
test('repeated inventory queries do not rescan unchanged historical knowledge',()=>{
  const {citizen,store}=fixture();let reads=0;
  store.entities=new Proxy(store.entities,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver);}});
  for(let i=0;i<100;i++)knowledgeForEntity(citizen,`object:${i}`);
  const first=reads;
  for(let pass=0;pass<5;pass++)for(let i=0;i<100;i++)knowledgeForEntity(citizen,`object:${i}`);
  assert.equal(reads,first,'candidate evaluation must reuse bounded entity matches');
});
test('entity query caching preserves append, replacement, forgetting and logical order',()=>{
  const {citizen}=fixture(20);
  const concepts=id=>knowledgeForEntity(citizen,id).map(k=>k.concept);
  assert.deepEqual(concepts('object:0'),['fact:0']);
  assert.deepEqual(concepts('new'),[]);
  citizen.knowledge.push({concept:'last',active:true,confidence:.7,provenance:[{kind:'teaching',evidence:{entityId:'new'}}]});
  assert.deepEqual(concepts('new'),['last']);
  citizen.knowledge[0].provenance[0].evidence.entityId='new';
  assert.deepEqual(concepts('object:0'),[]);
  assert.deepEqual(concepts('new'),['fact:0','last']);
  citizen.knowledge[0].active=false;
  assert.deepEqual(concepts('new'),['last']);
  citizen.knowledge[0].active=true;
  assert.deepEqual(concepts('new'),['fact:0','last']);
});
test('entity cache admission stays bounded without truncating large match sets',()=>{
  const {citizen,store}=fixture(9000,new KnowledgeArchive(null),true);
  assert.equal(knowledgeForEntity(citizen,'shared').length,9000);
  for(let i=0;i<1000;i++)assert.equal(knowledgeForEntity(citizen,`missing:${i}`).length,0);
  assert.ok(store.entityCache.size<=128);
  assert.ok(store.entityCacheIndices<=8192);
  assert.equal(knowledgeForEntity(citizen,'shared').length,9000);
});

test('cache bounds apply across Citizens and evicted matches remain complete',()=>{
  const archive=new KnowledgeArchive(null),citizens=[];
  for(let i=0;i<10;i++){
    const {citizen}=fixture(7400,archive);citizens.push(citizen);
    for(let id=0;id<100;id++)assert.equal(knowledgeForEntity(citizen,`object:${id}`).length,74);
  }
  assert.ok(archive.entityMatchIndices<=65536);
  assert.ok(archive.entityMatchCache.size<=16384);
  assert.equal(knowledgeForEntity(citizens[0],'object:0').length,74);
});

test('replacing a Citizen knowledge array releases all cached references to its old store',()=>{
  const archive=new KnowledgeArchive(null),{citizen,store}=fixture(5000,archive);
  knowledgeForEntity(citizen,'missing');knowledgeForEntity(citizen,'object:0');
  citizen.knowledge=[];archive.attach(citizen);
  assert.equal(store.entityCache.size,0);
  assert.equal(archive.entityMatchCache.size,0);
  assert.equal(archive.entityMatchIndices,0);
});
