import {validatePhysicalOperations} from './physical-operations.js';
import {knownProcedure} from './procedures.js';

export const PHYSICAL_ACTION_TYPES=new Set(['EXPERIMENT','CUT','DIG','HEAT','COOL','MIX','ASSEMBLE']);
export function hasPhysicalPayload(action){return PHYSICAL_ACTION_TYPES.has(action?.type)&&Boolean(action.payload?.operations||action.payload?.procedureId||action.payload?.variantOfProcedureId);}

export function validatePhysicalAction(world,citizen,action){
  const p=action.payload||{};
  if(p.procedureId&&!knownProcedure(world,citizen,p.procedureId))return {ok:false,reason:'procedure_not_known'};
  if(p.variantOfProcedureId&&!knownProcedure(world,citizen,p.variantOfProcedureId))return {ok:false,reason:'procedure_parent_not_known'};
  if(!hasPhysicalPayload(action))return {ok:true};
  if(!Array.isArray(p.inputObjectIds)||!p.inputObjectIds.length||p.inputObjectIds.length>8||new Set(p.inputObjectIds).size!==p.inputObjectIds.length)return {ok:false,reason:'physical_inputs_invalid'};
  for(const id of p.inputObjectIds){
    const object=world.objects.find(o=>o.id===id&&o.quantity>0&&!o.reservedProjectId);
    if(!object||!(citizen.knownEntityIds||[]).includes(id))return {ok:false,reason:'physical_input_not_known_or_held'};
    let root=object;const visited=new Set();
    while(root.geometry?.containedById||root.geometry?.supportedById){
      if(visited.has(root.id)||visited.size>=8)return {ok:false,reason:'physical_attachment_cycle'};
      visited.add(root.id);
      const parentId=root.geometry.containedById||root.geometry.supportedById;
      if(!p.inputObjectIds.includes(parentId))return {ok:false,reason:'physical_attachment_not_bound'};
      root=world.objects.find(o=>o.id===parentId&&o.quantity>0&&!o.reservedProjectId);
      if(!root)return {ok:false,reason:'physical_attachment_unavailable'};
    }
    if(root.holderId!==citizen.id&&(root.holderId!=null||!root.position||Math.hypot(root.position.x-citizen.position.x,root.position.y-citizen.position.y)>2.5))return {ok:false,reason:'physical_input_not_known_or_held'};
  }
  const record=p.procedureId?knownProcedure(world,citizen,p.procedureId):null;
  if(p.procedureId&&p.operations)return {ok:false,reason:'physical_procedure_steps_override'};
  return validatePhysicalOperations(record?.operations||p.operations);
}

export function physicalActionView(world,citizen,action,at){
  if(!hasPhysicalPayload(action))return {procedureId:null,physicalOperation:null};
  const p=action.payload,operations=p.operations||knownProcedure(world,citizen,p.procedureId)?.operations||[];
  const progress=Math.max(0,Math.min(.999,(at-action.startedWorldMinute)/Math.max(1,action.endsWorldMinute-action.startedWorldMinute)));
  const index=Math.min(operations.length-1,Math.floor(progress*operations.length)),op=operations[index];
  return {procedureId:p.procedureId||null,variantOfProcedureId:p.variantOfProcedureId||null,physicalOperation:op?{primitive:op.primitive,targetId:p.inputObjectIds?.[op.target]||null,sourceId:p.inputObjectIds?.[op.source]||null,toolId:p.inputObjectIds?.[op.tool]||null,stepIndex:index,stepCount:operations.length}:null};
}

// Preserve the old action ABI while expanding the cognition data language.
export function cleanPhysicalPayload(payload={}){
  const out={};
  if(payload.procedureId)out.procedureId=String(payload.procedureId).slice(0,160);
  if(payload.variantOfProcedureId)out.variantOfProcedureId=String(payload.variantOfProcedureId).slice(0,160);
  if(payload.operations!==undefined){
    const check=validatePhysicalOperations(payload.operations);
    out.operations=check.ok?structuredClone(payload.operations):[{primitive:'invalid',target:0}];
  }
  if(out.procedureId||out.variantOfProcedureId||out.operations)out.inputObjectIds=Array.isArray(payload.inputObjectIds)?payload.inputObjectIds.map(String).slice(0,9):[];
  return out;
}
