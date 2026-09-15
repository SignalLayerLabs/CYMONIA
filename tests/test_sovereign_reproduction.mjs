import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {conceive,advancePregnancies} from '../world/reproduction.js';

test('birth creates a new epistemically empty Citizen with inherited biology',()=>{
  const w=createSovereignGenesis({seed:31,realEpochMs:0});
  const gestating=w.citizens.find(c=>c.body.reproductiveRole==='gestating');
  const partner=w.citizens.find(c=>c.body.reproductiveRole==='non_gestating');
  const p=conceive(w,gestating,partner,0);
  const before=w.citizens.length;
  const born=advancePregnancies(w,p.dueWorldMinute);
  assert.equal(born.length,1);
  assert.equal(w.citizens.length,before+1);
  const child=born[0];
  assert.equal(child.body.ageMinutes,0);
  assert.equal(child.knowledge.length,0);
  assert.equal(child.selfName,null);
  assert.deepEqual(child.language.lexicon,{});
  assert.ok(child.genome&&Number.isFinite(child.genome.lifespanYears));
});
