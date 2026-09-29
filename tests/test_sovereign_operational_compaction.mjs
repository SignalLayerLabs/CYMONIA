import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis,advanceWorldTo,verifyLedger,publicWorld,compactOperationalState,startAction,applyAcceptedPlan,runExperiment} from '../world/index.js';

test('long-lived worlds retain live actions and plans without unbounded operational history',()=>{
  const world=createSovereignGenesis({realEpochMs:0});
  advanceWorldTo(world,1_200_000);
  assert.ok(world.actions.length<=1024,`retained ${world.actions.length} actions`);
  assert.ok(world.citizens.every(c=>c.plans.length<=64));
  for(const citizen of world.citizens){
    if(!citizen.currentActionId)continue;
    const action=world.actions.find(a=>a.id===citizen.currentActionId);
    assert.equal(action?.status,'active');
    if(action.planId)assert.ok(citizen.plans.some(p=>p.id===action.planId));
  }
  const previousIds=new Set(world.actions.map(a=>a.id));
  advanceWorldTo(world,1_260_000);
  assert.equal(new Set(world.actions.map(a=>a.id)).size,world.actions.length);
  assert.ok(world.actions.some(a=>!previousIds.has(a.id)));
  assert.equal(publicWorld(world,1_260_000).citizens.length,100);
  assert.equal(verifyLedger(world),true);
});


test('legacy operational history compacts without losing a live multi-step plan or reusing IDs',()=>{
  const w=createSovereignGenesis({realEpochMs:0}),c=w.citizens[0];
  const plan=applyAcceptedPlan(w,c,{source:'local',concepts:[],actions:[{type:'OBSERVE',durationMinutes:10},{type:'REST',durationMinutes:10}]},0);
  const activeId=c.currentActionId;
  w.actions.push(...Array.from({length:4000},(_,i)=>({id:`old:${i}`,status:'completed'})));
  c.plans.push(...Array.from({length:200},(_,i)=>({id:`old-plan:${i}`,status:'completed'})));
  const ledgerBefore=JSON.stringify(w.ledger),citizensBefore=w.citizens.map(c=>c.id);
  compactOperationalState(w);
  assert.ok(w.actions.some(a=>a.id===activeId));
  assert.ok(c.plans.some(p=>p.id===plan.id));
  assert.equal(JSON.stringify(w.ledger),ledgerBefore);
  assert.deepEqual(w.citizens.map(c=>c.id),citizensBefore);
  assert.equal(w.actionSequence,4001);
  assert.equal(c.planSequence,201);
  advanceWorldTo(w,10_000);
  const next=w.actions.find(a=>a.id===c.currentActionId);
  assert.equal(next.type,'REST');
  assert.equal(next.planId,plan.id);
  assert.notEqual(next.id,activeId);
  assert.equal(plan.cursor,1);
});

test('experiment compaction preserves learned evidence and uses monotonic IDs across reloads',()=>{
  const w=createSovereignGenesis({realEpochMs:0}),c=w.citizens[0];
  const ids=new Set();
  for(let i=0;i<300;i++)ids.add(runExperiment(w,c,{targetIds:[],inputConcepts:[]},0).id);
  const ledgerBefore=JSON.stringify(w.ledger);
  compactOperationalState(w);
  assert.ok(w.experiments.length<=256);
  const reloaded=JSON.parse(JSON.stringify(w));
  const next=runExperiment(reloaded,reloaded.citizens[0],{targetIds:[],inputConcepts:[]},0);
  assert.ok(!ids.has(next.id));
  assert.equal(JSON.stringify(w.ledger),ledgerBefore);
});

test('an existing SQLite snapshot is compacted as it loads, before its first alarm',async()=>{
  const {SovereignWorld,splitSnapshot}=await import('../worker/src/index.js');
  const {encodeSnapshot}=await import('../worker/src/persistence.js');
  const w=createSovereignGenesis({realEpochMs:0}),c=w.citizens[0];
  const action=startAction(w,c,{type:'OBSERVE',durationMinutes:10},0);
  w.actions.push(...Array.from({length:4000},(_,i)=>({id:`old:${i}`,status:'completed'})));
  const parts=splitSnapshot(await encodeSnapshot(JSON.stringify(w)));
  const instance=Object.create(SovereignWorld.prototype);
  instance.sql={exec(query){
    if(query.startsWith('SELECT generation,chunk_count'))return [{generation:'slot-b',chunk_count:parts.length}];
    if(query.startsWith('SELECT state_part FROM world_state_chunks_v2'))return parts.map(state_part=>({state_part}));
    throw new Error(`unexpected SQL: ${query}`);
  }};
  const loaded=await instance.loadWorld();
  assert.ok(loaded.actions.length<=1024);
  assert.equal(loaded.citizens.length,100);
  assert.equal(loaded.citizens[0].currentActionId,action.id);
  assert.ok(loaded.actions.some(a=>a.id===action.id));
  assert.equal(loaded.ledgerHead,w.ledgerHead);
});
