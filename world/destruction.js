import {appendEvent} from './ledger.js';
import {stableId} from './rng.js';
import {MATERIAL_PROPERTIES,consumeObjectQuantity,objectMass} from './materials.js';
import {updateRelationship} from './society.js';
import {ensureLivingWorld,recordEnvironmentalScar} from './living-world.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const GRIEVANCE_HALF_LIFE=43200;

export function ensureDestructionState(world){
  world.grievances??=[];
  return world.grievances;
}

export function destructionTarget(world,targetId){
  const building=(world.buildings||[]).find(x=>x.id===targetId&&Number(x.condition??1)>0&&Number(x.massKg||0)>0);
  if(building)return {kind:'building',entity:building,position:building.position};
  const object=(world.objects||[]).find(x=>x.id===targetId&&x.quantity>0);
  if(object)return {kind:'object',entity:object,position:object.position};
  const deposit=(world.resourceDeposits||[]).find(x=>x.id===targetId&&x.quantity>0&&x.type!=='water');
  if(deposit)return {kind:'resource',entity:deposit,position:deposit.position};
  return null;
}

function materialProfile(material,properties=null){
  return properties||MATERIAL_PROPERTIES[material]||MATERIAL_PROPERTIES.composite;
}
function resistanceOf(target){
  if(target.kind==='building'){
    const b=target.entity,entries=Object.entries(b.materials||{});
    let total=0,weighted=0;
    for(const [material,q0] of entries){
      const q=Math.max(0,Number(q0)||0),p=materialProfile(material);
      const r=Math.max(20,Number(p.structuralIntegrity)||0,(Number(p.hardness)||.2)*260,(Number(p.toughness)||.2)*340);
      total+=q;weighted+=q*r;
    }
    return total?weighted/total:110;
  }
  if(target.kind==='object'){
    const o=target.entity,p=materialProfile(o.material,o.properties);
    return Math.max(15,Number(p.structuralIntegrity)||0,(Number(p.hardness)||.2)*220,(Number(p.toughness)||.2)*300);
  }
  const p=materialProfile(target.entity.type);
  return Math.max(18,Number(p.structuralIntegrity)||0,(Number(p.hardness)||.2)*280);
}
function physicalPower(citizen){
  return clamp(citizen?.genome?.physicalCapacity||1,.55,1.55);
}
function toolAdvantage(world,citizen){
  let best=0;
  for(const o of world.objects||[]){
    if(o.holderId!==citizen.id||!(o.quantity>0))continue;
    const p=materialProfile(o.material,o.properties);
    best=Math.max(best,clamp((Number(p.hardness)||0)*.65+(Number(p.toughness)||0)*.35,0,1));
  }
  return 1+best*.55;
}
function atTarget(citizen,target,max=2.6){
  return target?.position&&Math.hypot(citizen.position.x-target.position.x,citizen.position.y-target.position.y)<=max;
}

function debrisObjects(world,{sourceId,position,materials,totalMassKg,eventId,recoverableFraction=.5,kind='debris'},at){
  const mass=Math.max(0,Number(totalMassKg)||0);
  if(!(mass>0))return [];
  const entries=Object.entries(materials||{}).filter(([,q])=>Number(q)>0);
  const weighted=entries.reduce((s,[,q])=>s+Number(q),0);
  const shares=weighted?entries:[[kind==='natural_debris'?'biomass':'composite',1]];
  const result=[];
  let assigned=0;
  for(let i=0;i<shares.length;i++){
    const [material,q]=shares[i];
    const m=i===shares.length-1?mass-assigned:mass*(Number(q)/shares.reduce((s,[,v])=>s+Number(v),0));
    assigned+=m;
    if(!(m>0))continue;
    const angle=(i/Math.max(1,shares.length))*Math.PI*2;
    const o={
      id:stableId('wreckage',sourceId,eventId,i),
      kind,
      material,
      quantity:m,
      massPerUnitKg:1,
      properties:{...(MATERIAL_PROPERTIES[material]||MATERIAL_PROPERTIES.composite),recoverableFraction},
      holderId:null,
      position:{x:position.x+Math.cos(angle)*(.25+i*.05),y:position.y+Math.sin(angle)*(.25+i*.05)},
      condition:clamp(.2+recoverableFraction*.55,.1,.9),
      provenance:{type:'DESTRUCTION_SALVAGE',sourceId,eventId,index:i,recoverableFraction,worldMinute:at}
    };
    world.objects.push(o);result.push(o);
  }
  return result;
}

