import {appendEvent} from './ledger.js';
import {stableId} from './rng.js';
import {environmentalExposure} from './terrain.js';

export function advanceBody(world,citizen,deltaMinutes){
  if(!citizen.alive)return citizen.body;
  const d=Math.max(0,Number(deltaMinutes)),b=citizen.body;b.ageMinutes+=d;b.hydration=Math.max(0,b.hydration-d/43.2);b.calories=Math.max(0,b.calories-d/120);b.sleepPressure=Math.min(100,b.sleepPressure+d/9.6);
  if(b.pregnancy){b.calories=Math.max(0,b.calories-d/900);b.hydration=Math.max(0,b.hydration-d/1400);}
  let healthLoss=0;if(b.hydration<15)healthLoss+=(15-b.hydration)*d/5000;if(b.calories<10)healthLoss+=(10-b.calories)*d/9000;if(b.sleepPressure>95)healthLoss+=(b.sleepPressure-95)*d/12000;
  const years=b.ageMinutes/525600,limit=citizen.genome?.lifespanYears||82;if(years>limit)healthLoss+=(years-limit)*d/180000;
  const ambient=Number(world.environment?.temperatureC??18),exposure=environmentalExposure(world,citizen),cold=Math.max(0,8-ambient),heat=Math.max(0,ambient-34),thermal=(cold+heat)*(1-exposure.thermalProtection);
  if(thermal>0){healthLoss+=thermal*d/2200;b.calories=Math.max(0,b.calories-thermal*d/6000);}
  if(exposure.rainExposure>.02){const wet=exposure.rainExposure;healthLoss+=wet*d/18000;b.sleepPressure=Math.min(100,b.sleepPressure+wet*d/180);b.calories=Math.max(0,b.calories-wet*d/5000);}
  if(exposure.terrain==='river'){b.calories=Math.max(0,b.calories-d/4200);b.sleepPressure=Math.min(100,b.sleepPressure+d/8000);}
  b.temperatureC=36.6+Math.max(-4,Math.min(4,(ambient-20)*(1-exposure.thermalProtection)*.035));b.health=Math.max(0,b.health-healthLoss);b.exposure={terrain:exposure.terrain,rainExposure:exposure.rainExposure,thermalProtection:exposure.thermalProtection,precipitationProtection:exposure.precipitationProtection,shelterId:exposure.shelterId};return b;
}
export function restoreHydration(citizen,amount=20){citizen.body.hydration=Math.min(100,citizen.body.hydration+amount);}
export function restoreCalories(citizen,amount=18){citizen.body.calories=Math.min(100,citizen.body.calories+amount);}
export function restoreSleep(citizen,amount=35){citizen.body.sleepPressure=Math.max(0,citizen.body.sleepPressure-amount);}
export function killCitizen(world,citizen,cause='unknown',at=world.clock.worldMinute){if(!citizen.alive)return citizen;citizen.alive=false;citizen.body.alive=false;citizen.deathWorldMinute=at;citizen.currentActionId=null;const corpseId=stableId('corpse',citizen.id,at);if(!world.objects.some(o=>o.id===corpseId))world.objects.push({id:corpseId,kind:'corpse',material:'biomass',quantity:Math.max(0,Number(citizen.body.massKg)||0),massPerUnitKg:1,holderId:null,position:{...citizen.position},condition:1,provenance:{type:'CORPSE',citizenId:citizen.id,deathWorldMinute:at,cause}});appendEvent(world,'DEATH',citizen.id,{cause,position:citizen.position,corpseObjectId:corpseId},[],at);return citizen;}
