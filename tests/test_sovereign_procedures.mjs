import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {executePhysicalOperations} from '../world/physical-operations.js';
import {appendEvent,compactLedger,verifyLedger} from '../world/ledger.js';
import {hash32} from '../world/rng.js';
import {ensureProcedures,rememberProcedure,recordProcedureOutcome,learnProcedure,teachProcedure,modifyProcedure,forgetCitizenProcedures,decayProcedureKnowledge,knownProcedure,procedureSummary,procedureProposal,PROCEDURE_LIMITS} from '../world/procedures.js';

function fixture(){
  const world=createSovereignGenesis({seed:6801,realEpochMs:0}),[creator,learner,remote]=world.citizens;
  creator.position={x:50,y:50};learner.position={x:51,y:50};remote.position={x:90,y:90};
  const object={id:'obj:procedure:clay',kind:'raw_material',material:'clay',quantity:2,massPerUnitKg:1,holderId:creator.id,position:{...creator.position},condition:1,provenance:{type:'TEST_INPUT'}};
  world.objects.push(object);creator.possessions.push(object.id);
  return {world,creator,learner,remote,object};
}
function execute(f,operations=[{primitive:'rotate',target:0,angle:30,workJ:10}],at=0,procedureId=null){
  return executePhysicalOperations(f.world,f.creator,operations,{inputObjectIds:[f.object.id],at,procedureId,workMinutes:1});
}
function discover(f,operations,at=0){return rememberProcedure(f.world,f.creator,execute(f,operations,at),at);}
function reload(f){const world=JSON.parse(JSON.stringify(f.world));return {...f,world,creator:world.citizens.find(c=>c.id===f.creator.id),learner:world.citizens.find(c=>c.id===f.learner.id),remote:world.citizens.find(c=>c.id===f.remote.id),object:world.objects.find(o=>o.id===f.object.id)};}

test('a real physical receipt creates personal persistent knowledge with causal provenance',()=>{
  const f=fixture(),receipt=execute(f),procedure=rememberProcedure(f.world,f.creator,receipt,0);
  assert.equal(procedure.creatorCitizenId,f.creator.id);
  assert.equal(procedure.successCount,1);assert.equal(procedure.failureCount,0);
  assert.equal(procedure.evidenceEventId,receipt.eventId);
  assert.equal(procedure.evidenceReceiptId,receipt.id);
  assert.ok(f.world.ledger.some(e=>e.id===procedure.createdEventId&&e.type==='PROCEDURE_DISCOVERED'));
  assert.deepEqual(procedure.observedInputs,receipt.observedInputs);
  assert.deepEqual(procedure.operations,receipt.operations);
  assert.ok(knownProcedure(f.world,f.creator,procedure.id));
  assert.equal(knownProcedure(f.world,f.learner,procedure.id),null);
  assert.ok(verifyLedger(f.world));
  receipt.operations[0].angle=999;
  assert.equal(procedure.operations[0].angle,30,'memory owns its bounded data rather than a mutable receipt reference');
});

test('procedure knowledge and monotonic IDs survive JSON reload without resetting historical matter',()=>{
  let f=fixture(),procedure=discover(f),historic=JSON.stringify(f.world.objects),next=f.world.procedureSequence;
  f=reload(f);ensureProcedures(f.world);
  assert.equal(JSON.stringify(f.world.objects),historic);
  assert.ok(knownProcedure(f.world,f.creator,procedure.id));
  const variant=modifyProcedure(f.world,f.creator,procedure.id,[{primitive:'rotate',target:0,angle:45,workJ:10}],5);
  assert.equal(variant.sequence,next);assert.notEqual(variant.id,procedure.id);
  assert.equal(variant.parentProcedureId,procedure.id);
  assert.equal(variant.successCount,0,'a hypothesis is not a successful technology');
  assert.ok(verifyLedger(f.world));
});

test('legacy snapshots migrate procedure fields without changing their clock, citizens, objects, or ledger',()=>{
  const f=fixture(),snapshot=JSON.stringify(f.world),objects=f.world.objects;
  assert.equal('procedures' in f.world,false);
  assert.deepEqual(procedureSummary(f.world,f.creator),[]);
  assert.equal(procedureProposal(f.world,f.creator,0),null);
  assert.equal(JSON.stringify(f.world),snapshot,'Observer and proposal reads must not lazily migrate');
  ensureProcedures(f.world);
  const expected=JSON.parse(snapshot);expected.procedures=[];expected.procedureSequence=0;
  assert.deepEqual(f.world,expected);assert.equal(f.world.objects,objects);
});

