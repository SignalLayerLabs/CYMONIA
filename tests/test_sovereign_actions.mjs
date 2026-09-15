import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {startAction,positionAt,completeDueActions} from '../world/actions.js';
import {killCitizen} from '../world/biology.js';

test('movement is timestamped and interpolates continuously',()=>{
  const w=createSovereignGenesis({seed:9,realEpochMs:0});
  const c=w.citizens[0];
  c.position={x:10,y:10};
  const a=startAction(w,c,{type:'MOVE',durationMinutes:20,targetPosition:{x:30,y:10},purpose:'survival:test'},0);
  assert.deepEqual(positionAt(c,a,10),{x:20,y:10});
  completeDueActions(w,20);
  assert.deepEqual(c.position,{x:30,y:10});
  assert.equal(c.currentActionId,null);
});

test('dead Citizens cannot start actions',()=>{
  const w=createSovereignGenesis({seed:9,realEpochMs:0});
  const c=w.citizens[0];
  killCitizen(w,c,'test');
  assert.throws(()=>startAction(w,c,{type:'MOVE',durationMinutes:1,targetPosition:{x:1,y:1}},0),/citizen_dead/);
});