function grievanceSeverityAt(g,at){
  const elapsed=Math.max(0,Number(at)-Number(g.lastWorldMinute||g.createdWorldMinute||0));
  return clamp(Number(g.severity)||0,0,1)*Math.pow(.5,elapsed/GRIEVANCE_HALF_LIFE);
}
export function createGrievance(world,holderId,againstId,{targetId=null,severity=.1,causeId=null,kind='harm'}={},at=world.clock.worldMinute){
  if(!holderId||!againstId||holderId===againstId)return null;
  const holder=(world.citizens||[]).find(c=>c.id===holderId&&c.alive);
  const against=(world.citizens||[]).find(c=>c.id===againstId&&c.alive);
  if(!holder||!against)return null;
  const list=ensureDestructionState(world);
  let g=[...list].reverse().find(x=>x.status==='active'&&x.holderId===holderId&&x.againstId===againstId&&x.targetId===targetId);
  if(!g){
    g={id:stableId('grievance',holderId,againstId,targetId||'none',list.length,at),holderId,againstId,targetId,kind,status:'active',severity:0,createdWorldMinute:at,lastWorldMinute:at,causeIds:[]};
    list.push(g);
  }
  g.severity=clamp(grievanceSeverityAt(g,at)+Math.max(0,Number(severity)||0),0,1);
  g.lastWorldMinute=at;
  if(causeId&&!g.causeIds.includes(causeId))g.causeIds.push(causeId);
  g.causeIds=g.causeIds.slice(-12);
  updateRelationship(world,holder,againstId,{trust:-g.severity*.16,affection:-g.severity*.09,fear:g.severity*.07},at);
  holder.psychology.stress=clamp(Number(holder.psychology.stress||0)+g.severity*.18,0,1);
  holder.psychology.fear=clamp(Number(holder.psychology.fear||0)+g.severity*.08,0,1);
  appendEvent(world,'GRIEVANCE_CREATED',holderId,{grievanceId:g.id,againstId,targetId,severity:g.severity,kind},causeId?[causeId]:[],at);
  if(list.length>400)list.splice(0,list.length-400);
  return g;
}
export function grievancePressure(world,citizen,againstId=null,at=world.clock.worldMinute){
  return clamp(ensureDestructionState(world)
    .filter(g=>g.status==='active'&&g.holderId===citizen?.id&&(!againstId||g.againstId===againstId))
    .reduce((sum,g)=>sum+grievanceSeverityAt(g,at),0),0,1);
}
export function strongestGrievance(world,citizen,at=world.clock.worldMinute){
  let best=null,bestSeverity=0;
  for(const g of ensureDestructionState(world)){
    if(g.status!=='active'||g.holderId!==citizen?.id)continue;
    const severity=grievanceSeverityAt(g,at);
    if(severity>bestSeverity){bestSeverity=severity;best={...g,severity};}
  }
  return best;
}
function stakeholders(world,target){
  const stakes=new Map();
  const add=(id,w)=>{if(!id)return;stakes.set(id,Math.max(stakes.get(id)||0,w));};
  if(target.kind==='building'){
    const b=target.entity,p=b.provenance||{},use=ensureLivingWorld(world).structureUse[b.id];
    add(p.initiatorId,.24);add(p.completedByCitizenId,.18);
    for(const id of p.contributorIds||[])add(id,.14);
    for(const [id,value] of Object.entries(use?.byCitizen||{})){
      const w=clamp(Number(value.minutes||0)/1440,0,.5);
      add(id,.16+w*.45);
    }
  }else if(target.kind==='object'){
    const holder=target.entity.holderId;
    if(holder&&!String(holder).startsWith('commons:'))add(holder,.55);
  }else if(target.kind==='resource'){
    for(const c of world.citizens||[]){
      if(!c.alive||!(c.knownEntityIds||[]).includes(target.entity.id))continue;
      if(Math.hypot(c.position.x-target.position.x,c.position.y-target.position.y)<=12)add(c.id,.08);
    }
  }
  for(const claim of world.claims||[]){
    if(claim.status==='asserted'&&claim.subject===target.entity.id)add(claim.claimantId,.42);
  }
  return stakes;
}
function socialConsequences(world,citizen,target,eventId,magnitude,mode,at){
  const stakes=stakeholders(world,target);
  for(const [id,stake] of stakes){
    if(id===citizen.id)continue;
    const severity=clamp(magnitude*stake*(mode==='DISMANTLE'?.7:1.15),0,.85);
    if(severity<.025)continue;
    createGrievance(world,id,citizen.id,{targetId:target.entity.id,severity,causeId:eventId,kind:mode==='DISMANTLE'?'loss':'destruction'},at);
  }
  for(const witness of world.citizens||[]){
    if(!witness.alive||witness.id===citizen.id||!target.position)continue;
    if(Math.hypot(witness.position.x-target.position.x,target.position.y-witness.position.y)>9)continue;
    if(!(witness.knownEntityIds||[]).includes(target.entity.id))continue;
    updateRelationship(world,witness,citizen.id,{trust:-.018*magnitude,fear:.025*magnitude},at);
  }
}

