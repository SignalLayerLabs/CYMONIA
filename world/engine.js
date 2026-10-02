import {compactOperationalState} from './operational-state.js';
import {worldMinuteAt} from './clock.js';
import {advanceEnvironment} from './environment.js';
import {advanceBody,killCitizen,restoreHydration,restoreCalories} from './biology.js';
import {completeDueActions,activeAction,startAction,positionAt} from './actions.js';
import {learn,knows,knowsEntity} from './epistemics.js';
import {recordMemory,decayMemories} from './memory.js';
import {appendEvent} from './ledger.js';
import {stableId} from './rng.js';
import {survivalFallback,localDeliberation,validateCognitiveProposal,applyAcceptedPlan,continuePlan} from './cognition.js';
import {classifyHistory,why as whyEvent,publicEventPayload,publicPhysicalReceipt} from './observer.js';
import {perceiveObjects,perceiveResources,perceiveStructures} from './perception.js';
import {advancePregnancies,conceive} from './reproduction.js';
import {advanceDisease} from './disease.js';
import {communicate,coinSignal} from './language.js';
import {shareBelief} from './beliefs.js';
import {makeCommitment,makeClaim,maybeFormOrganization,updateRelationship} from './society.js';
import {runExperiment,applyConstructionWork,beginEmpiricalConstruction} from './artifacts.js';
import {transferObject,transformMaterials,objectMass,advanceDecomposition} from './materials.js';
import {ageCognitionDebt,recordAffordanceOutcome} from './cognition-state.js';
import {recordStrategyOutcome} from './strategy.js';
import {queueCognition} from './cognition-queue.js';
import {advanceLivingWorld,constructionNeedStillOpen,constructionPhase,publicLivingWorld,recordHarvest,recordSpatialObservation,recordStructureUse,reputationSummary,structureUseSummary} from './living-world.js';
import {advanceDestructionState,applyDestruction,applyRepair,createGrievance,publicGrievances} from './destruction.js';
import {maybeLearnRoutineFromExperience,programSummary} from './programming.js';
import {executePhysicalOperations} from './physical-operations.js';
import {hasPhysicalPayload,physicalActionView} from './physical-actions.js';
import {knownProcedure,rememberProcedure,recordProcedureOutcome,learnProcedure,teachProcedure,modifyProcedure,decayProcedureKnowledge,procedureSummary} from './procedures.js';

