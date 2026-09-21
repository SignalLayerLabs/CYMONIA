import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureNeuronBudget,
  estimateReservation,
  neuronCapacity,
  reconcileNeurons,
  reserveNeurons,
} from '../worker/src/neuron-governor.js';

const MODEL='@cf/zai-org/glm-4.7-flash';
function budget(overrides={}){return {day:'2026-09-21',usedNeurons:0,reservedNeurons:0,calls:0,promptTokens:0,completionTokens:0,lastFailureRealMs:0,lastExhaustedDay:null,lastAccountingWarning:null,...overrides};}

test('GLM token usage converts to documented neurons',()=>{
  const state=budget();
  const reservation=reserveNeurons(state,20,'normal').reservation;
  const result=reconcileNeurons(state,reservation,{prompt_tokens:1000,completion_tokens:200},MODEL);
  assert.equal(result.charged,12.78);
  assert.equal(state.promptTokens,1000);
  assert.equal(state.completionTokens,200);
  assert.equal(state.calls,1);
});

test('normal work cannot consume priority or human reserves',()=>{
  const normal=budget({usedNeurons:7999});
  assert.equal(reserveNeurons(normal,2,'normal').ok,false);
  assert.equal(reserveNeurons(normal,2,'priority').ok,true);
  const priority=budget({usedNeurons:8999});
  assert.equal(reserveNeurons(priority,2,'priority').ok,false);
  assert.equal(reserveNeurons(priority,2,'emergency').ok,true);
});

test('missing usage charges reservation and unknown model fails closed',()=>{
  const state=budget();
  const held=reserveNeurons(state,25,'normal').reservation;
  assert.equal(reconcileNeurons(state,held,null,MODEL).charged,25);
  assert.equal(state.lastAccountingWarning,'usage_missing_charged_reservation');
  assert.equal(estimateReservation('@cf/unknown/model','{}',200),Infinity);
});

test('budget resets on the UTC day boundary and migrates legacy runtime state',()=>{
  const world={runtime:{aiBudget:{day:'2026-09-20',calls:99,lastFailureRealMs:7}}};
  const state=ensureNeuronBudget(world,Date.parse('2026-09-21T00:00:01Z'));
  assert.equal(state.day,'2026-09-21');
  assert.equal(state.usedNeurons,0);
  assert.equal(state.calls,0);
  assert.equal(world.runtime.aiBudget,undefined);
});

test('malformed or negative usage charges the reservation',()=>{
  for(const usage of [{prompt_tokens:-1,completion_tokens:2},{prompt_tokens:'bad',completion_tokens:2},{completion_tokens:2}]){
    const state=budget(),held=reserveNeurons(state,9,'normal').reservation;
    assert.equal(reconcileNeurons(state,held,usage,MODEL).charged,9);
  }
});

test('fractional nested usage is normalized conservatively',()=>{
  const state=budget(),held=reserveNeurons(state,20,'normal').reservation;
  const result=reconcileNeurons(state,held,{result:{usage:{prompt_tokens:1.2,completion_tokens:2.1}}},MODEL);
  assert.equal(state.promptTokens,2);
  assert.equal(state.completionTokens,3);
  assert.equal(result.charged,.1202);
});

test('hard stop and existing reservations participate in admission',()=>{
  assert.equal(reserveNeurons(budget({usedNeurons:9499}),2,'emergency').ok,false);
  assert.equal(reserveNeurons(budget({reservedNeurons:7999}),2,'normal').ok,false);
  assert.equal(neuronCapacity(budget({usedNeurons:9499.5}),'emergency'),.5);
});

test('actual usage above reservation remains fully accounted and cannot reconcile twice',()=>{
  const state=budget(),held=reserveNeurons(state,1,'normal').reservation;
  const first=reconcileNeurons(state,held,{prompt_tokens:1000,completion_tokens:200},MODEL);
  const second=reconcileNeurons(state,held,{prompt_tokens:1000,completion_tokens:200},MODEL);
  assert.equal(first.charged,12.78);
  assert.equal(state.usedNeurons,12.78);
  assert.equal(state.reservedNeurons,0);
  assert.equal(second.charged,0);
  assert.equal(second.warning,'reservation_already_reconciled');
});

test('reservation estimate uses conservative prompt length and full completion cap',()=>{
  const estimated=estimateReservation(MODEL,'1234567',200);
  assert.equal(estimated,7.2965);
});