test('fabricated, altered, foreign, stale, and future receipts cannot teach knowledge',()=>{
  const f=fixture(),receipt=execute(f),before=JSON.stringify(f.world);
  assert.throws(()=>rememberProcedure(f.world,f.creator,{...receipt,id:'fabricated'},0),/evidence_required/);
  assert.throws(()=>rememberProcedure(f.world,f.creator,{...receipt,operations:[{primitive:'rotate',target:0,angle:180,workJ:10}]},0),/receipt_mismatch/);
  assert.throws(()=>rememberProcedure(f.world,f.learner,receipt,0),/observation_required/);
  assert.throws(()=>rememberProcedure(f.world,f.creator,receipt,181),/observation_expired/);
  assert.throws(()=>rememberProcedure(f.world,f.creator,receipt,-1),/observation_expired/);
  assert.equal(JSON.stringify(f.world),before,'denied evidence must not create registry fields or events');
});

test('a genuine witness can learn the observed sequence while a remote Citizen cannot',()=>{
  const f=fixture(),receipt=execute(f),procedure=rememberProcedure(f.world,f.creator,receipt,0);
  assert.ok(receipt.observerIds.includes(f.learner.id));assert.equal(receipt.observerIds.includes(f.remote.id),false);
  learnProcedure(f.world,f.learner,procedure.id,{kind:'observation',eventId:receipt.eventId,confidence:.7},1);
  assert.ok(knownProcedure(f.world,f.learner,procedure.id));
  f.remote.position={...f.creator.position};
  assert.throws(()=>learnProcedure(f.world,f.remote,procedure.id,{kind:'observation',eventId:receipt.eventId},1),/observation_required/);
  assert.throws(()=>learnProcedure(f.world,f.remote,procedure.id,{kind:'observation'},1),/evidence_required/);
  assert.throws(()=>learnProcedure(f.world,f.remote,procedure.id,{kind:'registry'},1),/source_invalid/);
});

test('observation must identify the actual sequence and cannot use a different experiment as a credential',()=>{
  const f=fixture(),procedure=discover(f),different=execute(f,[{primitive:'rotate',target:0,angle:60,workJ:10}],1);
  assert.throws(()=>learnProcedure(f.world,f.learner,procedure.id,{kind:'observation',eventId:different.eventId},1),/observation_mismatch/);
  assert.equal(knownProcedure(f.world,f.learner,procedure.id),null);
});

test('retained canonical execution receipts remain verifiable after ledger compaction and persistence',()=>{
  let f=fixture(),receipt=execute(f),procedure=rememberProcedure(f.world,f.creator,receipt,0);
  compactLedger(f.world,1);
  assert.equal(f.world.ledger.some(e=>e.id===receipt.eventId),false);
  f=reload(f);
  learnProcedure(f.world,f.learner,procedure.id,{kind:'observation',eventId:receipt.eventId},2);
  assert.ok(knownProcedure(f.world,f.learner,procedure.id));
  assert.ok(verifyLedger(f.world));
});

test('teaching requires living personal holders and physical proximity',()=>{
  const f=fixture(),procedure=discover(f);
  const before=JSON.stringify(f.world);
  assert.throws(()=>teachProcedure(f.world,f.creator,f.remote,procedure.id,{},1),/not_nearby/);
  assert.throws(()=>teachProcedure(f.world,f.learner,f.creator,procedure.id,{},1),/not_known/);
  assert.throws(()=>learnProcedure(f.world,f.learner,procedure.id,{kind:'teaching',from:f.remote.id},1),/source_unavailable/);
  assert.throws(()=>teachProcedure(f.world,f.creator,f.creator,procedure.id,{},1),/receiver_invalid/);
  assert.equal(JSON.stringify(f.world),before);
  teachProcedure(f.world,f.creator,f.learner,procedure.id,{actionId:'action:teach'},1);
  assert.ok(knownProcedure(f.world,f.learner,procedure.id));
  const entry=f.learner.procedureKnowledge.find(k=>k.procedureId===procedure.id);
  assert.equal(entry.provenance.at(-1).kind,'teaching');assert.equal(entry.provenance.at(-1).from,f.creator.id);
  assert.ok(f.world.ledger.some(e=>e.type==='PROCEDURE_TRANSMITTED'&&e.payload.actionId==='action:teach'&&e.causes.includes(procedure.createdEventId)));
  assert.ok(verifyLedger(f.world));
});

