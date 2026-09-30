export const ACTION_TYPES_VISUAL=Object.freeze(["MOVE", "OBSERVE", "REST", "SLEEP", "EAT", "DRINK", "GATHER", "CARRY", "CUT", "DIG", "HEAT", "COOL", "MIX", "ASSEMBLE", "BUILD", "CARE", "TEACH", "COMMUNICATE", "EXPERIMENT", "ATTACK", "DEFEND", "TRANSFER", "PROMISE", "CLAIM", "REPRODUCE", "DESTROY", "DISMANTLE", "REPAIR", "PICKUP", "DROP"]);
export function actionImageURL(type){
  const key=String(type||'').toUpperCase();
  if(!ACTION_TYPES_VISUAL.includes(key))return null;
  return new URL(`./assets/action-icons/${key.toLowerCase()}.svg`,import.meta.url).href;
}
export function actionImageHTML(type,{className='action-image',alt=true}={}){
  const url=actionImageURL(type);if(!url)return '';
  const label=String(type||'').toUpperCase();
  return `<img class="${className}" src="${url}" alt="${alt?label+' action':''}" loading="lazy" decoding="async">`;
}
export const EVENT_ACTION_VISUAL=Object.freeze({
  CONSTRUCTION_STARTED:'BUILD',BUILDING_COMPLETED:'BUILD',RESOURCE_GATHERED:'GATHER',
  EXPERIMENT_COMPLETED:'EXPERIMENT',COMMUNICATION:'COMMUNICATE',SIGNAL_COINED:'COMMUNICATE',
  VIOLENCE:'ATTACK',CARE_GIVEN:'CARE',OBJECT_TRANSFERRED:'TRANSFER',
  ENTITY_DAMAGED:'DESTROY',ENTITY_DESTROYED:'DESTROY',RESOURCE_PATCH_DAMAGED:'DESTROY',
  REPAIR_COMPLETED:'REPAIR',OBJECT_PICKED_UP:'PICKUP',OBJECT_DROPPED:'DROP',
  PROGRAM_CREATED:'EXPERIMENT',PROGRAM_TRIGGERED:'OBSERVE'
});