export function applyDestruction(world,citizen,targetId,{mode='DESTROY',effortMinutes=30}={},at=world.clock.worldMinute){
  const target=destructionTarget(world,targetId);
  if(!target)throw new Error('destruction_target_unavailable');
  if(!citizen?.alive)throw new Error('citizen_dead');
  if(!atTarget(citizen,target))throw new Error('destruction_target_too_far');
  const actionMode=String(mode).toUpperCase()==='DISMANTLE'?'DISMANTLE':'DESTROY';
  const effort=Math.max(1,Math.min(1440,Number(effortMinutes)||30));
  const resistance=resistanceOf(target),power=physicalPower(citizen)*toolAdvantage(world,citizen);
  const attempt=appendEvent(world,'DESTRUCTION_ATTEMPT',citizen.id,{targetId,targetKind:target.kind,mode:actionMode,effortMinutes:effort,resistance,power},[],at);

  if(target.kind==='resource'){
    const d=target.entity;
    const before=d.quantity;
    const extractionRate=actionMode==='DISMANTLE'?.10:.18;
    const removed=Math.min(before,Math.max(.1,effort*power*extractionRate));
    d.quantity=Math.max(0,before-removed);
    const recoverable=actionMode==='DISMANTLE'?.86:.58;
    const debris=debrisObjects(world,{sourceId:d.id,position:d.position,materials:{[d.type]:1},totalMassKg:removed,eventId:attempt.id,recoverableFraction:recoverable,kind:'natural_debris'},at);
    const severity=clamp(removed/Math.max(8,before*.025),.03,1);
    recordEnvironmentalScar(world,d.position,`resource:${d.type}`,severity,at);
    const event=appendEvent(world,'RESOURCE_PATCH_DAMAGED',citizen.id,{depositId:d.id,resourceType:d.type,mode:actionMode,removedQuantity:removed,remainingQuantity:d.quantity,salvageObjectIds:debris.map(x=>x.id),severity},[attempt.id],at);
    socialConsequences(world,citizen,target,event.id,severity,actionMode,at);
    return {kind:'resource',destroyed:d.quantity<=0,removedQuantity:removed,eventId:event.id,salvageObjectIds:debris.map(x=>x.id)};
  }

  const entity=target.entity,beforeCondition=clamp(entity.condition??1,0,1);
  const modeFactor=actionMode==='DISMANTLE'?.8:1.18;
  const damage=clamp(effort*power*modeFactor/Math.max(40,resistance*2.1),.015,.92);
  entity.condition=clamp(beforeCondition-damage,0,1);
  if(entity.condition>0){
    const event=appendEvent(world,'ENTITY_DAMAGED',citizen.id,{targetId:entity.id,targetKind:target.kind,mode:actionMode,previousCondition:beforeCondition,condition:entity.condition,damage},[attempt.id],at);
    socialConsequences(world,citizen,target,event.id,damage*.55,actionMode,at);
    return {kind:target.kind,destroyed:false,condition:entity.condition,eventId:event.id};
  }

  const recoverable=actionMode==='DISMANTLE'?.9:.48;
  let mass=0,materials={};
  if(target.kind==='building'){
    mass=Math.max(0,Number(entity.massKg)||0);
    materials={...(entity.materials||{composite:1})};
    entity.massKg=0;entity.destroyedWorldMinute=at;
  }else{
    mass=objectMass(entity);
    materials={[entity.material||'composite']:1};
    entity.quantity=0;
    const holder=entity.holderId;
    if(holder){
      const owner=(world.citizens||[]).find(c=>c.id===holder);
      if(owner)owner.possessions=(owner.possessions||[]).filter(id=>id!==entity.id);
    }
    entity.holderId=null;entity.destroyedWorldMinute=at;
  }
  const debris=debrisObjects(world,{sourceId:entity.id,position:target.position,materials,totalMassKg:mass,eventId:attempt.id,recoverableFraction:recoverable},at);
  recordEnvironmentalScar(world,target.position,`destroyed:${target.kind}`,clamp(.18+mass/250,.18,.8),at);
  const event=appendEvent(world,'ENTITY_DESTROYED',citizen.id,{targetId:entity.id,targetKind:target.kind,mode:actionMode,massKg:mass,salvageObjectIds:debris.map(x=>x.id),recoverableFraction:recoverable},[attempt.id],at);
  socialConsequences(world,citizen,target,event.id,1,actionMode,at);
  return {kind:target.kind,destroyed:true,condition:0,eventId:event.id,salvageObjectIds:debris.map(x=>x.id)};
}

