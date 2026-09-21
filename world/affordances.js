import {knows} from './epistemics.js';
import {ensureCognitionState,outcomeModifier} from './cognition-state.js';
import {resourceConceptId} from './perception.js';
import {MATERIAL_PROPERTIES} from './materials.js';
import {hash32,stableId} from './rng.js';
import {activeStrategy} from './strategy.js';

const clamp01=value=>Math.max(0,Math.min(1,Number(value)||0));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const heldObjects=(world,citizen)=>world.objects.filter(object=>object.holderId===citizen.id&&object.quantity>0&&!object.reservedProjectId);
const activeKnowledge=citizen=>(citizen.knowledge||[]).filter(entry=>entry.active!==false);
const relation=(citizen,targetId)=>citizen.relationships?.[targetId]||{};

export const AFFORDANCE_WEIGHTS=Object.freeze({
  strategy:.55,curiosity:.45,social:.4,relationship:.3,inventoryFit:.35,
  knowledgeGap:.5,novelty:.4,effort:-.25,risk:-.3,cooldown:-.8,outcome:.35,
});

function proposal(family,concepts,actions){
  return {source:'local',affordanceFamily:family,concepts:[...new Set(concepts.filter(Boolean))],actions};
}

function resourceAction(citizen,deposit,type,duration,purpose,payload={}){
  const concept=resourceConceptId(deposit),distance=dist(citizen.position,deposit.position);
  const terminal={type,durationMinutes:duration,targetId:deposit.id,purpose,concepts:[concept],payload};
  return distance>1
    ?[{type:'MOVE',durationMinutes:Math.max(2,Math.ceil(distance*2)),targetId:deposit.id,targetPosition:deposit.position,purpose,concepts:[concept]},terminal]
    :[terminal];
}

function knowledgeForEntity(citizen,entityId){
  return activeKnowledge(citizen).filter(entry=>(entry.provenance||[]).some(source=>source?.evidence?.entityId===entityId));
}

function hasUnknownObservableProperty(citizen,target){
  const properties=target.properties||MATERIAL_PROPERTIES[target.material||target.type]||{};
  return Object.keys(properties).some(property=>!knows(citizen,stableId('kprop',target.id,property)));
}

function exploreCandidate(world,citizen,at){
  const hash=hash32(`${world.seed}|${citizen.id}|${Math.floor(at/30)}|explore`);
  const angle=(hash%10000)/10000*Math.PI*2,radius=5+((hash>>>8)%800)/100;
  const target={x:Math.max(5,Math.min(95,citizen.position.x+Math.cos(angle)*radius)),y:Math.max(5,Math.min(95,citizen.position.y+Math.sin(angle)*radius))};
  const distance=dist(citizen.position,target);
  return {family:'explore',key:`explore:${Math.floor(target.x)}:${Math.floor(target.y)}`,utility:.12,novelty:.8,effort:Math.min(1,distance/30),risk:.25,proposal:proposal('explore',[],[
    {type:'MOVE',durationMinutes:Math.max(4,Math.ceil(distance*2)),targetPosition:target,purpose:'explore',concepts:[]},
    {type:'OBSERVE',durationMinutes:8,purpose:'explore',concepts:[]},
  ])};
}

