import {appendEvent} from './ledger.js';
import {hash32} from './rng.js';
import {validatePhysicalOperations} from './physical-operations.js';

// This registry is historical evidence. Only a living Citizen's personal entry
// grants execution access; a registry lookup can never supply forgotten steps.
export const PROCEDURE_LIMITS=Object.freeze({records:256,personal:24,provenance:6,outcomes:8,recentLearners:8,observationMinutes:180,decayIntervalMinutes:1440});
const MIN_CONFIDENCE=.12;
const clamp=(value,lo=0,hi=1)=>Math.max(lo,Math.min(hi,Number(value)||0));
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
const records=world=>Array.isArray(world.procedures)?world.procedures:[];
const personal=citizen=>Array.isArray(citizen?.procedureKnowledge)?citizen.procedureKnowledge:[];
const active=entry=>entry&&entry.active!==false&&Number(entry.confidence)>=MIN_CONFIDENCE;
const living=(world,citizen)=>citizen?.alive===true&&citizen.body?.alive!==false&&(world.citizens||[]).includes(citizen);
const close=(a,b,radius)=>a?.position&&b?.position&&Number.isFinite(a.position.x)&&Number.isFinite(a.position.y)&&Number.isFinite(b.position.x)&&Number.isFinite(b.position.y)&&Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y)<=radius;
const localEntry=(citizen,id)=>personal(citizen).find(entry=>entry.procedureId===id&&active(entry));
const boundedPush=(array,value,limit)=>{array.push(value);if(array.length>limit)array.splice(0,array.length-limit);};

export function knownProcedure(world,citizen,procedureId){
  if(!living(world,citizen)||!localEntry(citizen,procedureId))return null;
  return records(world).find(record=>record.id===procedureId)||null;
}
function livingHolders(world,id){return (world.citizens||[]).filter(citizen=>living(world,citizen)&&localEntry(citizen,id));}
function creationCause(record){return record?.createdEventId||record?.evidenceEventId||null;}
function actionCause(world,id){
  if(!id)return null;
  const event=(world.ledger||[]).findLast(item=>item.id===id||item.type==='ACTION_STARTED'&&item.payload?.actionId===id);
  return event?.id||null;
}
function markLost(world,record,at,causeId=null){
  if(!record||record.lostWorldMinute!==null&&record.lostWorldMinute!==undefined||livingHolders(world,record.id).length)return;
  record.lostWorldMinute=at;
  appendEvent(world,'PROCEDURE_LOST','world',{procedureId:record.id,parentProcedureId:record.parentProcedureId||null},[causeId,creationCause(record)].filter(Boolean),at);
}

export function ensureProcedures(world){
  world.procedures??=[];
  if(!Array.isArray(world.procedures))throw new Error('procedure_registry_invalid');
  if(!Number.isSafeInteger(world.procedureSequence)||world.procedureSequence<0){
    world.procedureSequence=world.procedures.reduce((next,record)=>Math.max(next,Number(record.sequence)+1||0),0);
  }
  return world.procedures;
}
function requireMind(world,citizen){if(!living(world,citizen))throw new Error('procedure_citizen_unavailable');}
function requireKnown(world,citizen,id){requireMind(world,citizen);const record=knownProcedure(world,citizen,id);if(!record)throw new Error(`procedure_not_known:${id}`);return record;}
function ensureRoom(world,at){
  const registry=ensureProcedures(world);
  if(registry.length<PROCEDURE_LIMITS.records)return;
  const protectedIds=new Set();
  for(const citizen of world.citizens||[])if(living(world,citizen))for(const entry of personal(citizen))if(active(entry))protectedIds.add(entry.procedureId);
  if(registry.filter(record=>protectedIds.has(record.id)).length>=PROCEDURE_LIMITS.records)throw new Error('procedure_registry_capacity');
  while(registry.length>=PROCEDURE_LIMITS.records){
    const index=registry.findIndex(record=>!protectedIds.has(record.id)),removed=registry[index];
    appendEvent(world,'PROCEDURE_EVIDENCE_COMPACTED','world',{procedureId:removed.id,parentProcedureId:removed.parentProcedureId||null,evidenceEventId:removed.evidenceEventId||null,successCount:removed.successCount,failureCount:removed.failureCount},[creationCause(removed)].filter(Boolean),at);
    registry.splice(index,1);
  }
}

