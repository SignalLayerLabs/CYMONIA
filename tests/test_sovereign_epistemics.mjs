import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {learn,knows,validateProposalKnowledge,forget} from '../world/epistemics.js';

test('unknown concepts cannot be used by a plan',()=>{
  const w=createSovereignGenesis({seed:7,realEpochMs:0});
  const c=w.citizens[0];
  const r=validateProposalKnowledge(w,c,{concepts:['combustion-engine'],actions:[]});
  assert.equal(r.ok,false);
  assert.match(r.reason,/unknown_concept/);
});

test('provenance-backed concepts become actionable and can be forgotten',()=>{
  const w=createSovereignGenesis({seed:7,realEpochMs:0});
  const c=w.citizens[0];
  learn(c,'ridge-water',{kind:'observation',eventId:'evt:test'},0.9);
  assert.equal(knows(c,'ridge-water'),true);
  assert.equal(validateProposalKnowledge(w,c,{concepts:['ridge-water'],actions:[]}).ok,true);
  forget(c,'ridge-water');
  assert.equal(knows(c,'ridge-water'),false);
});

test('indexed knowledge preserves forgetting, duplicate order and replaced snapshots',()=>{
  const c={id:'indexed',memories:[],knowledge:[{concept:'a',active:false},{concept:'a',active:true,provenance:[]},{concept:'b',active:true,provenance:[]}]};
  assert.equal(knows(c,'a'),true);
  forget(c,'a');assert.equal(knows(c,'a'),false);
  learn(c,'a',{kind:'observation'},.8,1);assert.equal(knows(c,'a'),true);
  c.knowledge=[{concept:'replacement',active:true,provenance:[]}];
  assert.equal(knows(c,'a'),false);assert.equal(knows(c,'replacement'),true);
  c.knowledge.push({concept:'tail',active:true,provenance:[]});assert.equal(knows(c,'tail'),true);
  c.knowledge.length=0;assert.equal(knows(c,'tail'),false);
});

test('repeated mature knowledge lookups avoid rescanning private evidence',()=>{
  const c={knowledge:Array.from({length:4000},(_,i)=>({concept:`k:${i}`,active:true}))};
  let scans=0;
  c.knowledge.find=(...args)=>{scans++;return Array.prototype.find.apply(c.knowledge,args);};
  for(let i=0;i<1000;i++){assert.equal(knows(c,'k:3999'),true);assert.equal(knows(c,'missing'),false);}
  assert.ok(scans<5,`linear private evidence scans: ${scans}`);
});


test('forgetting the first duplicate still selects the next active entry before an appended duplicate',()=>{
  const first={concept:'a',active:true},second={concept:'a',active:true},last={concept:'a',active:true};
  const c={knowledge:[first,second]};
  assert.equal(knows(c,'a'),true);forget(c,'a');c.knowledge.push(last);
  forget(c,'a');assert.equal(second.active,false);assert.equal(last.active,true);
});
