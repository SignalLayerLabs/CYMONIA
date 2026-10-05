import test from 'node:test';
import assert from 'node:assert/strict';
import {worldMinute,citizenPosition} from '../site/observer-motion.js';
import {ObserverConnection,CONNECTION} from '../site/observer-connection.js';

test('calendar and action progress use the same confirmed minute after an outage',()=>{
  const state={clock:{worldMinute:100,realEpochMs:0}};
  assert.equal(worldMinute(state,1000000),100);
  const mover={position:{x:2,y:0},currentAction:{type:'MOVE',startedWorldMinute:98,endsWorldMinute:108,fromPosition:{x:0,y:0},targetPosition:{x:10,y:0}}};
  assert.deepEqual(citizenPosition(mover,state,1000000),mover.position);
});
test('HTTP success with an unchanged clock stops claiming a live advancing world',async()=>{
  let now=0,minute=100;
  const timers=[];
  const connection=new ObserverConnection({fetchState:async()=>({version:2,worldId:'existing',clock:{worldMinute:minute}}),nowFn:()=>now,setTimeoutFn:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimeoutFn:()=>{}});
  await connection.start();
  assert.equal(connection.mode,CONNECTION.LIVE);
  now=121000;await connection.refreshNow({poll:true});
  assert.equal(connection.mode,CONNECTION.DEGRADED);
  minute++;await connection.refreshNow({poll:true});
  assert.equal(connection.mode,CONNECTION.LIVE);
  connection.stop();
});