function receiptEvidence(world,receiptOrId,eventId=null){
  const id=typeof receiptOrId==='string'?receiptOrId:receiptOrId?.id;
  const wantedEventId=eventId||receiptOrId?.eventId;
  if(!id&&!wantedEventId)return null;
  const retained=(world.physicalReceipts||[]).find(receipt=>(!id||receipt.id===id)&&(!wantedEventId||receipt.eventId===wantedEventId));
  if(retained)return retained;
  const event=(world.ledger||[]).find(item=>item.type==='PHYSICAL_OPERATIONS_EXECUTED'&&(!wantedEventId||item.id===wantedEventId)&&(!id||item.payload?.id===id));
  return event?{...event.payload,eventId:event.id,eventSeq:event.seq,actorId:event.actorId,worldMinute:event.worldMinute}:null;
}
function validateReceipt(world,citizen,receipt,at,{observation=false}={}){
  requireMind(world,citizen);
  const evidence=receiptEvidence(world,receipt);
  if(!evidence||!evidence.eventId||!validatePhysicalOperations(evidence.operations).ok)throw new Error('procedure_execution_evidence_required');
  if(evidence.actorId!==citizen.id&&!(observation&&(evidence.observerIds||[]).includes(citizen.id)))throw new Error('procedure_observation_required');
  if(!Number.isFinite(Number(evidence.worldMinute))||at<evidence.worldMinute||at-evidence.worldMinute>PROCEDURE_LIMITS.observationMinutes)throw new Error('procedure_observation_expired');
  if(receipt&&typeof receipt==='object'&&receipt.operations&&canonical(receipt.operations)!==canonical(evidence.operations))throw new Error('procedure_receipt_mismatch');
  return evidence;
}
function evidenceSignature(record){return canonical([record.operations,(record.observedInputs||[]).map(input=>input.material)]);}
function receiptMatches(record,receipt){return canonical(record.operations)===canonical(receipt.operations)&&(receipt.procedureId===record.id||evidenceSignature(record)===evidenceSignature(receipt));}
function newRecord(world,citizen,operations,at,{receipt=null,parent=null,kind='experiment',causeId=null}={}){
  const validation=validatePhysicalOperations(operations);if(!validation.ok)throw new Error(validation.reason);
  ensureRoom(world,at);
  const sequence=world.procedureSequence++;
  const id=`procedure:${hash32(world.worldId).toString(16)}:${sequence.toString(36)}`;
  const sourceCause=actionCause(world,causeId)||receipt?.eventId||creationCause(parent);
  const record={id,sequence,creatorCitizenId:citizen.id,createdWorldMinute:at,parentProcedureId:parent?.id||null,operations:clone(operations),observedInputs:clone((receipt?.observedInputs||parent?.observedInputs||[]).slice(0,8)),observedOutputs:clone((receipt?.observedOutputs||[]).slice(0,12)),evidenceReceiptId:receipt?.id||null,evidenceEventId:receipt?.eventId||null,successCount:0,failureCount:0,confidence:0,provenance:[{kind,from:citizen.id,eventId:sourceCause,parentProcedureId:parent?.id||null,worldMinute:at}],recentOutcomes:[],recentLearners:[],learningCount:0,lastSuccessfulEventSeq:-1,lostWorldMinute:null};
  ensureProcedures(world).push(record);
  const event=appendEvent(world,parent?'PROCEDURE_MODIFIED':'PROCEDURE_DISCOVERED',citizen.id,{procedureId:id,parentProcedureId:parent?.id||null,operationCount:operations.length,evidenceEventId:receipt?.eventId||null},[...new Set([sourceCause,creationCause(parent)].filter(Boolean))],at);
  record.createdEventId=event.id;
  return {record,event};
}
function gainKnowledge(world,citizen,record,source,confidence,at){
  citizen.procedureKnowledge??=[];
  let entry=personal(citizen).find(item=>item.procedureId===record.id);
  if(!entry){
    if(citizen.procedureKnowledge.length>=PROCEDURE_LIMITS.personal){
      // Prefer forgotten memories, then the least confident/oldest trace.
      const ranked=citizen.procedureKnowledge.map((item,index)=>({item,index})).sort((a,b)=>Number(active(a.item))-Number(active(b.item))||Number(a.item.confidence)-Number(b.item.confidence)||Number(a.item.lastReinforcedWorldMinute)-Number(b.item.lastReinforcedWorldMinute)||a.index-b.index);
      const removed=citizen.procedureKnowledge.splice(ranked[0].index,1)[0];
      const event=appendEvent(world,'PROCEDURE_KNOWLEDGE_FORGOTTEN',citizen.id,{procedureId:removed.procedureId,reason:'memory_capacity'},[creationCause(record)].filter(Boolean),at);
      markLost(world,records(world).find(item=>item.id===removed.procedureId),at,event.id);
    }
    entry={procedureId:record.id,active:true,confidence:clamp(confidence),learnedWorldMinute:at,lastReinforcedWorldMinute:at,lastUsedWorldMinute:null,lastDecayWorldMinute:at,successCount:0,failureCount:0,provenance:[]};
    citizen.procedureKnowledge.push(entry);
    record.learningCount=Math.min(1e9,Number(record.learningCount||0)+1);
  }
  entry.confidence=Math.max(Number(entry.confidence)||0,clamp(confidence));entry.active=entry.confidence>=MIN_CONFIDENCE;entry.lastReinforcedWorldMinute=at;entry.lastDecayWorldMinute=Math.max(Number(entry.lastDecayWorldMinute)||0,at);
  boundedPush(entry.provenance,{kind:source.kind,from:source.from||null,eventId:source.eventId||null,worldMinute:at},PROCEDURE_LIMITS.provenance);
  boundedPush(record.recentLearners,{citizenId:citizen.id,from:source.from||null,eventId:source.eventId||null,worldMinute:at},PROCEDURE_LIMITS.recentLearners);
  record.lostWorldMinute=null;
  return entry;
}
function countSuccess(record,citizen,receipt,at){
  const seq=Number(receipt.eventSeq);
  if(Number.isSafeInteger(seq)&&seq<=Number(record.lastSuccessfulEventSeq??-1)||record.recentOutcomes.some(outcome=>outcome.receiptId===receipt.id))return false;
  if(Number.isSafeInteger(seq))record.lastSuccessfulEventSeq=seq;
  record.successCount=Math.min(1e9,Number(record.successCount||0)+1);
  record.confidence=(record.successCount+1)/(record.successCount+record.failureCount+2);
  record.observedOutputs=clone((receipt.observedOutputs||[]).slice(0,12));
  boundedPush(record.recentOutcomes,{ok:true,receiptId:receipt.id,eventId:receipt.eventId,worldMinute:at},PROCEDURE_LIMITS.outcomes);
  const entry=localEntry(citizen,record.id);
  if(entry){entry.successCount=Math.min(1e9,Number(entry.successCount||0)+1);entry.lastUsedWorldMinute=at;entry.lastReinforcedWorldMinute=at;entry.lastDecayWorldMinute=at;entry.confidence=Math.min(1,entry.confidence+.06);}
  return true;
}