test('copied Citizen objects cannot forge the canonical personal mind',()=>{
  const f=fixture(),procedure=discover(f),forged={...f.remote,procedureKnowledge:structuredClone(f.creator.procedureKnowledge)};
  assert.equal(knownProcedure(f.world,forged,procedure.id),null);
  assert.throws(()=>teachProcedure(f.world,forged,f.learner,procedure.id,{},1),/unavailable/);
  assert.equal(procedureProposal(f.world,forged,1),null);
});

test('imperfect transmission creates a deterministic untested lineage with bounded numeric mutation',()=>{
  const base=fixture(),parent=discover(base),a=reload(base),b=reload(base);
  const one=teachProcedure(a.world,a.creator,a.learner,parent.id,{actionId:'action:copy',imperfect:true},5);
  const two=teachProcedure(b.world,b.creator,b.learner,parent.id,{actionId:'action:copy',imperfect:true},5);
  assert.deepEqual(one,two);assert.notEqual(one.id,parent.id);
  assert.notDeepEqual(one.operations,parent.operations);assert.equal(one.parentProcedureId,parent.id);
  assert.equal(one.successCount,0);assert.equal(one.evidenceEventId,null);
  assert.ok(knownProcedure(a.world,a.learner,one.id));assert.equal(knownProcedure(a.world,a.creator,one.id),null);
  assert.equal(a.learner.procedureKnowledge.at(-1).provenance.at(-1).from,a.creator.id);
  assert.ok(verifyLedger(a.world));
});

test('modification requires a known parent and cannot store executable host code',()=>{
  const f=fixture(),parent=discover(f),before=JSON.stringify(f.world);
  assert.throws(()=>modifyProcedure(f.world,f.learner,parent.id,[{primitive:'rotate',target:0,angle:2}],0),/not_known/);
  assert.throws(()=>modifyProcedure(f.world,f.creator,parent.id,[{primitive:'rotate',target:0,angle:2,javascript:'globalThis.pwned=true'}],0),/forbidden/);
  assert.throws(()=>modifyProcedure(f.world,f.creator,parent.id,[{primitive:'eval',target:0}],0),/primitive_invalid/);
  assert.equal(JSON.stringify(f.world),before);
  const child=modifyProcedure(f.world,f.creator,parent.id,[{primitive:'rotate',target:0,angle:10,workJ:10}],1);
  assert.equal(child.parentProcedureId,parent.id);assert.equal(child.successCount,0);
  assert.equal(child.provenance[0].kind,'hypothesis');assert.ok(knownProcedure(f.world,f.creator,child.id));
});

test('local repetition deduplicates recipes and outcomes, including replay after compacted ledger reload',()=>{
  let f=fixture(),receipt=execute(f),procedure=rememberProcedure(f.world,f.creator,receipt,0);
  rememberProcedure(f.world,f.creator,receipt,0);
  recordProcedureOutcome(f.world,f.creator,procedure.id,{ok:true,receipt},0);
  assert.equal(procedure.successCount,1);
  const second=execute(f,undefined,1);assert.equal(rememberProcedure(f.world,f.creator,second,1).id,procedure.id);
  assert.equal(procedure.successCount,2);assert.equal(f.world.procedures.length,1);
  for(let i=2;i<15;i++)rememberProcedure(f.world,f.creator,execute(f,undefined,i),i);
  assert.equal(procedure.recentOutcomes.length,PROCEDURE_LIMITS.outcomes);
  const count=procedure.successCount;compactLedger(f.world,1);f=reload(f);
  recordProcedureOutcome(f.world,f.creator,procedure.id,{ok:true,receipt},16);
  assert.equal(f.world.procedures[0].successCount,count,'high water sequence rejects old replay beyond retained outcomes');
});

