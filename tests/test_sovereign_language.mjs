import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {coinSignal,communicate} from '../world/language.js';
import {learn} from '../world/epistemics.js';

test('Citizens can coin in-world symbols without human vocabulary',()=>{
  const w=createSovereignGenesis({seed:13,realEpochMs:0});
  const a=w.citizens[0],b=w.citizens[1];
  learn(a,'water-source',{kind:'observation',eventId:'evt:w'});
  const token=coinSignal(w,a,'water-source');
  assert.match(token,/^[a-z]{2,8}$/);
  assert.equal(/water|aqua|acqua/i.test(token),false);
  const result=communicate(w,a,b,{concept:'water-source',token},0);
  assert.equal(result.senderConcept,'water-source');
  assert.ok(b.language.heard[token]);
});