export function rememberProcedure(world,citizen,receipt,at=world.clock.worldMinute){
  const evidence=validateReceipt(world,citizen,receipt,at);
  let record=evidence.procedureId?knownProcedure(world,citizen,evidence.procedureId):null;
  if(record&&!receiptMatches(record,evidence))throw new Error('procedure_receipt_mismatch');
  if(!record)record=records(world).find(item=>localEntry(citizen,item.id)&&evidenceSignature(item)===evidenceSignature(evidence));
  if(!record){
    const created=newRecord(world,citizen,evidence.operations,at,{receipt:evidence});record=created.record;
    gainKnowledge(world,citizen,record,{kind:'experiment',from:citizen.id,eventId:evidence.eventId},.72,at);
  }
  countSuccess(record,citizen,evidence,at);
  return record;
}

export function recordProcedureOutcome(world,citizen,procedureId,{ok=false,receipt=null,reason=null}={},at=world.clock.worldMinute){
  const record=requireKnown(world,citizen,procedureId);
  if(ok){const evidence=validateReceipt(world,citizen,receipt,at);if(!receiptMatches(record,evidence))throw new Error('procedure_receipt_mismatch');countSuccess(record,citizen,evidence,at);return record;}
  record.failureCount=Math.min(1e9,Number(record.failureCount||0)+1);record.confidence=(record.successCount+1)/(record.successCount+record.failureCount+2);
  const event=appendEvent(world,'PROCEDURE_FAILED',citizen.id,{procedureId,reason:String(reason||'physical_attempt_rejected').slice(0,96)},[creationCause(record)].filter(Boolean),at);
  boundedPush(record.recentOutcomes,{ok:false,eventId:event.id,worldMinute:at},PROCEDURE_LIMITS.outcomes);
  const entry=localEntry(citizen,procedureId);entry.failureCount=Math.min(1e9,Number(entry.failureCount||0)+1);entry.lastUsedWorldMinute=at;entry.confidence*=.92;
  if(!active(entry)){entry.active=false;markLost(world,record,at,event.id);}
  return record;
}

