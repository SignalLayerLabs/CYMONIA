import {knows} from './epistemics.js';
import {ensureCognitionState,outcomeModifier} from './cognition-state.js';
import {resourceConceptId,explorationCellKey} from './perception.js';
import {MATERIAL_PROPERTIES} from './materials.js';
import {hash32,stableId} from './rng.js';
import {activeStrategy} from './strategy.js';
import {terrainAt,nearestDryLandPoint,isWaterTerrainKind,isSleepUnsafeTerrainKind} from './terrain.js';
import {constructionDemand,nightPressure,rememberedCrowding} from './living-world.js';

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

export function explorationTarget(world,citizen,at=world.clock.worldMinute){
  const map=citizen.explorationMap||{},cycle=Math.floor(Number(at||0)/90),candidates=[];
  for(let cy=0;cy<10;cy++)for(let cx=0;cx<10;cx++){
    const target={x:5+cx*10,y:5+cy*10},key=`${cx}:${cy}`;
    const visits=Number(map[key]?.visits||0),distance=dist(citizen.position,target);
    const crowd=rememberedCrowding(citizen,target,at,10);
    const knownResource=(world.resourceDeposits||[]).some(deposit=>deposit.quantity>0&&citizen.knownEntityIds.includes(deposit.id)&&dist(deposit.position,target)<=12);
    const deterministic=(hash32(`${world.seed}|${citizen.id}|${cycle}|frontier|${key}`)%10000)/10000;
    const score=
      (1/(1+visits))*2.4+
      Math.min(1,distance/70)*.62+
      (1-Math.min(1,crowd/14))*1.05+
      (knownResource?.55:0)+
      deterministic*.7;
    candidates.push({target,key,score});
  }
  candidates.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
  const picked=candidates[0]?.target||{x:50,y:50};
  return nearestDryLandPoint(world,picked,8,{sleepSafe:false});
}

function localCrowding(world,position,radius=12){
  return (world.citizens||[]).filter(other=>other.alive&&dist(other.position,position)<=radius).length;
}

function exploreCandidate(world,citizen,at){
  const target=explorationTarget(world,citizen,at),distance=dist(citizen.position,target);
  const localCrowd=Math.max(0,localCrowding(world,citizen.position,12)-1);

  const immediateKnownResource=(world.resourceDeposits||[]).some(deposit=>
    deposit.quantity>0 &&
    citizen.knownEntityIds.includes(deposit.id) &&
    knows(citizen,resourceConceptId(deposit)) &&
    dist(citizen.position,deposit.position)<=3
  );

  // Population density is a real local pressure. Useful resources underfoot
  // still win, but after a local routine completes the crowded center should
  // no longer dominate every decision indefinitely.
  const crowdPressure=immediateKnownResource
    ? Math.min(.18,Math.max(0,localCrowd-10)*.012)
    : Math.min(.55,Math.max(0,localCrowd-12)*.024);

  const opportunityPenalty=immediateKnownResource?.22:0;
  const visits=Number(citizen.explorationMap?.[explorationCellKey(target)]?.visits||0);
  const frontierGap=visits===0?.15:Math.max(.05,.15/(1+visits));

  return {
    family:'explore',
    key:`explore:${Math.floor(target.x)}:${Math.floor(target.y)}`,
    utility:Math.max(.03,.08+crowdPressure-opportunityPenalty-nightPressure(world)*.06),
    knowledgeGap:frontierGap,
    novelty:visits===0?.84:.52,
    effort:Math.min(1,distance/70),
    risk:.14+nightPressure(world)*.18,
    proposal:proposal('explore',[],[
      {
        type:'MOVE',
        durationMinutes:Math.max(6,Math.ceil(distance*2)),
        targetPosition:target,
        purpose:'explore',
        concepts:[]
      },
      {
        type:'OBSERVE',
        durationMinutes:12,
        purpose:'explore',
        concepts:[]
      },
    ])
  };
}
function terrainBlocksSleep(world,site){
  const kind=terrainAt(world,site.x,site.y).kind;
  return isSleepUnsafeTerrainKind(kind);
}

