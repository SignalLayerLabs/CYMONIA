import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {learn} from '../world/epistemics.js';
import {adoptBelief,shareBelief} from '../world/beliefs.js';
import {coinSignal,communicate} from '../world/language.js';
import {validateCognitiveProposal} from '../world/cognition.js';

test('Citizens can hold and transmit unverified beliefs without kernel truth enforcement',()=>{
  const w=createSovereignGenesis({seed:61,realEpochMs:0}),a=w.citizens[0],b=w.citizens[1];
  learn(a,'k:x',{kind:'observation',evidence:{opaque:true}},.8,0);
  const belief=adoptBelief(w,a,{stanceCode:'sacred',conceptIds:['k:x'],confidence:.72},{kind:'reflection'},0);
  assert.equal(belief.truthStatus,'unverified');
  const received=shareBelief(w,a,b,belief.id,1);
  assert.ok(received);
  assert.equal(b.beliefs.length,1);
  assert.equal(b.beliefs[0].source.kind,'communication');
});

test('belief updates in cognitive plans cannot cite unknown concepts',()=>{
  const w=createSovereignGenesis({seed:62,realEpochMs:0}),c=w.citizens[0];
  const result=validateCognitiveProposal(w,c,{concepts:[],beliefUpdates:[{stanceCode:'supports',conceptIds:['k:earth-secret'],confidence:.8}],actions:[]});
  assert.equal(result.ok,false);
});

test('multi-concept communication can grow an emergent grammar pattern',()=>{
  const w=createSovereignGenesis({seed:63,realEpochMs:0}),a=w.citizens[0],b=w.citizens[1];
  for(const k of ['k:a','k:b'])learn(a,k,{kind:'observation',evidence:{}},1,0);
  const tokens=['k:a','k:b'].map(k=>coinSignal(w,a,k,0));
  for(let i=0;i<3;i++)communicate(w,a,b,{concepts:['k:a','k:b'],tokens},i);
  assert.ok(Object.keys(b.language.grammarPatterns).length>0);
  assert.ok(b.language.lexicon['k:a']);
  assert.ok(b.language.lexicon['k:b']);
});
