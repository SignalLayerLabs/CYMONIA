import {ensureCognitionState} from './cognition-state.js';

const MAX_OCCURRENCES=32;
const MAX_EVENT_IDS=8;
const MAX_QUEUE_ENTRIES=512;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));

const LOCAL_REASONS=new Set(['plan_completed','encounter','routine','routine_reflection']);
const EMERGENCY_REASONS=new Set(['human_direction','immediate_danger','danger']);
const PRIORITY_REASONS=new Map([
  ['novelty_unresolved',.28],
  ['physical_action_failed',.34],
  ['action_failure',.34],
  ['new_concept',.3],
  ['experiment_success',.36],
  ['relationship_threshold_change',.24],
  ['conflict',.45],
  ['care_event',.3],
  ['reproduction',.38],
  ['birth',.4],
  ['construction_completed',.42],
  ['material_event',.24],
  ['arrival',.3],
]);
const STANDARD_BONUSES=new Map([
  ['discovery',.18],
  ['genesis_awareness',.12],
  ['reflection',.1],
]);

export function classifyCognitionReason(reason){
  const key=String(reason||'novelty_unresolved');
  if(LOCAL_REASONS.has(key))return {tier:2,bonus:0,reserve:'local'};
  if(EMERGENCY_REASONS.has(key))return {tier:3,bonus:.55,reserve:'emergency'};
  if(PRIORITY_REASONS.has(key))return {tier:3,bonus:PRIORITY_REASONS.get(key),reserve:'priority'};
  return {tier:3,bonus:STANDARD_BONUSES.get(key)??.08,reserve:'standard'};
}

function normalizeEventIds(value){
  if(!Array.isArray(value))return [];
  return [...new Set(value.map(String).filter(Boolean))].slice(-MAX_EVENT_IDS);
}

function normalizeEntry(entry,at=0){
  const reason=String(entry?.reason||'novelty_unresolved').slice(0,64);
  const classification=classifyCognitionReason(reason);
  const first=Number.isFinite(Number(entry?.firstQueuedWorldMinute))?Number(entry.firstQueuedWorldMinute):Number(at)||0;
  const last=Number.isFinite(Number(entry?.lastQueuedWorldMinute))?Number(entry.lastQueuedWorldMinute):first;
  return {
    citizenId:String(entry?.citizenId||''),
    reason,
    basePriority:clamp(entry?.basePriority??entry?.priority??.45,0,1),
    tier:classification.tier,
    reserve:classification.reserve,
    bonus:classification.bonus,
    occurrences:Math.max(1,Math.min(MAX_OCCURRENCES,Math.floor(Number(entry?.occurrences)||1))),
    firstQueuedWorldMinute:first,
    lastQueuedWorldMinute:last,
    eventIds:normalizeEventIds(entry?.eventIds),
    retryAfterWorldMinute:Number.isFinite(Number(entry?.retryAfterWorldMinute))?Number(entry.retryAfterWorldMinute):null,
    queued:true,
  };
}

function normalizeQueue(world,at=0){
  world.cognitionQueue=Array.isArray(world.cognitionQueue)?world.cognitionQueue:[];
  const merged=new Map();
  for(const raw of world.cognitionQueue){
    const entry=normalizeEntry(raw,at);
    if(!entry.citizenId||entry.tier<3)continue;
    const key=`${entry.citizenId}\u0000${entry.reason}`;
    const prior=merged.get(key);
    if(!prior){merged.set(key,entry);continue;}
    prior.basePriority=Math.max(prior.basePriority,entry.basePriority);
    prior.occurrences=Math.min(MAX_OCCURRENCES,prior.occurrences+entry.occurrences);
    prior.firstQueuedWorldMinute=Math.min(prior.firstQueuedWorldMinute,entry.firstQueuedWorldMinute);
    prior.lastQueuedWorldMinute=Math.max(prior.lastQueuedWorldMinute,entry.lastQueuedWorldMinute);
    prior.eventIds=normalizeEventIds([...prior.eventIds,...entry.eventIds]);
    if(entry.retryAfterWorldMinute!==null)prior.retryAfterWorldMinute=Math.max(prior.retryAfterWorldMinute??0,entry.retryAfterWorldMinute);
  }
  world.cognitionQueue=[...merged.values()];
  return world.cognitionQueue;
}

