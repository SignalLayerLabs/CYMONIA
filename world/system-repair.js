import {createSovereignGenesis} from './genesis.js';
import {appendEvent} from './ledger.js';
import {queueCognition} from './cognition-queue.js';

export const SYSTEM_REPAIR_ID='2026-10-30-survival-deterioration';
export const SYSTEM_REPAIR_MESSAGE='100 abitanti reinseriti a causa di un bug di sistema: corretto il deterioramento irreversibile della salute e la gestione delle risorse esaurite.';

// Explicit incident authorization, restricted to the existing production world.
// New identities preserve permanent deaths, old bodies, history and world time.
export function applySystemRepair(world,authorization){
  if(authorization!==SYSTEM_REPAIR_ID||world.worldId!=='sovereign-20260915'||
    world.clock.worldMinute<1941000||world.systemRepairs?.[SYSTEM_REPAIR_ID])return false;
  const at=world.clock.worldMinute;
  const newcomers=createSovereignGenesis({seed:20261030,realEpochMs:0}).citizens;
  const massKg=newcomers.reduce((sum,c)=>sum+c.body.massKg,0);
  const reservoirs=world.environment.naturalReservoirs;
  if(!(reservoirs?.biomassKg>=massKg))throw new Error('system_repair_insufficient_biomass');
  for(let i=0;i<newcomers.length;i++){
    const c=newcomers[i];
    c.id=`repair:${SYSTEM_REPAIR_ID}:${String(i+1).padStart(3,'0')}`;
    if(world.citizens.some(old=>old.id===c.id))throw new Error('system_repair_identity_collision');
    c.kind='SYSTEM_RECOVERY';c.knownEntityIds=[c.id];
    c.birthWorldMinute=at-c.body.ageMinutes;
  }
  const event=appendEvent(world,'SYSTEM_POPULATION_REPAIR','system',{
    repairId:SYSTEM_REPAIR_ID,message:SYSTEM_REPAIR_MESSAGE,populationInserted:100,
    citizenIds:newcomers.map(c=>c.id),massKg,materialSource:'naturalReservoirs.biomassKg',
    reason:'system_bug',previousLivingPopulation:world.citizens.filter(c=>c.alive).length,
  },[],at);
  reservoirs.biomassKg-=massKg;
  for(const c of newcomers){
    c.provenance={type:'SYSTEM_REPAIR',repairId:SYSTEM_REPAIR_ID,eventId:event.id,worldMinute:at};
    world.citizens.push(c);queueCognition(world,c,'arrival',.6,at,event.id);
  }
  world.systemRepairs??={};
  world.systemRepairs[SYSTEM_REPAIR_ID]={eventId:event.id,worldMinute:at,message:SYSTEM_REPAIR_MESSAGE,populationInserted:100};
  return true;
}
