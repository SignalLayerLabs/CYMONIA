import test from 'node:test';
import assert from 'node:assert/strict';
import * as worldAPI from '../world/index.js';
import {enumerateAffordances} from '../world/affordances.js';
import {sqliteStorage,wake} from './helpers/sovereign-sqlite.mjs';

function setup(){
  const world=worldAPI.createSovereignGenesis({seed:73,realEpochMs:0}),citizen=world.citizens[0];
  citizen.position={x:50,y:50};
  const o={id:'input:clay',kind:'raw_material',material:'clay',quantity:2,massPerUnitKg:1,holderId:citizen.id,position:{...citizen.position},condition:1,provenance:{type:'TEST'}};
  world.objects.push(o);citizen.possessions.push(o.id);citizen.knownEntityIds.push(o.id);
  return {world,citizen,object:o};
}

test('physical experiment goes through canonical completion and becomes personal repeatable knowledge',()=>{
  const f=setup(),mass=worldAPI.totalTrackedMass(f.world);
  const action=worldAPI.startAction(f.world,f.citizen,{type:'EXPERIMENT',durationMinutes:3,payload:{inputObjectIds:[f.object.id],operations:[{primitive:'shape',target:0,form:'hollow',workJ:200}]}},0);
  const publicAction=worldAPI.publicWorld(f.world).citizens[0].currentAction;
  assert.equal(publicAction.physicalOperation?.primitive,'shape');assert.equal(publicAction.physicalOperation.targetId,f.object.id);
  worldAPI.advanceWorldTo(f.world,action.endsWorldMinute*1000);
  assert.equal(f.object.geometry?.form,'hollow');
  assert.ok(f.citizen.procedureKnowledge?.some(k=>k.active!==false));
  assert.ok(f.world.ledger.some(e=>e.type==='PHYSICAL_OPERATIONS_EXECUTED'));
  assert.ok(Math.abs(worldAPI.totalTrackedMass(f.world)-mass)<1e-6);
  assert.ok(worldAPI.verifyLedger(f.world));
});

test('AI accepts only personal procedures and preserves bounded physical declarative payload',()=>{
  const f=setup();
  const raw={actions:[{type:'EXPERIMENT',payload:{inputObjectIds:[f.object.id],operations:[{primitive:'rotate',target:0,angle:30,workJ:10}]}}]};
  const clean=worldAPI.sanitizeAIProposal(raw);
  assert.equal(clean.actions[0].payload.operations?.[0].primitive,'rotate');
  assert.equal(worldAPI.validateCognitiveProposal(f.world,f.citizen,clean).ok,true);
  const foreign={concepts:[],actions:[{type:'EXPERIMENT',payload:{procedureId:'foreign:procedure',inputObjectIds:[f.object.id]}}]};
  assert.equal(worldAPI.validateCognitiveProposal(f.world,f.citizen,foreign).ok,false);
  const unsafe={concepts:[],actions:[{type:'EXPERIMENT',payload:{inputObjectIds:[f.object.id],operations:[{primitive:'eval',target:0,code:'1+1'}]}}]};
  assert.equal(worldAPI.validateCognitiveProposal(f.world,f.citizen,unsafe).ok,false);
});

test('physical failure is recorded without forging successful knowledge or consuming the input',()=>{
  const f=setup(),before=f.object.quantity;
  const a=worldAPI.startAction(f.world,f.citizen,{type:'EXPERIMENT',durationMinutes:1,payload:{inputObjectIds:[f.object.id],operations:[{primitive:'shape',target:0,workJ:0}]}},0);
  worldAPI.advanceWorldTo(f.world,a.endsWorldMinute*1000);
  assert.equal(f.object.quantity,before);assert.equal(f.object.geometry,undefined);
  assert.ok(f.world.ledger.some(e=>e.type==='ACTION_RESOLUTION_FAILED'&&e.payload.actionId===a.id));
  assert.equal(f.citizen.procedureKnowledge?.filter(k=>k.active!==false).length||0,0);
});

test('public serialization is read-only on old snapshots and exposes procedure and causal truth',()=>{
  const f=setup(),before=JSON.stringify(f.world);
  const snapshot=worldAPI.publicWorld(f.world);
  assert.equal(JSON.stringify(f.world),before);
  assert.equal(snapshot.citizens[0].procedureCount,0);
  assert.deepEqual(snapshot.physicalReceipts,[]);
});

test('local cognition can try physical hypotheses from held observed matter without an AI call',()=>{
  const f=setup();
  worldAPI.learn(f.citizen,'opaque:shape',{kind:'observation',evidence:{entityId:f.object.id}},.7,0);
  const candidates=enumerateAffordances(f.world,f.citizen,30);
  const physical=candidates.find(candidate=>candidate.proposal.actions.some(a=>a.payload?.operations));
  assert.ok(physical,'a physical experiment is available alongside other local choices');
  assert.equal(worldAPI.validateCognitiveProposal(f.world,f.citizen,physical.proposal).ok,true);
  const a=physical.proposal.actions[0];
  assert.ok(a.payload.operations.length<=12);assert.deepEqual(a.payload.inputObjectIds,[f.object.id]);
});