export function enumerateAffordances(world,citizen,at=world.clock.worldMinute){
  if(!citizen?.alive||citizen.currentActionId)return [];
  const candidates=[],held=heldObjects(world,citizen);
  const knownResources=world.resourceDeposits.filter(deposit=>deposit.quantity>0&&citizen.knownEntityIds.includes(deposit.id)&&knows(citizen,resourceConceptId(deposit)));
  const nearby=world.citizens.filter(other=>other.id!==citizen.id&&other.alive&&citizen.knownEntityIds.includes(other.id)&&dist(citizen.position,other.position)<=10);

  for(const deposit of knownResources){
    const distance=dist(citizen.position,deposit.position),heldSame=held.reduce((sum,object)=>sum+(object.material===deposit.type?object.quantity:0),0);
    candidates.push({family:'gather',key:`gather:${deposit.id}`,targetId:deposit.id,utility:.32,inventoryFit:clamp01(1-heldSame/2),novelty:heldSame?0:.25,effort:Math.min(1,distance/50),risk:clamp01(deposit.accessDifficulty),proposal:proposal('gather',[resourceConceptId(deposit)],resourceAction(citizen,deposit,'GATHER',12,'self_directed',{quantity:1}))});
    if(!held.length&&hasUnknownObservableProperty(citizen,deposit))candidates.push({family:'experiment',key:`experiment:${deposit.id}:observe`,targetId:deposit.id,utility:.08,knowledgeGap:.55,novelty:.55,effort:Math.min(1,distance/50),risk:clamp01(deposit.accessDifficulty),proposal:proposal('experiment',[resourceConceptId(deposit)],[{type:'EXPERIMENT',durationMinutes:30,targetId:deposit.id,purpose:'experiment',concepts:[resourceConceptId(deposit)],payload:{targetIds:[deposit.id],methodCode:'observe'}}])});
  }

  for(const object of held){
    if(hasUnknownObservableProperty(citizen,object))candidates.push({family:'experiment',key:`experiment:${object.id}:observe`,targetId:object.id,utility:.48,knowledgeGap:1,inventoryFit:.8,novelty:.85,effort:.05,risk:.05,proposal:proposal('experiment',[],[{type:'EXPERIMENT',durationMinutes:30,targetId:object.id,purpose:'experiment',concepts:[],payload:{targetIds:[object.id],methodCode:'observe'}}])});
    if(knowledgeForEntity(citizen,object.id).length)candidates.push({family:'transform',key:`transform:${object.id}`,targetId:object.id,utility:.24,inventoryFit:.9,knowledgeGap:.2,novelty:.55,effort:.2,risk:.12,proposal:proposal('transform',knowledgeForEntity(citizen,object.id).map(entry=>entry.concept),[{type:'ASSEMBLE',durationMinutes:35,purpose:'experiment',concepts:knowledgeForEntity(citizen,object.id).map(entry=>entry.concept),payload:{inputObjectIds:[object.id],quantities:[object.quantity],form:'bundle'}}])});
  }

  const concepts=activeKnowledge(citizen).map(entry=>entry.concept);
  for(const other of nearby){
    const gap=concepts.find(concept=>!knows(other,concept));
    if(gap){
      const rel=relation(citizen,other.id);
      candidates.push({family:'communicate',key:`communicate:${other.id}:${gap}`,targetId:other.id,utility:.18,social:1,relationship:clamp01((Number(rel.familiarity)||0)+(Number(rel.trust)||0))/2,knowledgeGap:.75,novelty:.5,effort:.05,risk:clamp01(rel.fear),proposal:proposal('communicate',[gap],[{type:'COMMUNICATE',durationMinutes:5,targetId:other.id,purpose:'communicate',concepts:[gap],payload:{concept:gap}}])});
      if(Number(rel.trust||0)>=.55)candidates.push({family:'teach',key:`teach:${other.id}:${gap}`,targetId:other.id,utility:.16,social:.8,relationship:clamp01(rel.trust),knowledgeGap:.65,novelty:.25,effort:.08,risk:clamp01(rel.fear),proposal:proposal('teach',[gap],[{type:'TEACH',durationMinutes:10,targetId:other.id,purpose:'communicate',concepts:[gap],payload:{concept:gap}}])});
    }
    const need=Math.max(clamp01((55-other.body.hydration)/55),clamp01((55-other.body.calories)/55),clamp01((75-other.body.health)/75));
    if(need>0)candidates.push({family:'care',key:`care:${other.id}`,targetId:other.id,utility:.16+need*.3,social:.8,relationship:clamp01(Number(relation(citizen,other.id).affection)||0),knowledgeGap:0,novelty:.15,effort:.05,risk:0,proposal:proposal('care',[],[{type:'CARE',durationMinutes:10,targetId:other.id,purpose:'care',concepts:[]}])});
    const gift=held[0],trust=Number(relation(citizen,other.id).trust)||0;
    if(gift&&trust>=.3)candidates.push({family:'transfer',key:`transfer:${other.id}:${gift.id}`,targetId:other.id,utility:.12,social:.7,relationship:clamp01(trust),inventoryFit:clamp01(gift.quantity/4),novelty:.2,effort:.05,risk:0,proposal:proposal('transfer',[],[{type:'TRANSFER',durationMinutes:5,targetId:other.id,purpose:'cooperate',concepts:[],payload:{objectId:gift.id}}])});
  }

  const activeProjects=(world.projects||[]).filter(project=>project.status==='construction'&&(project.initiatorId===citizen.id||citizen.knownEntityIds.includes(project.id)));
  for(const project of activeProjects){
    const distance=dist(citizen.position,project.site),conceptsForProject=(world.designs.find(design=>design.id===project.designId)?.concepts||[]).filter(concept=>knows(citizen,concept));
    if(!conceptsForProject.length)continue;
    const action={type:'BUILD',durationMinutes:Math.min(120,Math.max(15,project.workRequiredMinutes-project.workDoneMinutes)),targetId:project.id,purpose:'construct',concepts:conceptsForProject,payload:{projectId:project.id,workMinutes:120}};
    candidates.push({family:project.initiatorId===citizen.id?'build':'cooperate',key:`build:${project.id}`,targetId:project.id,utility:.42,relationship:project.initiatorId===citizen.id?0:clamp01(relation(citizen,project.initiatorId).trust),inventoryFit:.8,novelty:.25,effort:Math.min(1,distance/50),risk:.1,proposal:proposal(project.initiatorId===citizen.id?'build':'cooperate',conceptsForProject,distance>1?[{type:'MOVE',durationMinutes:Math.max(2,Math.ceil(distance*2)),targetId:project.id,targetPosition:project.site,purpose:'cooperate',concepts:conceptsForProject},action]:[action])});
  }

  const testedHeld=held.filter(object=>knowledgeForEntity(citizen,object.id).length);
  if(testedHeld.length>=2&&!activeProjects.some(project=>project.initiatorId===citizen.id)){
    const conceptsForBuild=[...new Set(testedHeld.flatMap(object=>knowledgeForEntity(citizen,object.id).map(entry=>entry.concept)))].slice(0,12);
    const offset=2+(hash32(`${world.seed}|${citizen.id}|build`)%3),site={x:Math.max(2,Math.min(98,citizen.position.x+offset)),y:Math.max(2,Math.min(98,citizen.position.y+1))};
    candidates.push({family:'build',key:`build:new:${Math.floor(site.x)}:${Math.floor(site.y)}`,utility:.28,inventoryFit:1,knowledgeGap:.2,novelty:.8,effort:.4,risk:.2,proposal:proposal('build',conceptsForBuild,[{type:'BUILD',durationMinutes:120,purpose:'construct',concepts:conceptsForBuild,payload:{inputObjectIds:testedHeld.map(object=>object.id),site,workMinutes:240,form:'structure'}}])});
  }

  candidates.push(exploreCandidate(world,citizen,at));
  candidates.push({family:'rest',key:'rest',utility:.04+clamp01(citizen.body.sleepPressure/100)*.35,novelty:0,effort:0,risk:0,proposal:proposal('rest',[],[{type:'REST',durationMinutes:20,purpose:'self_directed',concepts:[]}])});
  return candidates;
}

