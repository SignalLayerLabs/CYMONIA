import test from 'node:test';
import assert from 'node:assert/strict';
import {CompactStringIndex} from '../world/compact-string-index.js';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';
import {forget,knowledgeEntry,knowsEntity} from '../world/epistemics.js';

test('compact lookup preserves exact collision, deletion, append and non-string Map semantics',()=>{
  const entries=[];const index=new CompactStringIndex(entries);
  const expected=new Map();
  for(let i=0;i<12000;i++){const key=`entity:${i%9000}`;entries.push(key);index.set(key,i);expected.set(key,i);}
  for(const [key,value] of expected)assert.equal(index.get(key),value);
  for(let i=0;i<9000;i+=3){assert.equal(index.delete(`entity:${i}`),true);expected.delete(`entity:${i}`);}
  for(let i=0;i<9000;i++){assert.equal(index.has(`entity:${i}`),expected.has(`entity:${i}`));assert.equal(index.get(`entity:${i}`),expected.get(`entity:${i}`));}
  const object={};for(const key of [null,undefined,false,0,NaN,object]){entries.push(key);index.set(key,entries.length-1);assert.equal(index.get(key),entries.length-1);}
  assert.equal(index.has({}),false);assert.equal(index.delete('absent'),false);
  assert.ok(index.table.byteLength<=entries.length*16,'lookup must use a compact numeric directory');
});

test('compact archive lookup retains the first active duplicate through changes and cold recovery',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());const {instance}=await wake(storage);const c=instance.world.citizens[0];
  const entry=(concept,eventId)=>({concept,active:true,confidence:.8,provenance:[{kind:'observation',eventId}]});
  c.knowledge=[entry('duplicate','source:a'),entry('duplicate','source:b'),entry('unrelated','source:c')];
  await instance.persist({forceSeal:true});let r=(await wake(storage)).instance.world.citizens[0];
  assert.equal(knowledgeEntry(r,'duplicate').provenance[0].eventId,'source:a');
  forget(r,'duplicate');assert.equal(knowledgeEntry(r,'duplicate').provenance[0].eventId,'source:b');
  r.knowledge[1].concept='changed';assert.equal(knowledgeEntry(r,'duplicate'),null);assert.equal(knowledgeEntry(r,'changed').provenance[0].eventId,'source:b');
  assert.equal(knowledgeEntry(r,'unrelated').provenance[0].eventId,'source:c');
});

test('compact entity membership stays private and indexes append and replacement without granting unknown IDs',()=>{
  const a={knownEntityIds:Array.from({length:12000},(_,i)=>`entity:${i}`)},b={knownEntityIds:['entity:5']};
  assert.equal(knowsEntity(a,'entity:11999'),true);assert.equal(knowsEntity(a,'entity:12000'),false);
  a.knownEntityIds.push('entity:12000');assert.equal(knowsEntity(a,'entity:12000'),true);assert.equal(knowsEntity(b,'entity:12000'),false);
  a.knownEntityIds=['entity:other'];assert.equal(knowsEntity(a,'entity:5'),false);assert.equal(knowsEntity(a,'entity:other'),true);
  a.knownEntityIds.length=0;assert.equal(knowsEntity(a,'entity:other'),false);
});