export function learnProcedure(world,learner,procedureId,{kind='observation',from=null,eventId=null,confidence=.6}={},at=world.clock.worldMinute){
  requireMind(world,learner);
  const record=records(world).find(item=>item.id===procedureId);if(!record)throw new Error('procedure_not_found');
  if(!['observation','imitation','teaching'].includes(kind))throw new Error('procedure_learning_source_invalid');
  let sourceId=from,evidenceId=eventId,sourceConfidence=1;
  if(kind==='observation'){
    const evidence=validateReceipt(world,learner,receiptEvidence(world,null,eventId),at,{observation:true});
    if(!receiptMatches(record,evidence))throw new Error('procedure_observation_mismatch');
    sourceId=evidence.actorId;evidenceId=evidence.eventId;
  }else{
    const source=(world.citizens||[]).find(citizen=>citizen.id===from);
    if(!source||source.id===learner.id||!knownProcedure(world,source,procedureId))throw new Error('procedure_source_unavailable');
    if(!close(source,learner,kind==='teaching'?2.5:8))throw new Error('procedure_source_not_nearby');
    sourceConfidence=localEntry(source,procedureId).confidence;
  }
  if(kind!=='observation')evidenceId=actionCause(world,evidenceId);
  const event=appendEvent(world,'PROCEDURE_LEARNED',learner.id,{procedureId,kind,from:sourceId,evidenceEventId:evidenceId},[evidenceId||creationCause(record)].filter(Boolean),at);
  gainKnowledge(world,learner,record,{kind,from:sourceId,eventId:event.id},Math.min(clamp(confidence),sourceConfidence*(kind==='observation'?.9:.82)),at);
  return record;
}

function imperfectOperations(parent,sender,receiver,actionId,at){
  const operations=clone(parent.operations),seed=hash32(`${parent.id}|${sender.id}|${receiver.id}|${actionId||at}`),index=seed%operations.length,op=operations[index];
  // Copy errors change bounded physical parameters or omit a step. They never
  // introduce an executable instruction or an unavailable physical primitive.
  const key=['workJ','forceN','heatJ','quantity','angle'].find(name=>Number.isFinite(op[name])&&op[name]!==0);
  if(key)op[key]=Number((op[key]*(seed&1?.9:1.1)).toPrecision(8));
  else if(operations.length>1)operations.splice(index,1);
  else if(op.toPosition)op.toPosition.x=Number((op.toPosition.x+(seed&1?.1:-.1)).toPrecision(8));
  else op.workJ=1;
  if(!validatePhysicalOperations(operations).ok){
    // A numeric parameter at its validator limit can only be reduced safely.
    if(key)op[key]=parent.operations[index][key]*.9;
    if(!validatePhysicalOperations(operations).ok)throw new Error('procedure_copy_invalid');
  }
  return operations;
}
function recallForTeaching(sender,procedureId,at){
  const entry=localEntry(sender,procedureId);
  entry.lastUsedWorldMinute=at;entry.lastReinforcedWorldMinute=at;entry.lastDecayWorldMinute=at;
}

