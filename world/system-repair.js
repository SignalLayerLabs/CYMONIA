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

export const HUMAN_SYSTEM_REPAIR_ID='2026-10-30-github-survival-recovery';
const PRE_FIX_DEATH_CUTOFF=1942898;

// Exceptional operator-authorized correction of pre-fix GitHub avatar deaths.
// Retain citizen/external IDs so existing D1 identity links remain valid.
export function applyHumanSystemRepair(world,authorization){
  if(authorization!==HUMAN_SYSTEM_REPAIR_ID||world.worldId!=='sovereign-20260915'||
    world.clock.worldMinute<PRE_FIX_DEATH_CUTOFF||world.systemRepairs?.[HUMAN_SYSTEM_REPAIR_ID])return false;
  const citizens=world.citizens.filter(c=>c.kind==='HUMAN_LINKED'&&!c.alive&&
    Number.isFinite(c.deathWorldMinute)&&c.deathWorldMinute<=PRE_FIX_DEATH_CUTOFF);
  const massKg=citizens.reduce((sum,c)=>sum+c.body.massKg,0);
  const reservoirs=world.environment.naturalReservoirs;
  if(!(reservoirs?.biomassKg>=massKg))throw new Error('human_system_repair_insufficient_biomass');
  const at=world.clock.worldMinute;
  const message=`${citizens.length} abitanti collegati a GitHub reinseriti a causa di un bug di sistema. Identità e collegamenti GitHub preservati; decessi precedenti conservati nel registro dell’intervento.`;
  const previousDeaths=citizens.map(c=>({citizenId:c.id,deathWorldMinute:c.deathWorldMinute}));
  const event=appendEvent(world,'SYSTEM_POPULATION_REPAIR','system',{
    repairId:HUMAN_SYSTEM_REPAIR_ID,message,populationRestored:citizens.length,
    citizenIds:citizens.map(c=>c.id),previousDeaths,massKg,
    materialSource:'naturalReservoirs.biomassKg',reason:'system_bug',
  },[],at);
  reservoirs.biomassKg-=massKg;
  for(const c of citizens){
    c.systemRecovery={repairId:HUMAN_SYSTEM_REPAIR_ID,eventId:event.id,worldMinute:at,previousDeathWorldMinute:c.deathWorldMinute};
    c.alive=true;c.deathWorldMinute=null;c.currentActionId=null;c.activeGoal=null;
    c.body={...c.body,alive:true,health:100,hydration:95,calories:95,sleepPressure:10,
      temperatureC:36.6,injuries:[],diseases:[],pregnancy:null,exposure:null};
    for(const plan of c.plans||[])if(plan.status==='active')plan.status='cancelled';
    for(const action of world.actions)if(action.actorId===c.id&&action.status==='active')action.status='cancelled';
    c.cognition.pending=true;c.cognition.reason='system_recovery';
    queueCognition(world,c,'arrival',.6,at,event.id);
  }
  world.systemRepairs??={};
  world.systemRepairs[HUMAN_SYSTEM_REPAIR_ID]={eventId:event.id,worldMinute:at,message,populationRestored:citizens.length,previousDeaths};
  return true;
}