test('physical failure records uncertainty without fabricating successful output evidence',()=>{
  const f=fixture(),parent=discover(f),variant=modifyProcedure(f.world,f.creator,parent.id,[{primitive:'rotate',target:0,angle:30,workJ:100000}],1);
  const before=JSON.stringify(f.world.objects);
  assert.throws(()=>execute(f,variant.operations,2,variant.id),/work_budget_exceeded/);
  recordProcedureOutcome(f.world,f.creator,variant.id,{ok:false,reason:'physical_work_budget_exceeded'},2);
  assert.equal(variant.failureCount,1);assert.equal(variant.successCount,0);assert.equal(variant.observedOutputs.length,0);
  assert.equal(JSON.stringify(f.world.objects),before);
  assert.ok(f.world.ledger.some(e=>e.type==='PROCEDURE_FAILED'&&e.payload.procedureId===variant.id));
});

test('death removes execution access and only loses the procedure when the final living holder dies',()=>{
  const f=fixture(),procedure=discover(f);teachProcedure(f.world,f.creator,f.learner,procedure.id,{},1);
  assert.throws(()=>forgetCitizenProcedures(f.world,f.creator,2),/death_required/);
  f.creator.alive=false;f.creator.body.alive=false;forgetCitizenProcedures(f.world,f.creator,2);
  assert.equal(knownProcedure(f.world,f.creator,procedure.id),null);
  assert.equal(procedure.lostWorldMinute,null);assert.ok(knownProcedure(f.world,f.learner,procedure.id));
  f.learner.alive=false;f.learner.body.alive=false;forgetCitizenProcedures(f.world,f.learner,3);
  assert.equal(procedure.lostWorldMinute,3);
  assert.equal(f.world.ledger.filter(e=>e.type==='PROCEDURE_LOST'&&e.payload.procedureId===procedure.id).length,1);
  forgetCitizenProcedures(f.world,f.learner,4);
  assert.equal(f.world.ledger.filter(e=>e.type==='PROCEDURE_LOST').length,1);
  assert.equal(procedureProposal(f.world,f.creator,200),null);
  assert.throws(()=>learnProcedure(f.world,f.remote,procedure.id,{kind:'teaching',from:f.creator.id},4),/source_unavailable/);
});

test('long quiet intervals integrate bounded memory decay and allow genuine knowledge loss',()=>{
  const f=fixture(),procedure=discover(f),objects=JSON.stringify(f.world.objects),initial=f.creator.procedureKnowledge[0].confidence;
  assert.equal(decayProcedureKnowledge(f.world,0,120),0);
  assert.equal(f.creator.procedureKnowledge[0].confidence,initial);
  decayProcedureKnowledge(f.world,120,1440);
  assert.ok(f.creator.procedureKnowledge[0].confidence<initial);
  const decayed=f.creator.procedureKnowledge[0].confidence;
  decayProcedureKnowledge(f.world,0,1440);
  assert.equal(f.creator.procedureKnowledge[0].confidence,decayed,'repeated boundaries do not double decay');
  assert.equal(decayProcedureKnowledge(f.world,1440,1440*1000),1);
  assert.equal(knownProcedure(f.world,f.creator,procedure.id),null);assert.ok(procedure.lostWorldMinute>0);
  assert.equal(JSON.stringify(f.world.objects),objects);
  assert.throws(()=>learnProcedure(f.world,f.creator,procedure.id,{kind:'observation',eventId:procedure.evidenceEventId},1440*1000),/expired/);
});

test('decay is analytically deterministic across coarse and fine segment schedules',()=>{
  const base=fixture();discover(base);const a=reload(base),b=reload(base);
  decayProcedureKnowledge(a.world,0,1440*10);
  for(let day=1;day<=10;day++)decayProcedureKnowledge(b.world,(day-1)*1440,day*1440);
  assert.ok(Math.abs(a.creator.procedureKnowledge[0].confidence-b.creator.procedureKnowledge[0].confidence)<1e-12);
});

