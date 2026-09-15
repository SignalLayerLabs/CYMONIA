import {stableId} from './rng.js';
import {learn,knows} from './epistemics.js';
import {appendEvent} from './ledger.js';

const SENSORY={
  water:{appearance:'moving reflective fluid',touch:'cool fluid',odor:'low',affordance:'biological attraction under hydration deficit'},
  food:{appearance:'small soft organic bodies',touch:'soft',odor:'distinct organic',affordance:'biological attraction under caloric deficit'},
  timber:{appearance:'tall rigid organic stems',touch:'fibrous rigid',odor:'organic'},
  stone:{appearance:'hard irregular fragments',touch:'hard cool',odor:'none'},
  clay:{appearance:'soft mineral earth near moisture',touch:'plastic when wet',odor:'earth'},
  ore:{appearance:'dense unusual mineral fragments',touch:'hard heavy',odor:'none'}
};
export function resourceConceptId(deposit){return stableId('k',deposit.id);}
export function structureConceptId(entity){return stableId('kstruct',entity.id);}
export function sensoryEvidence(deposit){return {...(SENSORY[deposit.type]||{appearance:'unclassified material'}),entityId:deposit.id,position:{...deposit.position}};}
export function perceiveResources(world,citizen,at=world.clock.worldMinute,radius=12){const learned=[];for(const d of world.resourceDeposits){if(Math.hypot(citizen.position.x-d.position.x,citizen.position.y-d.position.y)>radius)continue;const concept=resourceConceptId(d);if(!knows(citizen,concept)){const evidence=sensoryEvidence(d);const ev=appendEvent(world,'OBSERVATION',citizen.id,{concept,entityId:d.id,sensory:evidence},[],at);learn(citizen,concept,{kind:'observation',eventId:ev.id,entityId:d.id,evidence},.9,at);learned.push(concept);}if(!citizen.knownEntityIds.includes(d.id))citizen.knownEntityIds.push(d.id);}return learned;}
export function perceiveStructures(world,citizen,at=world.clock.worldMinute,radius=12){const learned=[];const entities=[...(world.buildings||[]),...(world.objects||[]).filter(o=>o.kind==='temporary_shelter'&&o.quantity>0)];for(const entity of entities){if(!entity.position||Math.hypot(citizen.position.x-entity.position.x,citizen.position.y-entity.position.y)>radius)continue;const concept=structureConceptId(entity);if(!knows(citizen,concept)){const evidence={entityId:entity.id,position:{...entity.position},appearance:'bounded physical cover',thermalProtection:Number(entity.properties?.thermalProtection??entity.protection?.thermal??.5),precipitationProtection:Number(entity.properties?.precipitationProtection??entity.protection?.precipitation??.5)};const ev=appendEvent(world,'OBSERVATION',citizen.id,{concept,entityId:entity.id,sensory:evidence},[],at);learn(citizen,concept,{kind:'observation',eventId:ev.id,entityId:entity.id,evidence},.85,at);learned.push(concept);}if(!citizen.knownEntityIds.includes(entity.id))citizen.knownEntityIds.push(entity.id);}return learned;}