export function queueCognition(world,citizen,reason,basePriority=.45,at=world.clock?.worldMinute??0,eventId=null,options={}){
  const classification=classifyCognitionReason(reason);
  const local={citizenId:citizen?.id||null,reason:String(reason||'novelty_unresolved'),basePriority:clamp(basePriority,0,1),...classification,queued:false};
  if(!citizen?.alive||classification.tier<3)return local;
  const queue=normalizeQueue(world,at),keyReason=local.reason.slice(0,64);
  let entry=queue.find(item=>item.citizenId===citizen.id&&item.reason===keyReason);
  if(entry){
    entry.basePriority=Math.max(entry.basePriority,local.basePriority);
    entry.occurrences=Math.min(MAX_OCCURRENCES,entry.occurrences+1);
    entry.lastQueuedWorldMinute=Number(at)||0;
    if(eventId)entry.eventIds=normalizeEventIds([...entry.eventIds,String(eventId)]);
    if(options.retryAfterWorldMinute!==undefined)entry.retryAfterWorldMinute=Number(options.retryAfterWorldMinute)||null;
  }else{
    entry=normalizeEntry({citizenId:citizen.id,reason:keyReason,basePriority:local.basePriority,occurrences:1,firstQueuedWorldMinute:at,lastQueuedWorldMinute:at,eventIds:eventId?[String(eventId)]:[],retryAfterWorldMinute:options.retryAfterWorldMinute},at);
    queue.push(entry);
  }
  if(queue.length>MAX_QUEUE_ENTRIES){
    queue.sort((a,b)=>b.lastQueuedWorldMinute-a.lastQueuedWorldMinute||b.basePriority-a.basePriority);
    queue.length=MAX_QUEUE_ENTRIES;
  }
  citizen.cognition??={lastReflectionMinute:null,pending:true,reason:keyReason};
  citizen.cognition.pending=true;
  citizen.cognition.reason=keyReason;
  return entry;
}

function entryScore(world,entry,at){
  const citizen=world.citizens.find(item=>item.id===entry.citizenId&&item.alive);
  if(!citizen)return -Infinity;
  const state=ensureCognitionState(citizen,at);
  const debt=clamp(state.cognitionDebt,0,1);
  const occurrences=Math.min(.12,Math.log2(entry.occurrences+1)*.03);
  const lastAI=state.lastAICognitionMinute;
  const elapsed=lastAI===null?Infinity:Math.max(0,Number(at)-Number(lastAI));
  const recentPenalty=Number.isFinite(elapsed) ? .85*Math.exp(-elapsed/2880) : 0;
  const strategy=citizen.activeGoal;
  const strategyRemaining=strategy?.kind==='strategy-v1'?Number(strategy.expiresWorldMinute||0)-Number(at):0;
  const strategyPenalty=strategyRemaining>720&&Number(strategy.failureCount||0)<2?.3:0;
  return entry.basePriority+entry.bonus+debt*.9+occurrences-recentPenalty-strategyPenalty;
}

export function rankCognitionQueue(world,at=world.clock?.worldMinute??0){
  const queue=normalizeQueue(world,at).filter(entry=>{
    const alive=world.citizens.some(citizen=>citizen.id===entry.citizenId&&citizen.alive);
    const ready=entry.retryAfterWorldMinute===null||entry.retryAfterWorldMinute<=Number(at);
    return alive&&ready;
  });
  return queue.sort((a,b)=>entryScore(world,b,at)-entryScore(world,a,at)||a.firstQueuedWorldMinute-b.firstQueuedWorldMinute||a.citizenId.localeCompare(b.citizenId)||a.reason.localeCompare(b.reason));
}

function allowed(entry,phase){
  if(phase===null||phase===undefined||phase===3||phase==='standard')return entry.tier===3;
  if(phase==='priority')return entry.reserve==='priority';
  if(phase==='emergency')return entry.reserve==='emergency';
  return false;
}

export function takeCognitionCandidate(world,at=world.clock?.worldMinute??0,allowedTier='standard'){
  const entry=rankCognitionQueue(world,at).find(item=>allowed(item,allowedTier));
  if(!entry)return null;
  const index=world.cognitionQueue.indexOf(entry);
  if(index>=0)world.cognitionQueue.splice(index,1);
  const citizen=world.citizens.find(item=>item.id===entry.citizenId);
  if(citizen?.cognition)citizen.cognition.pending=world.cognitionQueue.some(item=>item.citizenId===entry.citizenId);
  return entry;
}