test('registry, mind traces, teaching provenance and outcome lists stay bounded',()=>{
  const f=fixture(),parent=discover(f);
  const weak=modifyProcedure(f.world,f.creator,parent.id,[{primitive:'rotate',target:0,angle:7,workJ:10}],1);
  for(let i=0;i<PROCEDURE_LIMITS.records+30;i++){
    const current=f.creator.procedureKnowledge.find(k=>k.active&&knownProcedure(f.world,f.creator,k.procedureId));
    modifyProcedure(f.world,f.creator,current.procedureId,[{primitive:'rotate',target:0,angle:i+1,workJ:10}],i+1);
  }
  assert.ok(f.world.procedures.length<=PROCEDURE_LIMITS.records);
  assert.ok(f.creator.procedureKnowledge.length<=PROCEDURE_LIMITS.personal);
  const current=knownProcedure(f.world,f.creator,f.creator.procedureKnowledge.at(-1).procedureId);
  for(let i=0;i<30;i++)teachProcedure(f.world,f.creator,f.learner,current.id,{},400+i);
  assert.ok(current.recentLearners.length<=PROCEDURE_LIMITS.recentLearners);
  assert.ok(f.learner.procedureKnowledge.at(-1).provenance.length<=PROCEDURE_LIMITS.provenance);
  for(let i=0;i<15;i++)recordProcedureOutcome(f.world,f.creator,current.id,{ok:false,reason:'bounded'},450+i);
  assert.ok(current.recentOutcomes.length<=PROCEDURE_LIMITS.outcomes);
  assert.ok(f.world.procedureSequence>PROCEDURE_LIMITS.records);
  assert.ok(f.world.ledger.some(e=>e.type==='PROCEDURE_EVIDENCE_COMPACTED'));
  assert.equal(knownProcedure(f.world,f.creator,weak.id),null,'evicted personal memories grant no global reuse');
  assert.ok(knownProcedure(f.world,f.creator,parent.id),'successful knowledge survives speculative memory pressure');
});

test('a full registry of living held procedures rejects capacity without evicting practical knowledge',()=>{
  const f=fixture(),parent=discover(f);
  // The capacity guard protects real holders; this fixture gives separate minds
  // compact personal references to fill the evidence registry deterministically.
  f.world.procedures=Array.from({length:PROCEDURE_LIMITS.records},(_,i)=>({...structuredClone(parent),id:`procedure:held:${i}`,sequence:i}));
  f.world.procedureSequence=PROCEDURE_LIMITS.records;
  for(let i=0;i<f.world.procedures.length;i++){
    const citizen=f.world.citizens[Math.floor(i/PROCEDURE_LIMITS.personal)];
    citizen.procedureKnowledge??=[];citizen.procedureKnowledge.push({procedureId:f.world.procedures[i].id,active:true,confidence:.8,provenance:[]});
  }
  const owned=f.creator.procedureKnowledge.find(k=>k.procedureId.startsWith('procedure:held:'));
  const before=JSON.stringify(f.world);
  assert.throws(()=>modifyProcedure(f.world,f.creator,owned.procedureId,[{primitive:'rotate',target:0,angle:77,workJ:10}],1),/registry_capacity/);
  assert.equal(JSON.stringify(f.world),before);
});

test('personal proposals match held matter slots and never consult another mind or mutate world state',()=>{
  const f=fixture(),procedure=discover(f),before=JSON.stringify(f.world);
  const proposal=procedureProposal(f.world,f.creator,120);
  assert.equal(proposal.actions[0].type,'EXPERIMENT');assert.equal(proposal.actions[0].payload.procedureId,procedure.id);
  assert.deepEqual(proposal.actions[0].payload.inputObjectIds,[f.object.id]);assert.deepEqual(proposal.concepts,[]);
  assert.equal(procedureProposal(f.world,f.learner,120),null);
  const summary=procedureSummary(f.world,f.creator);summary[0].provenance[0].kind='mutated-observer-copy';
  assert.equal(JSON.stringify(f.world),before);
  assert.equal(procedureProposal(f.world,f.creator,119),null,'recent practice has a bounded cooldown');
  f.object.holderId=f.learner.id;assert.equal(procedureProposal(f.world,f.creator,120),null);
  f.object.holderId=f.creator.id;f.object.material='stone';assert.equal(procedureProposal(f.world,f.creator,120),null);
});

