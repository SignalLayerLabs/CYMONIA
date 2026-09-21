import {ACTION_TYPES} from './constants.js';
import {knows} from './epistemics.js';
import {appendEvent} from './ledger.js';
import {markAICognition} from './cognition-state.js';

const INTENTS=new Set(['explore','understand','share','cooperate','care','construct','adapt']);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const strings=(value,limit)=>Array.isArray(value)?[...new Set(value.map(String).filter(Boolean))].slice(0,limit):[];

export function sanitizeAIStrategy(raw){
  const value=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const intent=INTENTS.has(value.intent)?value.intent:'adapt';
  return {
    focus:value.focus?String(value.focus):null,
    intent,
    actionBias:strings(value.actionBias,8).map(action=>action.toUpperCase()).filter(action=>ACTION_TYPES.has(action)),
    partnerIds:strings(value.partnerIds,6),
    successSignals:strings(value.successSignals,8),
    horizonMinutes:Math.round(clamp(value.horizonMinutes||4320,60,10080)),
    confidence:clamp(value.confidence??.5,0,1),
  };
}

export function validateStrategy(world,citizen,strategy){
  if(!strategy||typeof strategy!=='object')return {ok:false,reason:'strategy_invalid'};
  if(!INTENTS.has(strategy.intent))return {ok:false,reason:'strategy_intent_invalid'};
  if(!Number.isFinite(Number(strategy.horizonMinutes))||strategy.horizonMinutes<60||strategy.horizonMinutes>10080)return {ok:false,reason:'strategy_horizon_invalid'};
  if(!Number.isFinite(Number(strategy.confidence))||strategy.confidence<0||strategy.confidence>1)return {ok:false,reason:'strategy_confidence_invalid'};
  for(const action of strategy.actionBias||[])if(!ACTION_TYPES.has(action))return {ok:false,reason:`strategy_action_invalid:${action}`};
  for(const concept of [strategy.focus,...(strategy.successSignals||[])].filter(Boolean))if(!knows(citizen,concept))return {ok:false,reason:`unknown_concept:${concept}`};
  for(const partnerId of strategy.partnerIds||[]){
    if(!citizen.knownEntityIds.includes(partnerId))return {ok:false,reason:`unknown_partner:${partnerId}`};
    if(!world.citizens.some(other=>other.id===partnerId&&other.alive))return {ok:false,reason:`partner_unavailable:${partnerId}`};
  }
  return {ok:true};
}

function closeStrategy(world,citizen,reason,at){
  const strategy=citizen.activeGoal;
  if(!strategy||strategy.kind!=='strategy-v1')return null;
  citizen.activeGoal=null;
  if(world)appendEvent(world,'STRATEGY_CLOSED',citizen.id,{reason,intent:strategy.intent,focus:strategy.focus||null,completedActions:Number(strategy.progress?.completedActions)||0},[],at);
  return null;
}

export function activeStrategy(citizen,at=0,world=null){
  const strategy=citizen?.activeGoal;
  if(!strategy||strategy.kind!=='strategy-v1')return null;
  if(Number(strategy.expiresWorldMinute)<=Number(at))return closeStrategy(world,citizen,'expired',at);
  if(world){const validation=validateStrategy(world,citizen,strategy,at);if(!validation.ok)return closeStrategy(world,citizen,validation.reason,at);}
  return strategy;
}

export function acceptAIStrategy(world,citizenId,strategy,at=world.clock.worldMinute){
  const citizen=world.citizens.find(item=>item.id===citizenId&&item.alive);
  if(!citizen)throw new Error('citizen_unavailable');
  const clean=sanitizeAIStrategy(strategy),validation=validateStrategy(world,citizen,clean,at);
  if(!validation.ok)throw new Error(validation.reason);
  citizen.activeGoal={kind:'strategy-v1',...clean,source:'workers-ai',createdWorldMinute:at,expiresWorldMinute:at+clean.horizonMinutes,status:'active',progress:{completedActions:0,successfulFamilies:{}},failureCount:0};
  markAICognition(citizen,at);
  appendEvent(world,'STRATEGY_ACCEPTED',citizen.id,{intent:clean.intent,focus:clean.focus,actionBias:clean.actionBias,horizonMinutes:clean.horizonMinutes,confidence:clean.confidence},[],at);
  return citizen.activeGoal;
}

export function recordStrategyOutcome(world,citizen,result={},at=world.clock.worldMinute){
  const strategy=activeStrategy(citizen,at,world);
  if(!strategy)return null;
  if(result.ok){
    strategy.progress.completedActions=Math.min(100000,Number(strategy.progress.completedActions||0)+1);
    const family=String(result.family||'other').slice(0,48),families=strategy.progress.successfulFamilies;
    families[family]=Math.min(10000,Number(families[family]||0)+1);
    strategy.failureCount=Math.max(0,Number(strategy.failureCount||0)-1);
  }else{
    strategy.failureCount=Math.min(3,Number(strategy.failureCount||0)+1);
    if(strategy.failureCount>=3)return closeStrategy(world,citizen,'repeated_failure',at);
  }
  strategy.progress.lastWorldMinute=at;
  return strategy;
}