function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function perceiveLocal(world,citizen,at,positions){const position=positions.get(citizen.id);const discoveries=[...perceiveResources(world,citizen,at,null,position),...perceiveStructures(world,citizen,at,null,position),...perceiveObjects(world,citizen,at,null,position)];if(discoveries.length)queueCognition(world,citizen,'discovery',.65,at,discoveries[0]);for(const other of world.citizens){if(other.id===citizen.id||!other.alive)continue;const otherPosition=positions.get(other.id);if(dist(position,otherPosition)>8)continue;recordSpatialObservation(citizen,other.id,otherPosition,at,'citizen');if(!knowsEntity(citizen,other.id)){citizen.knownEntityIds.push(other.id);queueCognition(world,citizen,'encounter',.5,at,other.id);recordMemory(citizen,{kind:'episodic',content:{encounter:other.id},source:{kind:'observation'},confidence:.9,salience:.45,worldMinute:at});}}}
function runReflex(world,citizen,at){
  if(!citizen.alive||citizen.currentActionId)return;
  let proposal;
  try{
    proposal=survivalFallback(world,citizen,at)||localDeliberation(world,citizen,at);
  }catch(error){
    appendEvent(world,'LOCAL_COGNITION_DEFERRED',citizen.id,{
      error:String(error?.message||error).slice(0,160),fallback:'OBSERVE'
    },[],at);
  }
  if(proposal){
    try{
      applyAcceptedPlan(world,citizen,proposal,at);
      return;
    }catch(error){
      appendEvent(world,'LOCAL_PLAN_REJECTED',citizen.id,{
        error:String(error?.message||error).slice(0,160),fallback:'OBSERVE'
      },[],at);
    }
  }
  // If even the safe action fails, the alarm handler must see the error.
  if(!citizen.currentActionId)startAction(world,citizen,{
    type:'OBSERVE',durationMinutes:10,purpose:'orientation'
  },at);
}
function gather(world,c,a,at){const d=world.resourceDeposits.find(x=>x.id===a.targetId);if(!d)return;const q=Math.max(.1,Math.min(Number(a.payload?.quantity)||1,d.quantity));d.quantity-=q;recordHarvest(world,d,q,at);const o={id:stableId('obj',d.id,c.id,world.objects.length,at),kind:'gathered_material',material:d.type,quantity:q,massPerUnitKg:1,properties:null,holderId:c.id,position:{...c.position},condition:1,provenance:{type:'GATHERED',depositId:d.id,actionId:a.id}};world.objects.push(o);c.possessions.push(o.id);if(!knowsEntity(c,o.id))c.knownEntityIds.push(o.id);appendEvent(world,'RESOURCE_GATHERED',c.id,{objectId:o.id,depositId:d.id,quantity:q},[a.id],at);}
function consumeFromDeposit(world,c,a,type,amount,restore,at){const d=world.resourceDeposits.find(x=>x.id===a.targetId&&x.type===type);if(!d||d.quantity<amount)return;d.quantity-=amount;world.environment.metabolicMatterKg=(world.environment.metabolicMatterKg||0)+amount;restore(c);appendEvent(world,type==='water'?'DRANK_RESOURCE':'ATE_RESOURCE',c.id,{depositId:d.id,quantity:amount},[a.id],at);}
function pickup(world,c,a,at){
  const o=world.objects.find(x=>x.id===a.targetId&&x.quantity>0&&(x.holderId===null||x.holderId===undefined));
  if(!o||!o.position)throw new Error('pickup_target_unavailable');
  if(dist(c.position,o.position)>2.5)throw new Error('pickup_target_too_far');
  o.holderId=c.id;o.position={...c.position};c.possessions??=[];if(!c.possessions.includes(o.id))c.possessions.push(o.id);
  appendEvent(world,'OBJECT_PICKED_UP',c.id,{objectId:o.id},[],at);return o;
}
function drop(world,c,a,at){
  const id=a.payload?.objectId,o=world.objects.find(x=>x.id===id&&x.holderId===c.id&&x.quantity>0);
  if(!o)throw new Error('drop_object_unavailable');
  o.holderId=null;o.position={...c.position};c.possessions=(c.possessions||[]).filter(x=>x!==o.id);
  appendEvent(world,'OBJECT_DROPPED',c.id,{objectId:o.id,position:o.position},[],at);return o;
}
function genericTransform(world,c,a,at){const ids=a.payload?.inputObjectIds||[];if(!ids.length)return null;const quantities=a.payload?.quantities||[];const consume=[];let total=0;for(let i=0;i<ids.length;i++){const o=world.objects.find(x=>x.id===ids[i]&&x.holderId===c.id);if(!o)continue;const q=Math.max(.01,Math.min(Number(quantities[i])||o.quantity,o.quantity));consume.push({objectId:o.id,quantity:q});total+=q*o.massPerUnitKg;}if(!consume.length||total<=0)return null;return transformMaterials(world,c,{consume,output:{material:'composite',quantity:total,massPerUnitKg:1,kind:a.payload?.form||'artifact'},process:a.type.toLowerCase()},at);}
function build(world,c,a,at){if(a.payload?.projectId)return applyConstructionWork(world,c,a.payload.projectId,a.payload?.workMinutes||a.endsWorldMinute-a.startedWorldMinute,at);const ids=a.payload?.inputObjectIds||[];if(!ids.length||!a.payload?.site||!(a.concepts||[]).length)return null;const evidence=a.payload?.demandEvidence||null;if(!constructionNeedStillOpen(world,evidence,at))throw new Error(evidence?'construction_demand_resolved':'construction_demand_evidence_required');const p=beginEmpiricalConstruction(world,c,{concepts:a.concepts,inputObjectIds:ids,workMinutes:a.payload.workMinutes||120,form:a.payload.form||'structure',site:a.payload.site,whySummary:a.payload?.reasonSummary||null,reasonConceptIds:a.payload?.reasonConceptIds||a.concepts,demandEvidence:evidence},at);a.payload.projectId=p.id;return applyConstructionWork(world,c,p.id,a.endsWorldMinute-a.startedWorldMinute,at);}
function primitiveCommunicate(world,c,a,at){const t=world.citizens.find(x=>x.id===a.targetId&&x.alive);if(!t)return;const signal=a.payload?.primitiveSignal;if(signal&&c.language.primitiveSignals.includes(signal)){appendEvent(world,'COMMUNICATION',c.id,{receiverId:t.id,primitiveSignal:signal},[a.id],at);recordMemory(t,{kind:'episodic',content:{primitiveSignal:signal,from:c.id},source:{kind:'communication'},confidence:.9,salience:.7,worldMinute:at});updateRelationship(world,c,t.id,{familiarity:.015},at);updateRelationship(world,t,c.id,{familiarity:.02},at);return;}if(a.payload?.beliefId){shareBelief(world,c,t,a.payload.beliefId,at);updateRelationship(world,c,t.id,{familiarity:.025,trust:.005},at);updateRelationship(world,t,c.id,{familiarity:.03},at);return;}const concepts=(a.payload?.conceptIds?.length?a.payload.conceptIds:[a.payload?.concept]).filter(Boolean).filter(x=>knows(c,x));if(concepts.length){const before=t.knowledge.filter(k=>k.active!==false).length,tokens=concepts.map(x=>coinSignal(world,c,x,at));const result=communicate(world,c,t,{concepts,tokens},at);updateRelationship(world,c,t.id,{familiarity:.02},at);updateRelationship(world,t,c.id,{familiarity:.025},at);if(t.knowledge.filter(k=>k.active!==false).length>before)queueCognition(world,t,'new_concept',.72,at,result.receiverInterpretations.find(Boolean));}}
function resolvePhysicalAction(world,c,a,at){
  const p=a.payload;let procedure=p.procedureId?knownProcedure(world,c,p.procedureId):null;
  if(p.procedureId&&!procedure)throw new Error('procedure_not_known');
  if(p.variantOfProcedureId){procedure=modifyProcedure(world,c,p.variantOfProcedureId,p.operations,at);p.procedureId=procedure.id;}
  let receipt;
  try{receipt=executePhysicalOperations(world,c,procedure?.operations||p.operations,{inputObjectIds:p.inputObjectIds,actionId:a.id,procedureId:procedure?.id||null,at,workMinutes:Math.min(1440,a.endsWorldMinute-a.startedWorldMinute)});}
  catch(error){if(procedure)recordProcedureOutcome(world,c,procedure.id,{ok:false,reason:String(error.message).slice(0,120)},at);throw error;}
  a.physicalReceiptId=receipt.id;a.physicalEventId=receipt.eventId;
  // Physical truth has committed. Memory capacity must never turn successful
  // matter transformations into a reported physical failure.
  try{
    const remembered=procedure?recordProcedureOutcome(world,c,procedure.id,{ok:true,receipt},at):rememberProcedure(world,c,receipt,at);
    a.payload.procedureId=remembered.id;
    for(const id of receipt.observerIds){const observer=world.citizens.find(x=>x.id===id);if(!observer?.alive)continue;try{learnProcedure(world,observer,remembered.id,{kind:'observation',from:c.id,eventId:receipt.eventId,confidence:.4},at);}catch{}}
  }catch(error){appendEvent(world,'PROCEDURE_MEMORY_DEFERRED',c.id,{receiptId:receipt.id,reason:String(error.message).slice(0,120)},[receipt.eventId],at);}
  queueCognition(world,c,'material_event',.7,at,receipt.eventId);
  return receipt;
}
function resolveAction(world,a,at){const c=world.citizens.find(x=>x.id===a.actorId);if(!c||!c.alive)return;if(hasPhysicalPayload(a)){resolvePhysicalAction(world,c,a,at);return;}if(a.type==='DRINK')consumeFromDeposit(world,c,a,'water',.7,x=>restoreHydration(x,30),at);else if(a.type==='EAT')consumeFromDeposit(world,c,a,'food',.3,x=>restoreCalories(x,25),at);else if(a.type==='GATHER')gather(world,c,a,at);else if(a.type==='PICKUP')pickup(world,c,a,at);else if(a.type==='DROP')drop(world,c,a,at);else if(a.type==='DESTROY'||a.type==='DISMANTLE')applyDestruction(world,c,a.targetId,{mode:a.type,effortMinutes:a.payload?.effortMinutes||a.endsWorldMinute-a.startedWorldMinute},at);else if(a.type==='REPAIR')applyRepair(world,c,a.targetId,a.payload?.materialObjectId,{effortMinutes:a.payload?.effortMinutes||a.endsWorldMinute-a.startedWorldMinute},at);else if(a.type==='TEACH'&&a.payload?.procedureId){const target=world.citizens.find(x=>x.id===a.targetId&&x.alive);if(!target)throw new Error('procedure_receiver_unavailable');teachProcedure(world,c,target,a.payload.procedureId,{actionId:a.id,imperfect:Boolean(a.payload.imperfect)},at);updateRelationship(world,c,target.id,{familiarity:.02,trust:.01},at);updateRelationship(world,target,c.id,{familiarity:.03,trust:.025},at);}else if(a.type==='TEACH'){const target=world.citizens.find(x=>x.id===a.targetId&&x.alive),concept=a.payload?.concept;if(target&&concept&&knows(c,concept)){const known=knows(target,concept);learn(target,concept,{kind:'teaching',from:c.id,eventId:a.id},.65,at);updateRelationship(world,c,target.id,{familiarity:.02,trust:.01},at);updateRelationship(world,target,c.id,{familiarity:.03,trust:.025},at);if(!known)queueCognition(world,target,'new_concept',.72,at,a.id);}}else if(a.type==='COMMUNICATE')primitiveCommunicate(world,c,a,at);else if(a.type==='PROMISE'){const t=world.citizens.find(x=>x.id===a.targetId&&x.alive);const cm=makeCommitment(world,c,{kind:a.payload?.kindCode||'other',counterpartyId:a.targetId,terms:{purposeConcept:a.payload?.purposeConcept||null}},at);if(t){updateRelationship(world,c,t.id,{familiarity:.02,obligation:.03},at);updateRelationship(world,t,c.id,{familiarity:.01},at);if(cm.kind==='join')maybeFormOrganization(world,c,t,a.payload?.purposeConcept,at);}}else if(a.type==='CLAIM')makeClaim(world,c,{subject:a.payload?.subjectId||a.targetId||c.id,predicate:a.payload?.predicateCode||'other',purposeConcept:a.payload?.purposeConcept||null},at);else if(a.type==='EXPERIMENT'){const experiment=runExperiment(world,c,{inputConcepts:a.concepts||[],targetIds:a.payload?.targetIds||[],method:a.payload?.methodCode||'observe'},at);if(experiment.discoveredConceptIds.length)queueCognition(world,c,'experiment_success',.78,at,experiment.id);}else if(a.type==='BUILD'){const project=build(world,c,a,at);if(project?.status==='completed')queueCognition(world,c,'construction_completed',.9,at,project.id);}else if(a.type==='TRANSFER'&&a.payload?.objectId&&a.targetId){transferObject(world,a.payload.objectId,a.targetId,at);const target=world.citizens.find(x=>x.id===a.targetId&&x.alive);if(target){updateRelationship(world,c,target.id,{familiarity:.02,trust:.018,affection:.008},at);updateRelationship(world,target,c.id,{familiarity:.025,trust:.025,affection:.012},at);}}else if(['CUT','DIG','HEAT','COOL','MIX','ASSEMBLE'].includes(a.type)){const object=genericTransform(world,c,a,at);if(object)queueCognition(world,c,'material_event',.64,at,object.id);}else if(a.type==='CARE'){const t=world.citizens.find(x=>x.id===a.targetId&&x.alive);if(t&&c.body.calories>15){c.body.calories-=2;restoreCalories(t,8);restoreHydration(t,5);appendEvent(world,'CARE_GIVEN',c.id,{targetId:t.id},[a.id],at);updateRelationship(world,c,t.id,{affection:.035,trust:.02},at);updateRelationship(world,t,c.id,{affection:.045,trust:.05},at);}}else if(a.type==='ATTACK'){const t=world.citizens.find(x=>x.id===a.targetId&&x.alive);if(t){const harm=4+Math.round(c.psychology.aggression*12);t.body.health=Math.max(0,t.body.health-harm);t.body.injuries.push({source:a.id,severity:harm/100,worldMinute:at});const event=appendEvent(world,'VIOLENCE',c.id,{against:t.id,harm},[a.id],at);createGrievance(world,t.id,c.id,{targetId:t.id,severity:Math.min(.8,harm/25),causeId:event.id,kind:'violence'},at);updateRelationship(world,c,t.id,{trust:-.08,affection:-.06},at);updateRelationship(world,t,c.id,{trust:-.16,affection:-.12,fear:.18},at);queueCognition(world,c,'conflict',.88,at,event.id);queueCognition(world,t,'conflict',.95,at,event.id);if(t.body.health<=0)killCitizen(world,t,'trauma',at);}}else if(a.type==='REPRODUCE'){const t=world.citizens.find(x=>x.id===a.targetId&&x.alive);if(t){try{const pregnancy=conceive(world,c,t,at);queueCognition(world,c,'reproduction',.76,at,pregnancy.id);queueCognition(world,t,'reproduction',.76,at,pregnancy.id);}catch{}}}}
function nextBoundary(world,cursor,target){let next=Math.min(target,cursor+30);for(const a of world.actions)if(a.status==='active'&&a.endsWorldMinute>cursor)next=Math.min(next,a.endsWorldMinute);for(const c of world.citizens){const due=c.body.pregnancy?.dueWorldMinute;if(due>cursor)next=Math.min(next,due);}return Math.max(cursor+1,next);}
function stepSegment(world,from,to){
  advanceEnvironment(world,from,to);const delta=to-from;advanceDecomposition(world,delta,to);advanceLivingWorld(world,from,to);advanceDestructionState(world,to);decayProcedureKnowledge(world,from,to);
  const positions=new Map(world.citizens.map(c=>{const action=activeAction(world,c);return [c.id,action?.type==='MOVE'?positionAt(c,action,to):c.position];}));
  for(const c of world.citizens){advanceBody(world,c,delta);advanceDisease(world,c,from,to);if(c.alive){const physicalPosition=positions.get(c.id);recordStructureUse(world,c,physicalPosition,delta,to);ageCognitionDebt(c,delta);decayMemories(c,to);perceiveLocal(world,c,to,positions);if(c.body.health<=0)killCitizen(world,c,'disease_or_biology',to);}}
  advancePregnancies(world,to);world.clock.worldMinute=to;
  const completed=completeDueActions(world,to);
  for(const action of completed){
    const citizen=world.citizens.find(item=>item.id===action.actorId);
    const plan=action.planId?citizen?.plans.find(item=>item.id===action.planId):null;
    let resolved=true,failureReason=null;
    try{resolveAction(world,action,action.endsWorldMinute);}
    catch(error){
      resolved=false;failureReason=String(error?.message||error).slice(0,160);
      const event=appendEvent(world,'ACTION_RESOLUTION_FAILED',action.actorId,{actionId:action.id,type:action.type,reason:failureReason},[action.id],action.endsWorldMinute);
      if(citizen?.alive){
        if(plan)plan.status='failed';
        if(plan?.affordanceFamily)recordAffordanceOutcome(citizen,plan.affordanceFamily,{ok:false,reason:failureReason},action.endsWorldMinute);
        recordStrategyOutcome(world,citizen,{ok:false,family:plan?.affordanceFamily||action.type.toLowerCase()},action.endsWorldMinute);
        recordMemory(citizen,{kind:'episodic',content:{actionFailure:{actionId:action.id,type:action.type,reason:failureReason}},source:{kind:'physical_outcome',eventId:event.id},confidence:1,salience:.75,worldMinute:action.endsWorldMinute});
        queueCognition(world,citizen,'physical_action_failed',.85,action.endsWorldMinute,event.id);
      }
    }
    if(resolved&&citizen?.alive&&!continuePlan(world,citizen,action,action.endsWorldMinute)){
      if(plan?.affordanceFamily){recordAffordanceOutcome(citizen,plan.affordanceFamily,{ok:true},action.endsWorldMinute);maybeLearnRoutineFromExperience(world,citizen,plan.affordanceFamily,action.endsWorldMinute);}
      recordStrategyOutcome(world,citizen,{ok:true,family:plan?.affordanceFamily||action.type.toLowerCase()},action.endsWorldMinute);
      queueCognition(world,citizen,'plan_completed',.42,action.endsWorldMinute,action.id);
    }
  }
  for(const c of world.citizens)if(c.alive&&!c.currentActionId)runReflex(world,c,to);
}
export function advanceWorldTo(world,nowMs=Date.now()){compactOperationalState(world);const target=worldMinuteAt(world,nowMs);let cursor=world.clock.worldMinute;if(target<=cursor)return world;while(cursor<target){const next=nextBoundary(world,cursor,target);stepSegment(world,cursor,next);compactOperationalState(world);cursor=next;}for(const c of world.citizens){const last=c.cognition.lastReflectionMinute;if(c.alive&&(last===null||target-last>=10080)){queueCognition(world,c,'reflection',.2,target);c.cognition.lastReflectionMinute=target;}}return world;}
export function createHumanAvatar(world,{externalId,displayName=null,massKg=70},at=world.clock.worldMinute){if(world.citizens.some(c=>c.externalId===externalId))return world.citizens.find(c=>c.externalId===externalId);if(world.reserves.observerEmbodimentKg<massKg)throw new Error('embodiment_reserve_depleted');world.reserves.observerEmbodimentKg-=massKg;const id=stableId('human',externalId),genome={metabolism:1,immuneResilience:1,physicalCapacity:1,sensorySensitivity:1,fertility:.75,lifespanYears:82,temperamentBias:0};const c={id,kind:'HUMAN_LINKED',selfName:null,observerDisplayName:displayName,externalId,birthWorldMinute:at,deathWorldMinute:null,alive:true,position:{x:50,y:50},genome,body:{massKg,hydration:92,calories:92,sleepPressure:5,temperatureC:36.6,health:100,injuries:[],diseases:[],fertility:.75,pregnancy:null,reproductiveRole:'non_gestating',ageMinutes:25*525600,alive:true},psychology:{curiosity:.6,riskTolerance:.5,socialDrive:.6,aggression:.2,empathy:.6,noveltySeeking:.6,stress:0,fear:0,attachment:.2,confidence:.5},knowledge:[],memories:[],knownEntityIds:[id],skills:{},language:{primitiveSignals:['attention','danger','need','point','accept','reject'],lexicon:{},heard:{},grammarPatterns:{}},relationships:{},beliefs:[],possessions:[],goals:[],activeGoal:null,plans:[],currentActionId:null,commitments:[],programs:[],cognition:{lastReflectionMinute:null,pending:true,reason:'arrival'}};world.citizens.push(c);const event=appendEvent(world,'HUMAN_AVATAR_EMBODIED',c.id,{massKg,source:'OBSERVER_EMBODIMENT_RESERVE'},[],at);queueCognition(world,c,'arrival',.95,at,event.id);return c;}
export function submitHumanIntent(world,citizenId,intent,at=world.clock.worldMinute){const c=world.citizens.find(x=>x.id===citizenId&&x.kind==='HUMAN_LINKED');if(!c||!c.alive)throw new Error('human_avatar_unavailable');world.privateHumanIntents[c.id]={intent:String(intent||'').slice(0,2000),worldMinute:at};const event=appendEvent(world,'EXTERNAL_DIRECTION_RECEIVED',c.id,{hasDirection:true},[],at);queueCognition(world,c,'human_direction',1,at,event.id);return {citizenId:c.id,queued:true};}
export function acceptCognitiveProposal(world,citizenId,proposal,at=world.clock.worldMinute){const c=world.citizens.find(x=>x.id===citizenId);if(!c||!c.alive)throw new Error('citizen_unavailable');const v=validateCognitiveProposal(world,c,proposal);if(!v.ok)throw new Error(v.reason);appendEvent(world,'COGNITIVE_PLAN_ACCEPTED',c.id,{conceptIds:proposal.concepts||[],actionTypes:(proposal.actions||[]).map(x=>x.type),contextKnowledgeCount:c.knowledge.filter(k=>k.active!==false).length},[],at);return applyAcceptedPlan(world,c,proposal,at);}
const PUBLIC_OBSERVER_LIMITS=Object.freeze({
  knowledge:28,
  lexicon:32,
  knownEntities:64,
  relationships:32,
  possessions:64,
});
function publicKnowledgeView(citizen){
  const knowledge=Array.isArray(citizen.knowledge)?citizen.knowledge:[];
  let count=0;
  for(const entry of knowledge)if(entry?.active!==false)count++;
  if(citizen.kind==='HUMAN_LINKED')return {count};
  const items=[];
  for(let i=knowledge.length-1;i>=0&&items.length<PUBLIC_OBSERVER_LIMITS.knowledge;i--){
    const entry=knowledge[i];
    if(entry?.active===false)continue;
    items.push({concept:entry.concept,confidence:entry.confidence,provenance:entry.provenance});
  }
  items.reverse();
  return count<=PUBLIC_OBSERVER_LIMITS.knowledge?items:{count,items};
}
function publicLexiconView(language){
  const entries=Object.entries(language?.lexicon||{});
  return {
    lexicon:Object.fromEntries(entries.length<=PUBLIC_OBSERVER_LIMITS.lexicon?entries:entries.slice(-PUBLIC_OBSERVER_LIMITS.lexicon)),
    count:entries.length,
  };
}
function relationshipScore(value){
  return Math.max(Math.abs(Number(value?.trust)||0),Math.abs(Number(value?.affection)||0),Math.abs(Number(value?.fear)||0),Math.abs(Number(value?.obligation)||0),Math.abs(Number(value?.familiarity)||0));
}
function publicRelationshipView(citizen){
  const entries=Object.entries(citizen.relationships||{});
  if(entries.length<=PUBLIC_OBSERVER_LIMITS.relationships)return {relationships:Object.fromEntries(entries),count:entries.length};
  entries.sort((a,b)=>relationshipScore(b[1])-relationshipScore(a[1])||a[0].localeCompare(b[0]));
  return {relationships:Object.fromEntries(entries.slice(0,PUBLIC_OBSERVER_LIMITS.relationships)),count:entries.length};
}
function publicCitizenBoundedViews(citizen){
  const lexicon=publicLexiconView(citizen.language);
  const relationships=publicRelationshipView(citizen);
  const known=Array.isArray(citizen.knownEntityIds)?citizen.knownEntityIds:[];
  const possessions=Array.isArray(citizen.possessions)?citizen.possessions:[];
  return {
    knowledge:publicKnowledgeView(citizen),
    language:{primitiveSignals:citizen.language?.primitiveSignals||[],lexicon:lexicon.lexicon,lexiconCount:lexicon.count},
    knownEntityIds:known.length<=PUBLIC_OBSERVER_LIMITS.knownEntities?[...known]:known.slice(-PUBLIC_OBSERVER_LIMITS.knownEntities),
    knownEntityCount:known.length,
    relationships:relationships.relationships,
    relationshipCount:relationships.count,
    possessions:possessions.length<=PUBLIC_OBSERVER_LIMITS.possessions?[...possessions]:possessions.slice(-PUBLIC_OBSERVER_LIMITS.possessions),
    possessionCount:possessions.length,
  };
}