export function scoreAffordance(world,citizen,candidate,at=world.clock.worldMinute){
  const state=ensureCognitionState(citizen,at),psychology=citizen.psychology||{},rel=relation(citizen,candidate.targetId);
  const persistent=activeStrategy(citizen,at,world),legacy=citizen.activeGoal?.kind==='strategy-v1'?null:citizen.activeGoal;
  const desired=new Set(persistent?.actionBias||legacy?.actionTypes||[]),actions=candidate.proposal.actions||[];
  const actionAligned=actions.some(action=>desired.has(action.type));
  const partnerAligned=Boolean(persistent?.partnerIds?.includes(candidate.targetId));
  const conceptAligned=Boolean(persistent?.focus&&(candidate.proposal.concepts||[]).includes(persistent.focus));
  const intentFamilies={explore:['explore'],understand:['experiment','transform'],share:['communicate','teach','transfer'],cooperate:['cooperate','transfer','communicate','build'],care:['care'],construct:['build','gather','transform'],adapt:['explore','experiment','transform']};
  const intentAligned=Boolean(persistent&&intentFamilies[persistent.intent]?.includes(candidate.family));
  const strategy=actionAligned||partnerAligned||conceptAligned||intentAligned?1:0;
  const cooldown=Number(state.cooldowns?.[candidate.key]?.untilWorldMinute||0)>at?1:0;
  const relationValue=Math.max(clamp01(candidate.relationship),clamp01((Number(rel.trust)||0)+(Number(rel.familiarity)||0))/2);
  return Number(candidate.utility||0)
    +AFFORDANCE_WEIGHTS.strategy*strategy
    +AFFORDANCE_WEIGHTS.curiosity*clamp01(psychology.curiosity)*clamp01(candidate.knowledgeGap||candidate.novelty)
    +AFFORDANCE_WEIGHTS.social*clamp01(psychology.socialDrive)*clamp01(candidate.social)
    +AFFORDANCE_WEIGHTS.relationship*relationValue
    +AFFORDANCE_WEIGHTS.inventoryFit*clamp01(candidate.inventoryFit)
    +AFFORDANCE_WEIGHTS.knowledgeGap*clamp01(candidate.knowledgeGap)
    +AFFORDANCE_WEIGHTS.novelty*clamp01(psychology.noveltySeeking)*clamp01(candidate.novelty)
    +AFFORDANCE_WEIGHTS.effort*clamp01(candidate.effort)
    +AFFORDANCE_WEIGHTS.risk*clamp01(candidate.risk)*(1-clamp01(psychology.riskTolerance))
    +AFFORDANCE_WEIGHTS.cooldown*cooldown
    +AFFORDANCE_WEIGHTS.outcome*outcomeModifier(citizen,candidate.family,at);
}

function stableCandidateOrder(world,citizen,a,b,at){
  const left=hash32(`${world.seed}|${citizen.id}|${Math.floor(at/10)}|${a.key}`),right=hash32(`${world.seed}|${citizen.id}|${Math.floor(at/10)}|${b.key}`);
  return left-right||a.key.localeCompare(b.key);
}

export function chooseAffordance(world,citizen,at=world.clock.worldMinute){
  const candidates=enumerateAffordances(world,citizen,at);
  if(!candidates.length)return null;
  const selected=candidates.map(candidate=>({...candidate,score:scoreAffordance(world,citizen,candidate,at)})).sort((a,b)=>b.score-a.score||stableCandidateOrder(world,citizen,a,b,at))[0];
  ensureCognitionState(citizen,at).lastLocalChoiceMinute=at;
  return selected.proposal;
}
