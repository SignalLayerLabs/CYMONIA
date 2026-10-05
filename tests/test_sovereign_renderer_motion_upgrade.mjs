import test from 'node:test';
import assert from 'node:assert/strict';
import {worldMinute,citizenPosition} from '../site/sovereign-renderer.js';
const state={clock:{worldMinute:10,realEpochMs:0}};
const mover={position:{x:0,y:0},currentAction:{type:'MOVE',startedWorldMinute:10,endsWorldMinute:20,fromPosition:{x:0,y:0},targetPosition:{x:10,y:0}}};
test('render time remains the confirmed canonical minute',()=>{
  assert.equal(worldMinute(state,10550),10);
  assert.equal(worldMinute(state,400000000),10);
});
test('MOVE waits for confirmed position updates instead of completing from wall time',()=>{
  assert.deepEqual(citizenPosition(mover,state,25000),{x:0,y:0});
  assert.deepEqual(citizenPosition({...mover,position:{x:5,y:0}},state,25000),{x:5,y:0});
});
test('citizen without canonical MOVE does not visually wander',()=>{
  const idle={position:{x:4,y:7},currentAction:{type:'OBSERVE',startedWorldMinute:1,endsWorldMinute:100}};
  assert.deepEqual(citizenPosition(idle,state,999999),{x:4,y:7});
});
