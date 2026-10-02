import {stableId} from './rng.js';
import {learn,knows,knowsEntity} from './epistemics.js';
import {appendEvent} from './ledger.js';
import {localVisibilityRadius,recordSpatialObservation} from './living-world.js';

const SENSORY={
  water:{appearance:'moving reflective fluid',touch:'cool fluid',odor:'low',affordance:'biological attraction under hydration deficit'},
  food:{appearance:'small soft organic bodies',touch:'soft',odor:'distinct organic',affordance:'biological attraction under caloric deficit'},
  timber:{appearance:'tall rigid organic stems',touch:'fibrous rigid',odor:'organic'},
  stone:{appearance:'hard irregular fragments',touch:'hard cool',odor:'none'},
  clay:{appearance:'soft mineral earth near moisture',touch:'plastic when wet',odor:'earth'},
  ore:{appearance:'dense unusual mineral fragments',touch:'hard heavy',odor:'none'}
};
const EXPLORATION_CELL=10;
export function explorationCellKey(position){
  const x=Math.max(0,Math.min(9,Math.floor(Number(position?.x||0)/EXPLORATION_CELL)));
  const y=Math.max(0,Math.min(9,Math.floor(Number(position?.y||0)/EXPLORATION_CELL)));
  return `${x}:${y}`;
}
export function recordExplorationVisit(citizen,position,at=0){
  citizen.explorationMap??={};
  const key=explorationCellKey(position);
  const current=citizen.explorationMap[key]||{visits:0,lastWorldMinute:null};
  current.visits=Math.min(1000000,Number(current.visits||0)+1);
  current.lastWorldMinute=at;
  citizen.explorationMap[key]=current;
  return current;
}

export function resourceConceptId(deposit){return stableId('k',deposit.id);}
export function structureConceptId(entity){return stableId('kstruct',entity.id);}
export function sensoryEvidence(deposit){return {...(SENSORY[deposit.type]||{appearance:'unclassified material'}),entityId:deposit.id,position:{...deposit.position}};}
export function perceiveResources(world,citizen,at=world.clock.worldMinute,radius=null,position=citizen.position){const learned=[],senseRadius=radius??localVisibilityRadius(world,12);recordExplorationVisit(citizen,position,at);for(const d of world.resourceDeposits){if(Math.hypot(position.x-d.position.x,position.y-d.position.y)>senseRadius)continue;recordSpatialObservation(citizen,d.id,d.position,at,'resource');const concept=resourceConceptId(d);if(!knows(citizen,concept)){const evidence=sensoryEvidence(d);const ev=appendEvent(world,'OBSERVATION',citizen.id,{concept,entityId:d.id,sensory:evidence},[],at);learn(citizen,concept,{kind:'observation',eventId:ev.id,entityId:d.id,evidence},.9,at);learned.push(concept);}if(!knowsEntity(citizen,d.id))citizen.knownEntityIds.push(d.id);}return learned;}
export function perceiveStructures(world,citizen,at=world.clock.worldMinute,radius=null,position=citizen.position){const learned=[],senseRadius=radius??localVisibilityRadius(world,12);const entities=[...(world.buildings||[]),...(world.objects||[]).filter(o=>o.kind==='temporary_shelter'&&o.quantity>0),...(world.projects||[]).filter(p=>p.status==='construction'&&p.site).map(p=>({...p,kind:'construction_site',position:p.site,protection:{thermal:0,precipitation:0}}))];for(const entity of entities){if(!entity.position||Math.hypot(position.x-entity.position.x,position.y-entity.position.y)>senseRadius)continue;recordSpatialObservation(citizen,entity.id,entity.position,at,entity.kind==='construction_site'?'project':'structure');const concept=structureConceptId(entity);if(!knows(citizen,concept)){const evidence={entityId:entity.id,position:{...entity.position},appearance:entity.kind==='construction_site'?'active material construction site':'bounded physical cover',thermalProtection:Number(entity.properties?.thermalProtection??entity.protection?.thermal??.5),precipitationProtection:Number(entity.properties?.precipitationProtection??entity.protection?.precipitation??.5)};const ev=appendEvent(world,'OBSERVATION',citizen.id,{concept,entityId:entity.id,sensory:evidence},[],at);learn(citizen,concept,{kind:'observation',eventId:ev.id,entityId:entity.id,evidence},.85,at);learned.push(concept);}if(!knowsEntity(citizen,entity.id))citizen.knownEntityIds.push(entity.id);}return learned;}

export function objectConceptId(object){return stableId('kobject',object.id);}
export function perceiveObjects(world,citizen,at=world.clock.worldMinute,radius=null,position=citizen.position){
  const learned=[],senseRadius=radius??localVisibilityRadius(world,12);
  for(const object of world.objects||[]){
    if(!(object.quantity>0)||!object.position||object.holderId===citizen.id)continue;
    if(Math.hypot(position.x-object.position.x,position.y-object.position.y)>senseRadius)continue;
    recordSpatialObservation(citizen,object.id,object.position,at,'object');
    const concept=objectConceptId(object);
    if(!knows(citizen,concept)){
      const material=SENSORY[object.material]||{appearance:`loose ${object.material||object.kind||'matter'}`,touch:'unknown'};
      const evidence={...material,entityId:object.id,position:{...object.position},kind:object.kind,condition:Number(object.condition??1)};
      const ev=appendEvent(world,'OBSERVATION',citizen.id,{concept,entityId:object.id,sensory:evidence},[],at);
      learn(citizen,concept,{kind:'observation',eventId:ev.id,entityId:object.id,evidence},.82,at);learned.push(concept);
    }
    if(!knowsEntity(citizen,object.id))citizen.knownEntityIds.push(object.id);
  }
  return learned;
}
