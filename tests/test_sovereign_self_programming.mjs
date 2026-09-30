import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {createCitizenProgram,programProposal,sanitizeProgramSpec,ensurePrograms} from '../world/programming.js';

test('citizens can persist executable in-world programs without arbitrary JavaScript',()=>{
  const world=createSovereignGenesis({seed:401,realEpochMs:0}),c=world.citizens[0];
  c.body.sleepPressure=95;
  const raw={name:'sleep-loop',trigger:{kind:'high_sleep',threshold:.5},cooldownMinutes:60,steps:[{type:'REST',selector:'self',javascript:'while(true){}'}],javascript:'evil()'};
  const clean=sanitizeProgramSpec(raw);
  assert.equal('javascript' in clean,false);
  assert.equal('javascript' in clean.steps[0],false);
  const p=createCitizenProgram(world,c,raw,0,'test');
  assert.ok(p.id);
  const proposal=programProposal(world,c,100);
  assert.ok(proposal);
  assert.equal(proposal.source,'self-program');
  assert.equal(proposal.actions[0].type,'REST');
});

test('program surface is bounded to supported triggers, selectors, and actions',()=>{
  const clean=sanitizeProgramSpec({trigger:{kind:'shell'},steps:[{type:'EXEC',selector:'filesystem'},{type:'DESTROY',selector:'grievance_actor'}]});
  assert.equal(clean.trigger.kind,'always');
  assert.equal(clean.steps[0].type,'OBSERVE');
  assert.equal(clean.steps[0].selector,'self');
  assert.equal(clean.steps[1].type,'DESTROY');
  assert.equal(clean.steps[1].selector,'grievance_actor');
});

test('program storage is bounded per citizen',()=>{
  const world=createSovereignGenesis({seed:403,realEpochMs:0}),c=world.citizens[0];
  for(let i=0;i<30;i++)createCitizenProgram(world,c,{name:`p${i}`,trigger:{kind:'always'},cooldownMinutes:60,steps:[{type:'OBSERVE',selector:'self'}]},i,'test');
  assert.ok(ensurePrograms(c).length<=16);
});