export function teachProcedure(world,sender,receiver,procedureId,{actionId=null,imperfect=false}={},at=world.clock.worldMinute){
  const parent=requireKnown(world,sender,procedureId);requireMind(world,receiver);
  if(sender.id===receiver.id)throw new Error('procedure_receiver_invalid');
  if(!close(sender,receiver,2.5))throw new Error('procedure_source_not_nearby');
  if(!imperfect){
    const event=appendEvent(world,'PROCEDURE_TRANSMITTED',sender.id,{procedureId,receiverId:receiver.id,receiverProcedureId:procedureId,actionId,imperfect:false},[actionCause(world,actionId),creationCause(parent)].filter(Boolean),at);
    const taught=learnProcedure(world,receiver,procedureId,{kind:'teaching',from:sender.id,eventId:event.id,confidence:localEntry(sender,procedureId).confidence*.82},at);
    recallForTeaching(sender,procedureId,at);
    return taught;
  }
  const operations=imperfectOperations(parent,sender,receiver,actionId,at);
  const {record,event}=newRecord(world,receiver,operations,at,{parent,kind:'imperfect_copy',causeId:actionId});
  const transmitted=appendEvent(world,'PROCEDURE_TRANSMITTED',sender.id,{procedureId,receiverId:receiver.id,receiverProcedureId:record.id,actionId,imperfect:true},[...new Set([actionCause(world,actionId),event.id,creationCause(parent)].filter(Boolean))],at);
  gainKnowledge(world,receiver,record,{kind:'imperfect_copy',from:sender.id,eventId:transmitted.id},Math.max(MIN_CONFIDENCE,localEntry(sender,procedureId).confidence*.65),at);
  recallForTeaching(sender,procedureId,at);
  return record;
}

export function modifyProcedure(world,citizen,parentId,operations,at=world.clock.worldMinute){
  const parent=requireKnown(world,citizen,parentId);
  const {record,event}=newRecord(world,citizen,operations,at,{parent,kind:'hypothesis',causeId:creationCause(parent)});
  gainKnowledge(world,citizen,record,{kind:'hypothesis',from:citizen.id,eventId:event.id},Math.max(MIN_CONFIDENCE,localEntry(citizen,parentId).confidence*.7),at);
  return record;
}

export function forgetCitizenProcedures(world,citizen,at=world.clock.worldMinute,causeId=null){
  if(citizen.alive)throw new Error('procedure_death_required');
  const ids=personal(citizen).filter(active).map(entry=>entry.procedureId);
  for(const entry of personal(citizen))entry.active=false;
  for(const id of ids)markLost(world,records(world).find(record=>record.id===id),at,actionCause(world,causeId));
  return ids.length;
}

export function decayProcedureKnowledge(world,from,to){
  const boundary=Math.floor(Number(to)/PROCEDURE_LIMITS.decayIntervalMinutes)*PROCEDURE_LIMITS.decayIntervalMinutes;
  const last=Number(world.procedureDecayWorldMinute??Math.floor(Number(from)/PROCEDURE_LIMITS.decayIntervalMinutes)*PROCEDURE_LIMITS.decayIntervalMinutes);
  if(!Number.isFinite(boundary)||boundary<=last)return 0;
  world.procedureDecayWorldMinute=boundary;
  let forgotten=0;
  for(const citizen of world.citizens||[]){
    if(!living(world,citizen))continue;
    for(const entry of personal(citizen)){
      if(!active(entry))continue;
      const elapsed=Math.max(0,boundary-Math.max(Number(entry.lastDecayWorldMinute??last),Number(entry.lastReinforcedWorldMinute??last)))/PROCEDURE_LIMITS.decayIntervalMinutes;
      entry.confidence*=Math.pow(.9975,elapsed);entry.lastDecayWorldMinute=boundary;
      if(!active(entry)){
        entry.active=false;forgotten++;
        const record=records(world).find(item=>item.id===entry.procedureId);
        const event=appendEvent(world,'PROCEDURE_KNOWLEDGE_FORGOTTEN',citizen.id,{procedureId:entry.procedureId,reason:'memory_decay'},[creationCause(record)].filter(Boolean),boundary);
        markLost(world,record,boundary,event.id);
      }
    }
  }
  return forgotten;
}

