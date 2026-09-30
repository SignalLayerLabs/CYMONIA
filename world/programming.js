import {appendEvent} from './ledger.js';
import {stableId} from './rng.js';
import {strongestGrievance} from './destruction.js';

const ALLOWED_STEPS=new Set(['OBSERVE','REST','GATHER','CARE','COMMUNICATE','TRANSFER','EXPERIMENT','PICKUP','DROP','REPAIR','DISMANTLE','DESTROY']);
const ALLOWED_SELECTORS=new Set(['self','nearest_known_resource','nearest_known_structure','nearest_damaged_structure','nearest_known_citizen','grievance_actor','loose_known_object','held_object']);
const ALLOWED_TRIGGERS=new Set(['always','resource_known','high_sleep','low_hydration','low_calories','rain','damaged_structure','grievance','loose_object','near_citizen']);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

export function ensurePrograms(citizen){
  citizen.programs??=[];
  if(citizen.programs.length>16)citizen.programs=citizen.programs.slice(-16);
  return citizen.programs;
}
function cleanStep(raw={}){
  const type=String(raw.type||'OBSERVE').toUpperCase();
  return {
    type:ALLOWED_STEPS.has(type)?type:'OBSERVE',
    selector:ALLOWED_SELECTORS.has(raw.selector)?raw.selector:'self',
    resourceType:['water','food','timber','stone','clay','ore'].includes(raw.resourceType)?raw.resourceType:null,
    signal:['attention','danger','need','point','accept','reject'].includes(raw.signal)?raw.signal:'attention',
  };
}
export function sanitizeProgramSpec(raw={}){
  const triggerKind=ALLOWED_TRIGGERS.has(raw?.trigger?.kind)?raw.trigger.kind:'always';
  return {
    name:String(raw.name||'routine').slice(0,48),
    trigger:{kind:triggerKind,threshold:clamp(raw?.trigger?.threshold??.5,0,1)},
    cooldownMinutes:Math.round(clamp(raw.cooldownMinutes||120,30,1440)),
    steps:(Array.isArray(raw.steps)?raw.steps:[]).slice(0,6).map(cleanStep),
    sourceFamily:raw.sourceFamily?String(raw.sourceFamily).slice(0,32):null,
  };
}
export function validateProgramSpec(spec){
  if(!spec||typeof spec!=='object'||!Array.isArray(spec.steps)||!spec.steps.length)return {ok:false,reason:'program_steps_required'};
  if(!ALLOWED_TRIGGERS.has(spec.trigger?.kind))return {ok:false,reason:'program_trigger_invalid'};
  for(const step of spec.steps){
    if(!ALLOWED_STEPS.has(step.type))return {ok:false,reason:`program_step_invalid:${step.type}`};
    if(!ALLOWED_SELECTORS.has(step.selector))return {ok:false,reason:`program_selector_invalid:${step.selector}`};
  }
  return {ok:true};
}
export function createCitizenProgram(world,citizen,raw,at=world.clock.worldMinute,source='self'){
  const spec=sanitizeProgramSpec(raw),validation=validateProgramSpec(spec);
  if(!validation.ok)throw new Error(validation.reason);
  const programs=ensurePrograms(citizen);
  if(spec.sourceFamily&&programs.some(p=>p.sourceFamily===spec.sourceFamily&&p.enabled!==false))return programs.find(p=>p.sourceFamily===spec.sourceFamily&&p.enabled!==false);
  const program={id:stableId('program',citizen.id,programs.length,at,spec.name),...spec,source,enabled:true,createdWorldMinute:at,lastRunWorldMinute:null,runCount:0};
  programs.push(program);
  if(programs.length>16)programs.splice(0,programs.length-16);
  appendEvent(world,'PROGRAM_CREATED',citizen.id,{programId:program.id,name:program.name,trigger:program.trigger,stepTypes:program.steps.map(s=>s.type),source},[],at);
  return program;
}
function known(citizen,id){return (citizen.knownEntityIds||[]).includes(id);}
function nearest(items,citizen,posOf=x=>x.position){
  return items.filter(Boolean).sort((a,b)=>dist(citizen.position,posOf(a))-dist(citizen.position,posOf(b)))[0]||null;
}
function resolveSelector(world,citizen,step,at){
  if(step.selector==='self')return {id:citizen.id,position:citizen.position,entity:citizen};
  if(step.selector==='nearest_known_resource'){
    const ds=(world.resourceDeposits||[]).filter(d=>d.quantity>0&&known(citizen,d.id)&&(!step.resourceType||d.type===step.resourceType));
    const d=nearest(ds,citizen);return d?{id:d.id,position:d.position,entity:d}:null;
  }
  if(step.selector==='nearest_known_structure'||step.selector==='nearest_damaged_structure'){
    let xs=[...(world.buildings||[]),...(world.objects||[]).filter(o=>o.kind==='temporary_shelter'&&o.quantity>0)]
      .filter(x=>x.position&&known(citizen,x.id)&&Number(x.condition??1)>0);
    if(step.selector==='nearest_damaged_structure')xs=xs.filter(x=>Number(x.condition??1)<.82);
    const x=nearest(xs,citizen);return x?{id:x.id,position:x.position,entity:x}:null;
  }
  if(step.selector==='nearest_known_citizen'){
    const xs=(world.citizens||[]).filter(c=>c.alive&&c.id!==citizen.id&&known(citizen,c.id));
    const x=nearest(xs,citizen);return x?{id:x.id,position:x.position,entity:x}:null;
  }
  if(step.selector==='grievance_actor'){
    const g=strongestGrievance(world,citizen,at),x=g&&(world.citizens||[]).find(c=>c.id===g.againstId&&c.alive&&known(citizen,c.id));
    return x?{id:x.id,position:x.position,entity:x}:null;
  }
  if(step.selector==='loose_known_object'){
    const xs=(world.objects||[]).filter(o=>o.quantity>0&&(o.holderId===null||o.holderId===undefined)&&o.position&&known(citizen,o.id));
    const x=nearest(xs,citizen);return x?{id:x.id,position:x.position,entity:x}:null;
  }
  if(step.selector==='held_object'){
    const x=(world.objects||[]).find(o=>o.quantity>0&&o.holderId===citizen.id);
    return x?{id:x.id,position:citizen.position,entity:x}:null;
  }
  return null;
}
function triggerMatches(world,citizen,program,at){
  const kind=program.trigger?.kind||'always',t=clamp(program.trigger?.threshold??.5,0,1);
  if(kind==='always')return true;
  if(kind==='high_sleep')return Number(citizen.body.sleepPressure||0)>=55+t*40;
  if(kind==='low_hydration')return Number(citizen.body.hydration||100)<=55-t*35;
  if(kind==='low_calories')return Number(citizen.body.calories||100)<=55-t*35;
  if(kind==='rain')return Number(world.environment?.precipitation||0)>=t;
  if(kind==='grievance')return Boolean(strongestGrievance(world,citizen,at)?.severity>=Math.max(.08,t*.6));
  if(kind==='resource_known')return (world.resourceDeposits||[]).some(d=>d.quantity>0&&known(citizen,d.id));
  if(kind==='damaged_structure')return [...(world.buildings||[]),...(world.objects||[])].some(x=>x.position&&known(citizen,x.id)&&Number(x.condition??1)>0&&Number(x.condition??1)<.75);
  if(kind==='loose_object')return (world.objects||[]).some(o=>o.quantity>0&&(o.holderId===null||o.holderId===undefined)&&known(citizen,o.id));
  if(kind==='near_citizen')return (world.citizens||[]).some(c=>c.alive&&c.id!==citizen.id&&known(citizen,c.id)&&dist(citizen.position,c.position)<=10);
  return false;
}
function actionFor(world,citizen,step,target){
  const base={type:step.type,durationMinutes:step.type==='REST'?20:step.type==='DESTROY'||step.type==='DISMANTLE'?45:12,purpose:'self_directed',concepts:[]};
  if(step.type==='OBSERVE'||step.type==='REST')return base;
  if(step.type==='DROP'){
    const held=(world.objects||[]).find(o=>o.holderId===citizen.id&&o.quantity>0);
    return held?{...base,payload:{objectId:held.id}}:null;
  }
  if(!target)return null;
  if(step.type==='GATHER')return {...base,targetId:target.id,payload:{quantity:1}};
  if(step.type==='PICKUP')return {...base,targetId:target.id};
  if(step.type==='COMMUNICATE')return {...base,targetId:target.id,payload:{primitiveSignal:step.signal||'attention'}};
  if(step.type==='CARE')return {...base,targetId:target.id};
  if(step.type==='TRANSFER'){
    const held=(world.objects||[]).find(o=>o.holderId===citizen.id&&o.quantity>0);
    return held?{...base,targetId:target.id,payload:{objectId:held.id}}:null;
  }
  if(step.type==='EXPERIMENT')return {...base,targetId:target.id,payload:{targetIds:[target.id],methodCode:'observe'}};
  if(step.type==='REPAIR'){
    const material=(world.objects||[]).find(o=>o.holderId===citizen.id&&o.quantity>0&&o.id!==target.id);
    return material?{...base,targetId:target.id,payload:{materialObjectId:material.id,effortMinutes:30}}:null;
  }
  if(step.type==='DESTROY'||step.type==='DISMANTLE')return {...base,targetId:target.id,payload:{effortMinutes:45}};
  return null;
}
export function programProposal(world,citizen,at=world.clock.worldMinute){
  for(const program of ensurePrograms(citizen)){
    if(program.enabled===false)continue;
    if(program.lastRunWorldMinute!==null&&Number(at)-Number(program.lastRunWorldMinute)<program.cooldownMinutes)continue;
    if(!triggerMatches(world,citizen,program,at))continue;
    const actions=[];
    for(const step of program.steps){
      const target=resolveSelector(world,citizen,step,at);
      const terminal=actionFor(world,citizen,step,target);
      if(!terminal)continue;
      if(target?.position&&!['MOVE','OBSERVE','REST','DROP'].includes(terminal.type)&&dist(citizen.position,target.position)>1.8){
        actions.push({type:'MOVE',durationMinutes:Math.max(2,Math.ceil(dist(citizen.position,target.position)*2)),targetId:target.id,targetPosition:target.position,purpose:'self_directed',concepts:[]});
      }
      actions.push(terminal);
      if(actions.length>=6)break;
    }
    if(!actions.length)continue;
    program.lastRunWorldMinute=Number(at)||0;program.runCount=Math.min(100000,Number(program.runCount||0)+1);
    appendEvent(world,'PROGRAM_TRIGGERED',citizen.id,{programId:program.id,runCount:program.runCount,actionTypes:actions.map(a=>a.type)},[],at);
    return {source:'self-program',affordanceFamily:'program-run',concepts:[],actions};
  }
  return null;
}
export function maybeLearnRoutineFromExperience(world,citizen,family,at=world.clock.worldMinute){
  const outcomes=citizen?.cognition?.local?.outcomes||{},o=outcomes[family];
  if(!o||Number(o.successes||0)<5)return null;
  const programs=ensurePrograms(citizen);
  if(programs.some(p=>p.sourceFamily===family&&p.enabled!==false))return null;
  const templates={
    gather:{name:'resource routine',trigger:{kind:'resource_known',threshold:.5},cooldownMinutes:180,steps:[{type:'GATHER',selector:'nearest_known_resource'}]},
    rest:{name:'rest routine',trigger:{kind:'high_sleep',threshold:.55},cooldownMinutes:180,steps:[{type:'REST',selector:'self'}]},
    communicate:{name:'contact routine',trigger:{kind:'near_citizen',threshold:.5},cooldownMinutes:120,steps:[{type:'COMMUNICATE',selector:'nearest_known_citizen'}]},
    care:{name:'care routine',trigger:{kind:'near_citizen',threshold:.5},cooldownMinutes:180,steps:[{type:'CARE',selector:'nearest_known_citizen'}]},
    pickup:{name:'salvage routine',trigger:{kind:'loose_object',threshold:.5},cooldownMinutes:120,steps:[{type:'PICKUP',selector:'loose_known_object'}]},
    repair:{name:'repair routine',trigger:{kind:'damaged_structure',threshold:.5},cooldownMinutes:240,steps:[{type:'REPAIR',selector:'nearest_damaged_structure'}]},
  };
  const spec=templates[family];
  return spec?createCitizenProgram(world,citizen,{...spec,sourceFamily:family},at,'learned-routine'):null;
}
export function programSummary(citizen){
  return ensurePrograms(citizen).map(p=>({id:p.id,name:p.name,trigger:p.trigger,stepTypes:p.steps.map(s=>s.type),enabled:p.enabled!==false,runCount:Number(p.runCount||0),source:p.source,createdWorldMinute:p.createdWorldMinute,lastRunWorldMinute:p.lastRunWorldMinute}));
}
