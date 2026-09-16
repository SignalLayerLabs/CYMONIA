import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {startAction,positionAt,completeDueActions} from '../world/actions.js';
import {killCitizen} from '../world/biology.js';

test('movement is timestamped, physically bounded and interpolates continuously',()=>{
  const w=createSovereignGenesis({seed:9,realEpochMs:0});
  const c=w.citizens[0];
  c.position={x:10,y:10};
  const a=startAction(w,c,{type:'MOVE',durationMinutes:20,targetPosition:{x:30,y:10},purpose:'survival:test'},0);
  assert.ok(a.endsWorldMinute>=20);
  assert.ok(a.physics?.minimumMinutes>0);
  const half=(a.startedWorldMinute+a.endsWorldMinute)/2;
  const p=positionAt(c,a,half);
  assert.ok(Math.abs(p.x-20)<1e-9);
  completeDueActions(w,a.endsWorldMinute);
  assert.deepEqual(c.position,a.targetPosition);
  assert.equal(c.currentActionId,null);
});

test('dead Citizens cannot start actions',()=>{
  const w=createSovereignGenesis({seed:9,realEpochMs:0});
  const c=w.citizens[0];
  killCitizen(w,c,'test');
  assert.throws(()=>startAction(w,c,{type:'MOVE',durationMinutes:1,targetPosition:{x:1,y:1}},0),/citizen_dead/);
});