function buildTerrainConflict(world,site,footprintRadius=2.7,clearance=.55){
  const radius=Math.max(.5,Number(footprintRadius)||2.7)+Math.max(0,Number(clearance)||0);
  const samples=[{x:site.x,y:site.y}];
  for(const fraction of [.25,.5,.75,1]){
    const r=radius*fraction;
    for(let step=0;step<24;step++){
      const angle=step/24*Math.PI*2;
      samples.push({x:site.x+Math.cos(angle)*r,y:site.y+Math.sin(angle)*r});
    }
  }
  return samples.some(point=>terrainAt(world,point.x,point.y).kind==='river');
}

function buildSiteConflict(world,site,footprintRadius=2.7,buffer=1.9){
  const collides=(world.buildings||[]).some(building=>
    building?.position &&
    Math.hypot(site.x-building.position.x,site.y-building.position.y) <
      footprintRadius + Math.max(2.25,Number(building.footprintRadius)||2.25) + buffer
  ) || (world.projects||[]).some(project=>
    project?.status==='construction' &&
    project?.site &&
    Math.hypot(site.x-project.site.x,site.y-project.site.y) <
      footprintRadius + Math.max(2.15,Number(project.footprintRadius)||2.15) + buffer
  );
  return collides;
}

export function proposeBuildSite(world,citizen,at=world.clock.worldMinute){
  const footprintRadius=2.7,map=citizen.explorationMap||{},anchors=[{...citizen.position}];

  for(const [key,entry] of Object.entries(map)){
    if(Number(entry?.visits||0)<=0)continue;
    const [cx,cy]=key.split(':').map(Number);
    if(Number.isFinite(cx)&&Number.isFinite(cy))anchors.push({x:5+cx*10,y:5+cy*10});
  }
  for(const deposit of world.resourceDeposits||[]){
    if(deposit.quantity>0&&citizen.knownEntityIds.includes(deposit.id))anchors.push({...deposit.position});
  }

  const seen=new Set(),unique=[];
  for(const anchor of anchors){
    const key=`${Math.round(anchor.x)}:${Math.round(anchor.y)}`;
    if(!seen.has(key)){seen.add(key);unique.push(anchor);}
  }

  const candidates=[];
  for(let ai=0;ai<unique.length;ai++){
    const anchor=unique[ai];
    for(const radius of [4,7,10])for(let step=0;step<12;step++){
      const h=hash32(`${world.seed}|${citizen.id}|${Math.floor(at/120)}|build-site|${ai}|${radius}|${step}`);
      const angle=((h%10000)/10000)*Math.PI*2;
      const site={
        x:Math.max(4,Math.min(96,anchor.x+Math.cos(angle)*radius)),
        y:Math.max(4,Math.min(96,anchor.y+Math.sin(angle)*radius))
      };
      if(buildSiteConflict(world,site,footprintRadius)||buildTerrainConflict(world,site,footprintRadius)||isWaterTerrainKind(terrainAt(world,site.x,site.y).kind))continue;

      const crowd=rememberedCrowding(citizen,site,at,11);
      const buildings=(world.buildings||[]).filter(b=>b.position&&dist(b.position,site)<=14).length;
      const projects=(world.projects||[]).filter(pr=>pr.status==='construction'&&pr.site&&dist(pr.site,site)<=14).length;
      const visited=Number(map[explorationCellKey(site)]?.visits||0)>0?1:0;
      const knownResource=(world.resourceDeposits||[]).some(deposit=>deposit.quantity>0&&citizen.knownEntityIds.includes(deposit.id)&&dist(deposit.position,site)<=12)?1:0;
      const travel=Math.min(1,dist(citizen.position,site)/70);
      const score=
        visited*.45+
        knownResource*.38+
        ((h%997)/997)*.12-
        Math.min(1,crowd/12)*1.05-
        Math.min(1,(buildings+projects)/5)*1.1-
        travel*.38;
      candidates.push({site,score});
    }
  }

  candidates.sort((a,b)=>b.score-a.score||a.site.x-b.site.x||a.site.y-b.site.y);
  return candidates[0]?.site||null;
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
    const remaining=Math.max(0,project.workRequiredMinutes-project.workDoneMinutes);
    const workChunk=Math.min(45,Math.max(15,remaining));
    const action={type:'BUILD',durationMinutes:workChunk,targetId:project.id,purpose:'construct',concepts:conceptsForProject,payload:{projectId:project.id,workMinutes:workChunk}};
    const progress=project.workRequiredMinutes>0
      ? clamp01(project.workDoneMinutes/project.workRequiredMinutes)
      : 0;
    const continuityBoost=.38+.22*progress;

    candidates.push({
      family:project.initiatorId===citizen.id?'build':'cooperate',
      key:`build:${project.id}`,
      targetId:project.id,
      utility:.52+continuityBoost,
      relationship:project.initiatorId===citizen.id
        ? 0
        : clamp01(relation(citizen,project.initiatorId).trust),
      inventoryFit:1,
      novelty:.08,
      effort:Math.min(.55,distance/70),
      risk:.06,
      proposal:proposal(
        project.initiatorId===citizen.id?'build':'cooperate',
        conceptsForProject,
        distance>1
          ?[
            {
              type:'MOVE',
              durationMinutes:Math.max(2,Math.ceil(distance*2)),
              targetId:project.id,
              targetPosition:project.site,
              purpose:'cooperate',
              concepts:conceptsForProject
            },
            action
          ]
          :[action]
      )
    });
  }

  const testedHeld=held.filter(object=>knowledgeForEntity(citizen,object.id).length);
  if(testedHeld.length>=2&&!activeProjects.some(project=>project.initiatorId===citizen.id)){
    // Demand is evaluated where the Citizen currently lives/experiences the
    // problem, BEFORE looking for empty land. Empty land is not itself demand.
    const demand=constructionDemand(world,citizen,citizen.position,at);
    if(demand.shouldBuild){
      const conceptsForBuild=[...new Set(testedHeld.flatMap(object=>knowledgeForEntity(citizen,object.id).map(entry=>entry.concept)))].slice(0,12);
      const site=proposeBuildSite(world,citizen,at);
      if(site)candidates.push({
        family:'build',
        key:`build:new:${Math.floor(site.x)}:${Math.floor(site.y)}`,
        utility:.06+demand.score*.52,
        inventoryFit:1,
        knowledgeGap:.06,
        novelty:.10,
        effort:.34,
        risk:.18,
        proposal:proposal('build',conceptsForBuild,[
          ...(dist(citizen.position,site)>1.2?[{
            type:'MOVE',
            durationMinutes:Math.max(4,Math.ceil(dist(citizen.position,site)*2)),
            targetPosition:site,
            purpose:'construct',
            concepts:conceptsForBuild
          }]:[]),
          {
            type:'BUILD',
            durationMinutes:15,
            purpose:'construct',
            concepts:conceptsForBuild,
            payload:{
              inputObjectIds:testedHeld.map(object=>object.id),
              site,
              workMinutes:240,
              form:'structure',
              reasonSummary:'observed_unsheltered_need',
              reasonConceptIds:conceptsForBuild,
              demandEvidence:demand.evidence
            }
          }
        ])
      });
    }
  }

  candidates.push(exploreCandidate(world,citizen,at));
  candidates.push({family:'rest',key:'rest',utility:.04+clamp01(citizen.body.sleepPressure/100)*.35+nightPressure(world)*.1,novelty:0,effort:0,risk:0,proposal:proposal('rest',[],[{type:'REST',durationMinutes:20,purpose:'self_directed',concepts:[]}])});
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
  const candidateCooldown=Number(state.cooldowns?.[candidate.key]?.untilWorldMinute||0)>at;
  const familyCooldown=Number(state.cooldowns?.[`family:${candidate.family}`]?.untilWorldMinute||0)>at;
  const cooldown=candidateCooldown||familyCooldown?1:0;
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