export function procedureSummary(world,citizen){
  return personal(citizen).slice(-PROCEDURE_LIMITS.personal).map(entry=>{
    const record=records(world).find(item=>item.id===entry.procedureId);
    return {id:entry.procedureId,active:Boolean(living(world,citizen)&&active(entry)&&record),confidence:Number(entry.confidence)||0,operationCount:record?.operations?.length||0,parentProcedureId:record?.parentProcedureId||null,creatorCitizenId:record?.creatorCitizenId||null,createdWorldMinute:record?.createdWorldMinute??null,createdEventId:record?.createdEventId||null,evidenceEventId:record?.evidenceEventId||null,successCount:Number(entry.successCount)||0,failureCount:Number(entry.failureCount)||0,lastUsedWorldMinute:entry.lastUsedWorldMinute??null,provenance:clone((entry.provenance||[]).slice(-PROCEDURE_LIMITS.provenance))};
  });
}

export function procedureProposal(world,citizen,at=world.clock.worldMinute){
  if(!living(world,citizen))return null;
  const entries=personal(citizen).filter(active).slice(-PROCEDURE_LIMITS.personal).sort((a,b)=>b.confidence-a.confidence||String(a.procedureId).localeCompare(String(b.procedureId)));
  // Repeated practice may prompt a local demonstration. The deterministic
  // sparse cadence avoids replacing every other affordance with instruction.
  if(hash32(`${citizen.id}|${Math.floor(at/120)}`)%4===0){
    for(const entry of entries){
      if(Number(entry.successCount)<2||entry.lastUsedWorldMinute!==null&&entry.lastUsedWorldMinute!==undefined&&at-entry.lastUsedWorldMinute<120)continue;
      if(!knownProcedure(world,citizen,entry.procedureId))continue;
      const receiver=(world.citizens||[]).find(other=>other.id!==citizen.id&&living(world,other)&&(citizen.knownEntityIds||[]).includes(other.id)&&close(citizen,other,2.5)&&!localEntry(other,entry.procedureId));
      if(receiver)return {source:'personal-procedure',affordanceFamily:'procedure-teach',concepts:[],actions:[{type:'TEACH',durationMinutes:12,targetId:receiver.id,purpose:'communicate',concepts:[],payload:{procedureId:entry.procedureId}}]};
    }
  }
  const held=(world.objects||[]).filter(object=>object.holderId===citizen.id&&object.quantity>0).slice(0,64);
  for(const entry of entries){
    if(entry.lastUsedWorldMinute!==null&&entry.lastUsedWorldMinute!==undefined&&at-entry.lastUsedWorldMinute<120)continue;
    const record=knownProcedure(world,citizen,entry.procedureId);if(!record||!record.observedInputs?.length)continue;
    const selected=[];
    for(const input of record.observedInputs.slice(0,8)){
      const object=held.find(candidate=>!selected.includes(candidate.id)&&candidate.material===input.material);
      if(!object)break;selected.push(object.id);
    }
    if(selected.length!==record.observedInputs.length)continue;
    return {source:'personal-procedure',affordanceFamily:'procedure-run',concepts:[],actions:[{type:'EXPERIMENT',durationMinutes:20,purpose:'self_directed',concepts:[],payload:{procedureId:record.id,inputObjectIds:selected}}]};
  }
  return null;
}
