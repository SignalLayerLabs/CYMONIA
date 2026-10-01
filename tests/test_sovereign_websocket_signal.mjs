import test from 'node:test';
import assert from 'node:assert/strict';
import {SovereignWorld} from '../worker/src/index.js';
import {createSovereignGenesis} from '../world/index.js';

function make(){
  const sent=[];
  const world=createSovereignGenesis({realEpochMs:0});
  world.clock.worldMinute=321;
  world.ledgerHead='ledger-test';
  const instance=Object.create(SovereignWorld.prototype);
  Object.assign(instance,{
    world,
    committedWorld:null,
    lastPersistedGeneration:'slot-b',
    ctx:{getWebSockets:()=>[{send:value=>sent.push(String(value))}]}
  });
  return {instance,sent};
}

test('websocket heartbeat signal is compact and contains no public world graph',()=>{
  const {instance}=make();
  const signal=instance.worldSignal('world_signal');
  assert.deepEqual(signal,{
    type:'world_signal',
    version:2,
    worldId:instance.world.worldId,
    worldMinute:321,
    ledgerHead:'ledger-test',
    persistedGeneration:'slot-b'
  });
  assert.equal('state' in signal,false);
  assert.ok(JSON.stringify(signal).length<512);
});

test('heartbeat broadcast sends only the compact canonical signal',()=>{
  const {instance,sent}=make();
  instance.broadcastWorldSignal('world_signal');
  assert.equal(sent.length,1);
  const message=JSON.parse(sent[0]);
  assert.equal(message.type,'world_signal');
  assert.equal(message.worldMinute,321);
  assert.equal(message.ledgerHead,'ledger-test');
  assert.equal('state' in message,false);
  assert.ok(sent[0].length<512);
});