export function applyRepair(world,citizen,targetId,materialObjectId,{effortMinutes=30}={},at=world.clock.worldMinute){
  const building=(world.buildings||[]).find(b=>b.id===targetId&&Number(b.condition??1)>0&&Number(b.condition??1)<1);
  const object=(world.objects||[]).find(o=>o.id===targetId&&o.quantity>0&&Number(o.condition??1)>0&&Number(o.condition??1)<1);
  const target=building?{kind:'building',entity:building,position:building.position}:object?{kind:'object',entity:object,position:object.position}:null;
  if(!target)throw new Error('repair_target_unavailable');
  if(!atTarget(citizen,target))throw new Error('repair_target_too_far');
  const source=(world.objects||[]).find(o=>o.id===materialObjectId&&o.holderId===citizen.id&&o.quantity>0&&o.id!==targetId);
  if(!source)throw new Error('repair_material_unavailable');
  const q=Math.min(source.quantity,Math.max(.1,Math.min(2,Number(effortMinutes||30)/60)));
  const addedMass=q*Math.max(.001,Number(source.massPerUnitKg)||1);
  const material=source.material||'composite',p=materialProfile(material,source.properties);
  consumeObjectQuantity(world,source.id,q,null,at);
  if(source.quantity<=0)citizen.possessions=(citizen.possessions||[]).filter(id=>id!==source.id);

  const prior=target.entity.condition;
  const gain=clamp(.04+addedMass/Math.max(5,(target.kind==='building'?target.entity.massKg:objectMass(target.entity)))*.8+(Number(p.structuralIntegrity)||0)/6000,.03,.35);
  target.entity.condition=clamp(prior+gain,0,1);
  if(target.kind==='building'){
    target.entity.massKg=Math.max(0,Number(target.entity.massKg)||0)+addedMass;
    target.entity.materials??={};target.entity.materials[material]=Number(target.entity.materials[material]||0)+q;
  }else{
    target.entity.quantity+=addedMass/Math.max(.001,Number(target.entity.massPerUnitKg)||1);
  }
  const event=appendEvent(world,'REPAIR_COMPLETED',citizen.id,{targetId,targetKind:target.kind,materialObjectId:source.id,material,addedMassKg:addedMass,previousCondition:prior,condition:target.entity.condition},[],at);
  const stakes=stakeholders(world,target);
  for(const [id,stake] of stakes){
    if(id===citizen.id)continue;
    const c=(world.citizens||[]).find(x=>x.id===id&&x.alive);if(!c)continue;
    updateRelationship(world,c,citizen.id,{trust:.025*stake,affection:.012*stake},at);
  }
  for(const g of ensureDestructionState(world)){
    if(g.status!=='active'||g.againstId!==citizen.id||g.targetId!==targetId)continue;
    g.severity=clamp(grievanceSeverityAt(g,at)-.18*gain,0,1);g.lastWorldMinute=at;
    if(g.severity<.025)g.status='resolved';
  }
  return {condition:target.entity.condition,eventId:event.id,addedMassKg:addedMass};
}

export function advanceDestructionState(world,at=world.clock.worldMinute){
  const list=ensureDestructionState(world);
  for(const g of list){
    if(g.status!=='active')continue;
    const severity=grievanceSeverityAt(g,at);
    if(severity<.015)g.status='resolved';
  }
  if(list.length>400)world.grievances=list.slice(-400);
  return world.grievances;
}
export function publicGrievances(world,at=world.clock.worldMinute){
  return ensureDestructionState(world)
    .filter(g=>g.status==='active')
    .map(g=>({...g,severity:Number(grievanceSeverityAt(g,at).toFixed(3))}))
    .filter(g=>g.severity>=.02)
    .sort((a,b)=>b.severity-a.severity)
    .slice(0,120);
}
