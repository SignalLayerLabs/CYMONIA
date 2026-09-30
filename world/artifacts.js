import {stableId} from './rng.js';
import {knows,learn} from './epistemics.js';
import {appendEvent} from './ledger.js';
import {consumeObjectQuantity,MATERIAL_PROPERTIES,objectMass} from './materials.js';
import {structureOccupancyAt,terrainAt} from './terrain.js';
import {constructionPhase,recordSpatialObservation} from './living-world.js';
import {updateRelationship} from './society.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function registerDesign(world,citizen,spec,at=world.clock.worldMinute){for(const concept of spec.concepts||[])if(!knows(citizen,concept))throw new Error(`unknown_concept:${concept}`);if(!spec.materials||!Object.keys(spec.materials).length)throw new Error('design_materials_required');const d={id:spec.id||stableId('design',citizen.id,world.designs.length),creatorId:citizen.id,concepts:[...(spec.concepts||[])],materials:{...spec.materials},workMinutes:Math.max(1,Number(spec.workMinutes)||1),functionConcept:spec.functionConcept||null,createdWorldMinute:at,origin:'explicit-material-design'};world.designs.push(d);appendEvent(world,'DESIGN_REGISTERED',citizen.id,{designId:d.id,conceptIds:d.concepts},[],at);return d;}
export function registerEmpiricalDesign(world,citizen,{concepts=[],inputObjectIds=[],workMinutes=120,form='structure'}={},at=world.clock.worldMinute){for(const concept of concepts)if(!knows(citizen,concept))throw new Error(`unknown_concept:${concept}`);const objects=inputObjectIds.map(id=>world.objects.find(o=>o.id===id&&o.holderId===citizen.id&&o.quantity>0));if(objects.some(x=>!x)||!objects.length)throw new Error('design_inputs_unavailable');const materials={};for(const o of objects)materials[o.material]=(materials[o.material]||0)+o.quantity;const d={id:stableId('design',citizen.id,world.designs.length,at),creatorId:citizen.id,concepts:[...concepts],materials,workMinutes:Math.max(15,Number(workMinutes)||120),functionConcept:null,createdWorldMinute:at,origin:'empirical',form:String(form||'structure').slice(0,32)};world.designs.push(d);appendEvent(world,'DESIGN_REGISTERED',citizen.id,{designId:d.id,conceptIds:d.concepts,origin:d.origin,form:d.form},[],at);return d;}
function foundationMultiplier(kind){return kind==='wetland'?1.65:kind==='rocky'?1.25:kind==='forest'?1.15:kind==='dry_grass'?1.03:1;}
function designFootprintRadius(design){
  const units=Object.values(design?.materials||{}).reduce((sum,q)=>sum+Math.max(0,Number(q)||0),0);
  return clamp(2.25+Math.sqrt(Math.max(1,units))*.16,2.35,3.45);
}
function constructionFootprintTouchesWater(world,site,footprintRadius,clearance=.55){
  const x=Number(site?.x),y=Number(site?.y),radius=Math.max(.5,Number(footprintRadius)||2.35)+Math.max(0,Number(clearance)||0);
  const samples=[{x,y}];
  for(const fraction of [.25,.5,.75,1]){
    const r=radius*fraction;
    for(let step=0;step<24;step++){
      const angle=step/24*Math.PI*2;
      samples.push({x:x+Math.cos(angle)*r,y:y+Math.sin(angle)*r});
    }
  }
  return samples.some(point=>terrainAt(world,point.x,point.y).kind==='river');
}

