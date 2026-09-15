import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {advanceWorldTo} from '../world/engine.js';

const SOCIAL=new Set(['PROMISE','CLAIM','ATTACK','REPRODUCE']);

test('Citizens keep physically acting between LLM decisions without fabricating social outcomes',()=>{
  const w=createSovereignGenesis({seed:71,realEpochMs:0});
  w.cognitionQueue=[];
  for(const c of w.citizens){c.cognition.pending=false;c.body.hydration=80;c.body.calories=80;c.body.sleepPressure=20;}
  advanceWorldTo(w,120_000);
  assert.ok(w.actions.length>=100);
  assert.ok(w.citizens.some(c=>c.currentActionId));
  assert.ok(w.actions.some(a=>a.type==='MOVE'),'local deliberation must create canonical movement, not static observation only');
  assert.equal(w.actions.some(a=>SOCIAL.has(a.type)),false);
  assert.equal(w.organizations.length,0);
  assert.equal(w.claims.length,0);
});
