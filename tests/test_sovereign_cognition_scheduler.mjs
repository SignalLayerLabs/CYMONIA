import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {ensureCognitionState,markAICognition} from '../world/cognition-state.js';
import {advanceWorldTo} from '../world/engine.js';
import {
  classifyCognitionReason,
  queueCognition,
  rankCognitionQueue,
  takeCognitionCandidate,
} from '../world/cognition-queue.js';

test('repeated discovery merges instead of growing the queue',()=>{
  const world=createSovereignGenesis({seed:9,realEpochMs:0});
  world.cognitionQueue=[];const citizen=world.citizens[0];
  queueCognition(world,citizen,'discovery',.6,10,'e1');
  queueCognition(world,citizen,'discovery',.6,20,'e2');
  assert.equal(world.cognitionQueue.length,1);
  assert.equal(world.cognitionQueue[0].occurrences,2);
  assert.deepEqual(world.cognitionQueue[0].eventIds,['e1','e2']);
  assert.equal(world.cognitionQueue[0].firstQueuedWorldMinute,10);
  assert.equal(world.cognitionQueue[0].lastQueuedWorldMinute,20);
});

test('debt eventually outranks a repeatedly served citizen',()=>{
  const world=createSovereignGenesis({seed:9,realEpochMs:0});
  world.cognitionQueue=[];const [old,frequent]=world.citizens;
  ensureCognitionState(old,0).cognitionDebt=.95;
  ensureCognitionState(frequent,0).cognitionDebt=.05;
  markAICognition(frequent,90);
  queueCognition(world,old,'novelty_unresolved',.5,100);
  queueCognition(world,frequent,'novelty_unresolved',.55,100);
  assert.equal(rankCognitionQueue(world,100)[0].citizenId,old.id);
});

test('reason classes separate local, priority, and final-reserve cognition',()=>{
  assert.deepEqual(classifyCognitionReason('plan_completed'),{tier:2,bonus:0,reserve:'local'});
  assert.equal(classifyCognitionReason('experiment_success').tier,3);
  assert.equal(classifyCognitionReason('experiment_success').reserve,'priority');
  assert.equal(classifyCognitionReason('human_direction').reserve,'emergency');
  assert.equal(classifyCognitionReason('immediate_danger').reserve,'emergency');
});

test('routine local events never enter the AI cognition queue',()=>{
  const world=createSovereignGenesis({seed:10,realEpochMs:0});
  world.cognitionQueue=[];const citizen=world.citizens[0];
  const entry=queueCognition(world,citizen,'encounter',.5,10);
  assert.equal(entry.reserve,'local');
  assert.equal(entry.queued,false);
  assert.equal(world.cognitionQueue.length,0);
});

test('legacy persisted queue entries normalize lazily',()=>{
  const world=createSovereignGenesis({seed:12,realEpochMs:0});
  const citizen=world.citizens[0];
  world.cognitionQueue=[{citizenId:citizen.id,reason:'discovery',priority:.7}];
  const ranked=rankCognitionQueue(world,55);
  assert.equal(ranked[0].basePriority,.7);
  assert.equal(ranked[0].occurrences,1);
  assert.equal(ranked[0].firstQueuedWorldMinute,55);
});

test('reserve phase filters standard work after the soft budget',()=>{
  const world=createSovereignGenesis({seed:14,realEpochMs:0});
  world.cognitionQueue=[];const [standard,priority,emergency]=world.citizens;
  queueCognition(world,standard,'discovery',1,0);
  queueCognition(world,priority,'experiment_success',.5,0);
  queueCognition(world,emergency,'human_direction',.2,0);
  assert.equal(takeCognitionCandidate(world,0,'priority').citizenId,priority.id);
  assert.equal(takeCognitionCandidate(world,0,'emergency').citizenId,emergency.id);
});

test('equal eligible citizens are all served before a repeat',()=>{
  const world=createSovereignGenesis({seed:15,realEpochMs:0});
  world.cognitionQueue=[];
  for(const citizen of world.citizens)queueCognition(world,citizen,'novelty_unresolved',.5,0);
  const served=[];
  for(let i=0;i<world.citizens.length;i++){
    const entry=takeCognitionCandidate(world,i,'standard');
    assert.ok(entry);
    served.push(entry.citizenId);
    const citizen=world.citizens.find(item=>item.id===entry.citizenId);
    markAICognition(citizen,i);
    queueCognition(world,citizen,'novelty_unresolved',.5,i+1);
  }
  assert.equal(new Set(served).size,world.citizens.length);
});

test('simulated time ages cognition debt without requiring AI',()=>{
  const world=createSovereignGenesis({seed:16,realEpochMs:0});
  const citizen=world.citizens[0];
  assert.equal(ensureCognitionState(citizen,0).cognitionDebt,0);
  advanceWorldTo(world,60_000);
  assert.ok(ensureCognitionState(citizen,60).cognitionDebt>0);
});