export function publicWorld(world,nowMs=Date.now()){const at=world.clock.worldMinute;return {version:world.version,worldId:world.worldId,clock:{...world.clock},environment:world.environment,citizens:world.citizens.map(c=>{const action=activeAction(world,c),pos=action?positionAt(c,action,at):c.position,procedures=procedureSummary(world,c);return {id:c.id,kind:c.kind,selfName:c.selfName,observerDisplayName:c.kind==='HUMAN_LINKED'?c.observerDisplayName:null,alive:c.alive,birthWorldMinute:c.birthWorldMinute,deathWorldMinute:c.deathWorldMinute,position:pos,body:{hydration:c.body.hydration,calories:c.body.calories,sleepPressure:c.body.sleepPressure,health:c.body.health,ageMinutes:c.body.ageMinutes,temperatureC:c.body.temperatureC,exposure:c.body.exposure||null,reproductiveRole:c.body.reproductiveRole||null,pregnancy:c.body.pregnancy?{dueWorldMinute:c.body.pregnancy.dueWorldMinute}:null,diseases:c.body.diseases.length,injuries:c.body.injuries.length},psychology:c.psychology,skills:c.skills||{},reputation:reputationSummary(c),...publicCitizenBoundedViews(c),programs:programSummary(c),procedures,procedureCount:procedures.filter(p=>p.active).length,parentIds:c.parentIds||[],caregiverIds:c.caregiverIds||[],activeGoal:c.activeGoal,currentAction:action?{...physicalActionView(world,c,action,at),id:action.id,type:action.type,purpose:action.purpose,startedWorldMinute:action.startedWorldMinute,endsWorldMinute:action.endsWorldMinute,fromPosition:action.fromPosition,targetPosition:action.targetPosition,targetId:action.targetId,path:action.path||null,physics:action.physics||null}:null};}),objects:world.objects.filter(o=>o.quantity>0).map(o=>({id:o.id,kind:o.kind,material:o.material||null,quantity:o.quantity,massPerUnitKg:o.massPerUnitKg,holderId:o.holderId,position:o.position,condition:o.condition,properties:o.properties||null,temperatureC:o.temperatureC??null,burning:Boolean(o.burning),geometry:o.geometry||null,lastPhysicalEventId:o.lastPhysicalEventId||null,provenance:o.provenance})),resourceDeposits:world.resourceDeposits.map(d=>({id:d.id,type:d.type,quantity:d.quantity,position:d.position})),buildings:world.buildings.map(b=>({...b,occupants:world.citizens.filter(c=>c.alive&&Math.hypot(c.position.x-b.position.x,c.position.y-b.position.y)<=1.8).map(c=>c.id),use:structureUseSummary(world,b.id,at)})),organizations:world.organizations,claims:world.claims,grievances:publicGrievances(world,at),projects:world.projects.map(p=>({...p,phase:constructionPhase(p)})),livingWorld:publicLivingWorld(world,at),history:classifyHistory(world).entries.slice(0,200),recentLedger:world.ledger.slice(-80).filter(e=>['PHYSICAL_IMPACT','STRUCTURE_DAMAGED','STRUCTURE_FRACTURED','ENTITY_DAMAGED','ENTITY_DESTROYED','RESOURCE_PATCH_DAMAGED','REPAIR_COMPLETED','GRIEVANCE_CREATED','PROGRAM_CREATED','PROGRAM_TRIGGERED','PHYSICAL_OPERATIONS_EXECUTED','PROCEDURE_DISCOVERED','PROCEDURE_MODIFIED','PROCEDURE_TRANSMITTED','PROCEDURE_LOST'].includes(e.type)).map(e=>({id:e.id,type:e.type,worldMinute:e.worldMinute,actorId:e.actorId,payload:publicEventPayload(e),causes:e.causes})),physicalReceipts:(world.physicalReceipts||[]).slice(-32).map(publicPhysicalReceipt),ledgerHead:world.ledgerHead};}
export function getHistory(world){return classifyHistory(world);}export function getWhy(world,eventId){return whyEvent(world,eventId);}export function markCitizenDead(world,citizenId,cause,at=world.clock.worldMinute){const c=world.citizens.find(x=>x.id===citizenId);if(!c)throw new Error('citizen_not_found');return killCitizen(world,c,cause,at);}