test('material matching preserves distinct input and tool slots without reusing one held object',()=>{
  const f=fixture(),second={...structuredClone(f.object),id:'obj:procedure:second',quantity:1};f.world.objects.push(second);
  const receipt=executePhysicalOperations(f.world,f.creator,[{primitive:'rotate',target:0,tool:1,angle:10,workJ:10}],{inputObjectIds:[f.object.id,second.id],at:0,workMinutes:1});
  const procedure=rememberProcedure(f.world,f.creator,receipt,0);
  assert.deepEqual(procedureProposal(f.world,f.creator,120).actions[0].payload.inputObjectIds,[f.object.id,second.id]);
  second.holderId=null;
  assert.equal(procedureProposal(f.world,f.creator,120),null);
  assert.ok(knownProcedure(f.world,f.creator,procedure.id));
});

test('repeated practical experience can propose sparse local transmission and teaching shares the practice cooldown',()=>{
  const f=fixture(),parent=discover(f);rememberProcedure(f.world,f.creator,execute(f,undefined,1),1);
  f.creator.knownEntityIds.push(f.learner.id);
  let at=240;
  while(hash32(`${f.creator.id}|${Math.floor(at/120)}`)%4!==0)at+=120;
  const before=JSON.stringify(f.world),proposal=procedureProposal(f.world,f.creator,at);
  assert.equal(proposal.actions[0].type,'TEACH');assert.equal(proposal.actions[0].targetId,f.learner.id);
  assert.equal(proposal.actions[0].payload.procedureId,parent.id);assert.equal(JSON.stringify(f.world),before);
  teachProcedure(f.world,f.creator,f.learner,parent.id,{},at);
  assert.equal(procedureProposal(f.world,f.creator,at+12),null,'teaching is a recall and cannot repeat on every idle reflex');
});

test('low-confidence testimony remains an uncertain trace instead of gaining execution confidence for free',()=>{
  const f=fixture(),parent=discover(f);f.creator.procedureKnowledge[0].confidence=.13;
  teachProcedure(f.world,f.creator,f.learner,parent.id,{},1);
  assert.ok(f.learner.procedureKnowledge[0].confidence<.12);
  assert.equal(f.learner.procedureKnowledge[0].active,false);
  assert.equal(knownProcedure(f.world,f.learner,parent.id),null);
  assert.equal(procedureProposal(f.world,f.learner,200),null);
  assert.equal(parent.lostWorldMinute,null,'the original living mind still carries the usable sequence');
});

test('procedure causal edges reference canonical events and final-holder loss links its actual death',()=>{
  const f=fixture(),parent=discover(f);
  const action=appendEvent(f.world,'ACTION_STARTED',f.creator.id,{actionId:'act:canonical:teaching',type:'TEACH'},[],1);
  teachProcedure(f.world,f.creator,f.learner,parent.id,{actionId:'act:canonical:teaching'},2);
  const transmitted=f.world.ledger.find(e=>e.type==='PROCEDURE_TRANSMITTED');
  assert.ok(transmitted.causes.includes(action.id));assert.ok(transmitted.causes.includes(parent.createdEventId));
  assert.equal(transmitted.causes.includes('act:canonical:teaching'),false);
  const child=modifyProcedure(f.world,f.creator,parent.id,[{primitive:'rotate',target:0,angle:17,workJ:10}],3);
  const modified=f.world.ledger.find(e=>e.id===child.createdEventId);
  assert.ok(modified.causes.includes(parent.createdEventId));assert.equal(modified.causes.includes(parent.id),false);
  f.creator.alive=false;f.creator.body.alive=false;
  const firstDeath=appendEvent(f.world,'DEATH',f.creator.id,{cause:'test'},[],4);
  forgetCitizenProcedures(f.world,f.creator,4,firstDeath.id);
  f.learner.alive=false;f.learner.body.alive=false;
  const finalDeath=appendEvent(f.world,'DEATH',f.learner.id,{cause:'test'},[],5);
  forgetCitizenProcedures(f.world,f.learner,5,finalDeath.id);
  const loss=f.world.ledger.find(e=>e.type==='PROCEDURE_LOST'&&e.payload.procedureId===parent.id);
  assert.ok(loss.causes.includes(finalDeath.id));assert.ok(loss.causes.includes(parent.createdEventId));
  const eventIds=new Set(f.world.ledger.map(e=>e.id));
  for(const event of f.world.ledger.filter(e=>e.type.startsWith('PROCEDURE_')))for(const cause of event.causes)assert.ok(eventIds.has(cause),`missing event cause ${cause}`);
  assert.ok(verifyLedger(f.world));
});