test('self-programming preserves physical operations and binds them only to held local matter',()=>{
  const f=setup();
  worldAPI.createCitizenProgram(f.world,f.citizen,{trigger:{kind:'always'},steps:[{type:'EXPERIMENT',selector:'held_object',operations:[{primitive:'rotate',target:0,angle:30,workJ:10}]}]},0);
  const proposal=worldAPI.programProposal(f.world,f.citizen,30);
  assert.deepEqual(proposal.actions[0].payload.operations,[{primitive:'rotate',target:0,angle:30,workJ:10}]);
  assert.deepEqual(proposal.actions[0].payload.inputObjectIds,[f.object.id]);
});

test('physical causal history links the material experiment and procedure through canonical evidence',()=>{
  const f=setup();
  const a=worldAPI.startAction(f.world,f.citizen,{type:'EXPERIMENT',durationMinutes:3,payload:{inputObjectIds:[f.object.id],operations:[{primitive:'shape',target:0,form:'hollow',workJ:200}]}},0);
  worldAPI.advanceWorldTo(f.world,a.endsWorldMinute*1000);
  const receipt=f.world.physicalReceipts[0],procedure=f.world.procedures[0];
  const history=worldAPI.getHistory(f.world).entries;
  assert.ok(history.some(e=>e.eventId===receipt.eventId&&e.category==='knowledge'));
  assert.ok(history.some(e=>e.payload.procedureId===procedure.id&&e.category==='knowledge'));
  const why=worldAPI.getWhy(f.world,a.id);
  assert.equal(why.event.type,'ACTION_STARTED');
});

test('canonical actions can detach known contained matter and restore personal possession',()=>{
  const f=setup();f.object.geometry={form:'hollow'};
  const water={...f.object,id:'input:water',material:'water',geometry:undefined};
  f.world.objects.push(water);f.citizen.possessions.push(water.id);f.citizen.knownEntityIds.push(water.id);
  const run=operations=>{
    worldAPI.interruptAction(f.world,f.citizen,'test chooses next physical experiment');
    const a=worldAPI.startAction(f.world,f.citizen,{type:'EXPERIMENT',durationMinutes:1,payload:{inputObjectIds:[water.id,f.object.id],operations}},f.world.clock.worldMinute);
    worldAPI.advanceWorldTo(f.world,a.endsWorldMinute*1000);
    assert.ok(!f.world.ledger.some(e=>e.type==='ACTION_RESOLUTION_FAILED'&&e.payload.actionId===a.id));
  };
  run([{primitive:'contain',target:0,source:1,workJ:30}]);
  assert.equal(water.holderId,null);assert.ok(!f.citizen.possessions.includes(water.id));
  run([{primitive:'separate',target:0,source:1,workJ:30}]);
  assert.equal(water.holderId,f.citizen.id);assert.ok(f.citizen.possessions.includes(water.id));
  assert.equal(water.geometry.containedById,undefined);
});

test('physical matter and personal procedure evidence survive production SQLite compression and eviction',async t=>{
  const storage=sqliteStorage();t.after(()=>storage.db.close());
  const {instance}=await wake(storage),world=instance.world,citizen=world.citizens[0];
  const object={id:'historical:clay',material:'clay',kind:'raw_material',quantity:2,massPerUnitKg:1,holderId:citizen.id,position:{...citizen.position},condition:1,provenance:{type:'TEST'}};
  world.objects.push(object);citizen.possessions.push(object.id);citizen.knownEntityIds.push(object.id);
  await instance.persist({forceSeal:true});
  const {instance:legacy}=await wake(storage);
  assert.equal(legacy.world.procedures,undefined,'old snapshot needs no Genesis recreation');
  const actor=legacy.world.citizens[0];
  const receipt=worldAPI.executePhysicalOperations(legacy.world,actor,[{primitive:'shape',target:0,form:'hollow',workJ:200}],{inputObjectIds:[object.id],workMinutes:1});
  const procedure=worldAPI.rememberProcedure(legacy.world,actor,receipt,legacy.world.clock.worldMinute);
  const head=legacy.world.ledgerHead,minute=legacy.world.clock.worldMinute;
  await legacy.persist({forceSeal:true});
  const {instance:reloaded}=await wake(storage);
  assert.equal(reloaded.world.clock.worldMinute,minute);assert.equal(reloaded.world.ledgerHead,head);
  assert.equal(reloaded.world.objects.find(o=>o.id===object.id).geometry.form,'hollow');
  assert.equal(worldAPI.knownProcedure(reloaded.world,reloaded.world.citizens[0],procedure.id)?.id,procedure.id);
  assert.equal(reloaded.world.physicalReceipts[0].eventId,receipt.eventId);
  assert.ok(worldAPI.verifyLedger(reloaded.world));
});

test('public causal surfaces use compact receipts while WHY retains complete operation evidence',()=>{
  const f=setup(),receipt=worldAPI.executePhysicalOperations(f.world,f.citizen,[{primitive:'rotate',target:0,angle:15,workJ:10}],{inputObjectIds:[f.object.id],workMinutes:1});
  const before=JSON.stringify(f.world),view=worldAPI.publicWorld(f.world);
  for(const row of [...view.recentLedger,...view.history].filter(e=>(e.id||e.eventId)===receipt.eventId)){
    assert.equal(row.payload.operations,undefined);assert.equal(row.payload.receiptId,receipt.id);
  }
  assert.equal(view.physicalReceipts[0].operations,undefined);
  assert.equal(worldAPI.getWhy(f.world,receipt.eventId).event.payload.operations[0].primitive,'rotate');
  assert.equal(JSON.stringify(f.world),before);
});
