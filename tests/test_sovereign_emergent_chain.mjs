import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {advanceWorldTo} from '../world/engine.js';

function runEmergence(){
  const world=createSovereignGenesis({seed:20260921,realEpochMs:0});
  const [first,second]=world.citizens;
  world.citizens=[first,second];
  world.cognitionQueue=[];
  world.objects=[];
  world.resourceDeposits=world.resourceDeposits.filter(deposit=>['timber','clay'].includes(deposit.type));
  const timber=world.resourceDeposits.find(deposit=>deposit.type==='timber');
  const clay=world.resourceDeposits.find(deposit=>deposit.type==='clay');
  timber.position={x:50,y:50};clay.position={x:51.5,y:50};
  for(const [index,citizen] of world.citizens.entries()){
    citizen.position={x:50+index*1.5,y:50};
    citizen.activeGoal=null;
    citizen.plans=[];
    citizen.currentActionId=null;
    citizen.possessions=[];
    citizen.knownEntityIds=[citizen.id];
    citizen.knowledge=[];
    citizen.memories=[];
    citizen.relationships={};
    Object.assign(citizen.psychology,{curiosity:1,noveltySeeking:1,socialDrive:1,riskTolerance:.9,empathy:.9,stress:0,fear:0});
    Object.assign(citizen.body,{hydration:100,calories:100,sleepPressure:0,health:100});
  }
  advanceWorldTo(world,1_500_000);
  return world;
}

test('local cognition produces a deterministic discovery-to-building chain without AI',()=>{
  const first=runEmergence(),second=runEmergence();
  const types=new Set(first.ledger.map(event=>event.type));
  assert.ok(types.has('RESOURCE_GATHERED'));
  assert.ok(types.has('EXPERIMENT_COMPLETED'));
  assert.ok(types.has('SIGNAL_COINED'));
  assert.ok(types.has('COMMUNICATION'));
  assert.ok(first.citizens.some(citizen=>citizen.knowledge.some(entry=>entry.provenance.some(source=>source.kind==='communication'))));
  assert.ok(types.has('CONSTRUCTION_STARTED'));
  assert.ok(types.has('BUILDING_COMPLETED'));
  assert.equal(first.ledger.filter(event=>event.type==='AI_COGNITION').length,0);
  assert.equal(first.ledgerHead,second.ledgerHead);
  assert.equal(first.citizens.some(citizen=>citizen.activeGoal?.actionTypes?.includes('BUILD')),false);
});
