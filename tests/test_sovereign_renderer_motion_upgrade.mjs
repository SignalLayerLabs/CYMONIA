import test from 'node:test';
import assert from 'node:assert/strict';
import {worldMinute,citizenPosition} from '../site/sovereign-renderer.js';

const state={clock:{worldMinute:10,realEpochMs:0}};
const mover={position:{x:0,y:0},currentAction:{type:'MOVE',startedWorldMinute:10,endsWorldMinute:20,fromPosition:{x:0,y:0},targetPosition:{x:10,y:0}}};

test('render world minute is fractional',()=>{
  assert.equal(worldMinute(state,10550),10.55);
});

test('MOVE visibly progresses within less than one real second',()=>{
  const a=citizenPosition(mover,state,10200);
  const b=citizenPosition(mover,state,10800);
  assert.ok(b.x>a.x);
  assert.ok(b.x-a.x>0 && b.x-a.x<1);
});

test('MOVE clamps exactly to destination',()=>{
  assert.deepEqual(citizenPosition(mover,state,25000),{x:10,y:0});
});

test('citizen without canonical MOVE does not visually wander',()=>{
  const idle={position:{x:4,y:7},currentAction:{type:'OBSERVE',startedWorldMinute:1,endsWorldMinute:100}};
  assert.deepEqual(citizenPosition(idle,state,999999),{x:4,y:7});
});