function validateSite(world,site,footprintRadius=2.35){
  const x=Number(site?.x),y=Number(site?.y);
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<1||x>99||y<1||y>99)throw new Error('construction_site_invalid');
  const probes=[[0,0],[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>({x:x+dx*footprintRadius*.8,y:y+dy*footprintRadius*.8}));
  if(probes.some(q=>structureOccupancyAt(world,q.x,q.y)))throw new Error('construction_site_occupied');
  if((world.projects||[]).some(p=>p.status==='construction'&&Math.hypot(x-p.site.x,y-p.site.y)<footprintRadius+Math.max(1.8,Number(p.footprintRadius)||2.15)))throw new Error('construction_site_project_conflict');
  if(constructionFootprintTouchesWater(world,{x,y},footprintRadius))throw new Error('construction_site_unstable_water');
  const terrain=terrainAt(world,x,y);
  return {x,y,terrain};
}
export function beginConstruction(world,citizen,designId,site,objectIds,at=world.clock.worldMinute,metadata={}){
  const d=world.designs.find(x=>x.id===designId);if(!d)throw new Error('design_not_found');
  const footprintRadius=designFootprintRadius(d),checked=validateSite(world,site,footprintRadius),objects=objectIds.map(id=>world.objects.find(o=>o.id===id));
  if(objects.some(x=>!x))throw new Error('material_object_not_found');
  for(const [material,needed] of Object.entries(d.materials)){
    const available=objects.filter(o=>o.material===material&&o.holderId===citizen.id&&!o.reservedProjectId).reduce((sum,o)=>sum+o.quantity,0);
    if(available<needed)throw new Error(`insufficient_material:${material}`);
  }
  const foundationFactor=foundationMultiplier(checked.terrain.kind);
  const p={
    id:stableId('project',designId,citizen.id,world.projects.length),designId,initiatorId:citizen.id,
    site:{x:checked.x,y:checked.y},terrainKind:checked.terrain.kind,foundationFactor,
    materialObjectIds:[...objectIds],stagedMaterialObjectIds:[...objectIds],
    workRequiredMinutes:Math.ceil(d.workMinutes*foundationFactor),workDoneMinutes:0,status:'construction',
    createdWorldMinute:at,footprintRadius,phase:'site',
    contributorIds:[citizen.id],contributionMinutesByCitizenId:{},
    whySummary:metadata.whySummary||null,whyConceptIds:[...(metadata.whyConceptIds||d.concepts||[])].slice(0,12),
    demandEvidence:metadata.demandEvidence&&typeof metadata.demandEvidence==='object'?{...metadata.demandEvidence}:null
  };
  world.projects.push(p);
  for(const o of objects){
    o.reservedProjectId=p.id;
    o.position={...p.site};
    o.holderId=null;
    citizen.possessions=(citizen.possessions||[]).filter(id=>id!==o.id);
  }
  appendEvent(world,'CONSTRUCTION_STARTED',citizen.id,{projectId:p.id,designId,site:p.site,terrainKind:p.terrainKind,foundationFactor:p.foundationFactor,workRequiredMinutes:p.workRequiredMinutes,stagedMaterialObjectIds:p.stagedMaterialObjectIds,phase:p.phase,demandEvidence:p.demandEvidence},[],at);
  return p;
}
export function beginEmpiricalConstruction(world,citizen,spec,at=world.clock.worldMinute){const design=registerEmpiricalDesign(world,citizen,{concepts:spec.concepts,inputObjectIds:spec.inputObjectIds,workMinutes:spec.workMinutes,form:spec.form},at);return beginConstruction(world,citizen,design.id,spec.site,spec.inputObjectIds,at,{whySummary:spec.whySummary||null,whyConceptIds:spec.reasonConceptIds||spec.concepts||[],demandEvidence:spec.demandEvidence||null});}
function protectionFromMaterials(incorporated){let mass=0,thermal=0,water=0;for(const [material,quantity] of Object.entries(incorporated)){const q=Math.max(0,Number(quantity)||0),p=MATERIAL_PROPERTIES[material]||MATERIAL_PROPERTIES.composite;mass+=q;thermal+=q*Number(p.thermalResistance||.25);water+=q*Number(p.waterResistance||.35);}if(mass<=0)return{thermal:.2,precipitation:.25};return{thermal:clamp(thermal/mass,.08,.95),precipitation:clamp(water/mass,.08,.98)};}
export function applyConstructionWork(world,citizen,projectId,minutes,at=world.clock.worldMinute){
  const p=world.projects.find(x=>x.id===projectId);if(!p||p.status!=='construction')throw new Error('project_not_active');
  if(!citizen.alive)throw new Error('citizen_dead');
  const before=constructionPhase(p),applied=Math.min(Math.max(0,Number(minutes)||0),Math.max(0,p.workRequiredMinutes-p.workDoneMinutes));
  p.workDoneMinutes=Math.min(p.workRequiredMinutes,p.workDoneMinutes+applied);
  p.contributorIds??=[p.initiatorId];p.contributionMinutesByCitizenId??={};
  const firstContribution=!p.contributorIds.includes(citizen.id);
  if(firstContribution)p.contributorIds.push(citizen.id);
  p.contributionMinutesByCitizenId[citizen.id]=Number(p.contributionMinutesByCitizenId[citizen.id]||0)+applied;
  const after=constructionPhase(p);p.phase=after;
  appendEvent(world,'CONSTRUCTION_WORK',citizen.id,{projectId,minutes:applied,workDoneMinutes:p.workDoneMinutes,phase:after},[],at);
  if(after!==before)appendEvent(world,'CONSTRUCTION_PHASE_CHANGED',citizen.id,{projectId,from:before,to:after,progress:p.workDoneMinutes/Math.max(1,p.workRequiredMinutes)},[],at);
  if(firstContribution&&citizen.id!==p.initiatorId){
    const initiator=world.citizens.find(c=>c.id===p.initiatorId&&c.alive);
    if(initiator){updateRelationship(world,citizen,initiator.id,{familiarity:.025,trust:.012},at);updateRelationship(world,initiator,citizen.id,{familiarity:.025,trust:.015},at);}
  }
  if(p.workDoneMinutes<p.workRequiredMinutes)return p;

  const d=world.designs.find(x=>x.id===p.designId),incorporated={};let incorporatedMassKg=0;
  for(const [material,needed0] of Object.entries(d.materials)){
    let needed=needed0;
    for(const id of p.materialObjectIds){
      const o=world.objects.find(x=>x.id===id);
      if(!o||o.material!==material||needed<=0)continue;
      const q=Math.min(o.quantity,needed);incorporated[material]=(incorporated[material]||0)+q;incorporatedMassKg+=q*o.massPerUnitKg;consumeObjectQuantity(world,o.id,q,p.id,at);needed-=q;
    }
    if(needed>0)throw new Error(`construction_material_missing:${material}`);
  }
  for(const id of p.materialObjectIds){const o=world.objects.find(x=>x.id===id);if(o)delete o.reservedProjectId;}
  p.status='completed';p.phase='complete';p.completedByCitizenId=citizen.id;p.completedWorldMinute=at;
  const protection=protectionFromMaterials(incorporated),b={
    id:stableId('building',p.id),kind:'structure',designId:d.id,position:{...p.site},
    footprintRadius:Math.max(2.25,Number(p.footprintRadius)||designFootprintRadius(d)),condition:1,
    massKg:incorporatedMassKg,materials:incorporated,protection,createdWorldMinute:at,occupants:[],accessAgreements:[],
    provenance:{projectId:p.id,designId:d.id,initiatorId:p.initiatorId,completedByCitizenId:citizen.id,contributorIds:[...p.contributorIds],contributionMinutesByCitizenId:{...p.contributionMinutesByCitizenId},whySummary:p.whySummary||null,whyConceptIds:[...(p.whyConceptIds||[])],terrainKind:p.terrainKind,demandEvidence:p.demandEvidence||null}
  };
  world.buildings.push(b);
  for(const id of new Set([p.initiatorId,citizen.id,...(p.contributorIds||[])])){
    const person=world.citizens.find(x=>x.id===id);
    if(!person)continue;
    person.knownEntityIds??=[person.id];
    if(!person.knownEntityIds.includes(b.id))person.knownEntityIds.push(b.id);
    recordSpatialObservation(person,b.id,b.position,at,'structure');
  }
  appendEvent(world,'BUILDING_COMPLETED',citizen.id,{projectId:p.id,buildingId:b.id,designId:d.id,massKg:incorporatedMassKg,protection,contributors:b.provenance.contributorIds,demandEvidence:b.provenance.demandEvidence},[],at);
  return p;
}
function observableProperties(material,object=null){const p=object?.properties||MATERIAL_PROPERTIES[material]||{};return Object.fromEntries(Object.entries(p).filter(([,v])=>typeof v==='number'||typeof v==='boolean'));}
export function runExperiment(world,citizen,spec,at=world.clock.worldMinute){for(const c of spec.inputConcepts||[])if(!knows(citizen,c))throw new Error(`unknown_concept:${c}`);const targets=[];for(const id of spec.targetIds||[]){const o=world.objects.find(x=>x.id===id&&x.holderId===citizen.id);const d=world.resourceDeposits.find(x=>x.id===id&&citizen.knownEntityIds.includes(id));if(o)targets.push({id,material:o.material,massKg:objectMass(o),object:o});else if(d)targets.push({id,material:d.type,massKg:null});else throw new Error(`experiment_target_unavailable:${id}`);}const observations=[];const discovered=[];for(const t of targets){for(const [property,value] of Object.entries(observableProperties(t.material,t.object))){const concept=stableId('kprop',t.id,property);const evidence={entityId:t.id,property,value,method:String(spec.method||'direct-test').slice(0,32)};learn(citizen,concept,{kind:'experiment',evidence},.85,at);observations.push({conceptId:concept,evidence});discovered.push(concept);}}const sequence=Math.max(Number(world.experimentSequence)||0,world.experiments.length);const e={id:stableId('exp',citizen.id,sequence,at),actorId:citizen.id,inputConcepts:[...(spec.inputConcepts||[])],targetIds:targets.map(x=>x.id),observations,discoveredConceptIds:discovered,result:observations.length?'observations-recorded':'inconclusive',worldMinute:at};world.experimentSequence=sequence+1;world.experiments.push(e);appendEvent(world,'EXPERIMENT_COMPLETED',citizen.id,{experimentId:e.id,targetIds:e.targetIds,discoveredConceptIds:discovered,result:e.result},[],at);return e;}
