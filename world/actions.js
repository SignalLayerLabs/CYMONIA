import {ACTION_TYPES} from './constants.js';
import {stableId} from './rng.js';
import {appendEvent} from './ledger.js';
import {restoreSleep} from './biology.js';
import {travelProfile,resolveAccessibleTarget} from './terrain.js';

export function startAction(world,citizen,spec,at=world.clock.worldMinute){
  if(!citizen.alive)throw new Error('citizen_dead');
  if(citizen.currentActionId)throw new Error('citizen_busy');
  if(!ACTION_TYPES.has(spec.type))throw new Error('action_type_invalid');
  let targetPosition=spec.targetPosition?{x:Number(spec.targetPosition.x),y:Number(spec.targetPosition.y)}:null,physics=null;
  let duration=Math.max(1,Math.ceil(Number(spec.durationMinutes)||1));
  if(spec.type==='MOVE'&&targetPosition){
    targetPosition=resolveAccessibleTarget(world,citizen,targetPosition,spec.targetId||null);
    physics=travelProfile(world,citizen,targetPosition,{targetId:spec.targetId||null});
    duration=Math.max(duration,physics.minimumMinutes);
    targetPosition={...physics.targetPosition};
  }
  const action={id:stableId('act',world.worldId,citizen.id,world.actions.length,at,spec.type),actorId:citizen.id,type:spec.type,status:'active',purpose:spec.purpose||null,planId:spec.planId||null,startedWorldMinute:at,endsWorldMinute:at+duration,fromPosition:{...citizen.position},targetPosition,targetId:spec.targetId||null,concepts:[...(spec.concepts||[])],payload:spec.payload||{},reservedObjectIds:[...(spec.reservedObjectIds||[])],physics,path:physics?.path||null};
  world.actions.push(action);citizen.currentActionId=action.id;
  appendEvent(world,'ACTION_STARTED',citizen.id,{actionId:action.id,type:action.type,planId:action.planId,endsWorldMinute:action.endsWorldMinute,physics:physics?{distance:physics.distance,minimumMinutes:physics.minimumMinutes,averageTerrainCost:physics.averageTerrainCost,loadKg:physics.loadKg,loadFactor:physics.loadFactor,physicalCapacity:physics.physicalCapacity,capabilityFactor:physics.capabilityFactor,weatherFactor:physics.weatherFactor,terrainKinds:physics.terrainKinds}:null},[],at);
  return action;
}
export function positionAt(citizen,action,worldMinute){if(!action||action.type!=='MOVE'||!action.targetPosition)return {...citizen.position};const span=Math.max(1,action.endsWorldMinute-action.startedWorldMinute),t=Math.max(0,Math.min(1,(worldMinute-action.startedWorldMinute)/span)),path=Array.isArray(action.path)&&action.path.length>=2?action.path:[action.fromPosition,action.targetPosition];let total=0;const lengths=[];for(let i=0;i<path.length-1;i++){const d=Math.hypot(path[i+1].x-path[i].x,path[i+1].y-path[i].y);lengths.push(d);total+=d;}if(total<=0)return {...action.targetPosition};let remaining=t*total;for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]||i===lengths.length-1){const u=lengths[i]?Math.max(0,Math.min(1,remaining/lengths[i])):1;return{x:path[i].x+(path[i+1].x-path[i].x)*u,y:path[i].y+(path[i+1].y-path[i].y)*u};}remaining-=lengths[i];}return {...action.targetPosition};}
function complete(world,action,at){const c=world.citizens.find(x=>x.id===action.actorId);if(!c||!c.alive){action.status='cancelled';return false;}if(action.type==='MOVE'&&action.targetPosition)c.position={...action.targetPosition};else if(action.type==='SLEEP')restoreSleep(c,55);action.status='completed';c.currentActionId=null;appendEvent(world,'ACTION_COMPLETED',c.id,{actionId:action.id,type:action.type,planId:action.planId},[],at);return true;}
export function completeDueActions(world,throughMinute){const completed=[];for(const a of world.actions){if(a.status==='active'&&a.endsWorldMinute<=throughMinute&&complete(world,a,a.endsWorldMinute))completed.push(a);}return completed;}
export function interruptAction(world,citizen,reason='replan',at=world.clock.worldMinute){const a=activeAction(world,citizen);if(!a)return null;a.status='interrupted';citizen.position=positionAt(citizen,a,at);citizen.currentActionId=null;appendEvent(world,'ACTION_INTERRUPTED',citizen.id,{actionId:a.id,reason},[],at);return a;}
export function activeAction(world,citizen){return citizen.currentActionId?world.actions.find(a=>a.id===citizen.currentActionId&&a.status==='active')||null:null;}
