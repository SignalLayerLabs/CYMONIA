import {WORLD_MINUTES_PER_DAY,WORLD_MINUTES_PER_YEAR} from './constants.js';

function renewalReservoir(type){if(type==='water')return 'waterKg';if(type==='food'||type==='timber')return 'biomassKg';if(type==='clay')return 'mineralKg';return null;}
export function advanceEnvironment(world,fromMinute,toMinute){
  const delta=Math.max(0,toMinute-fromMinute);if(!delta)return world.environment;
  const e=world.environment;e.naturalReservoirs??={waterKg:0,biomassKg:0,mineralKg:0};e.metabolicMatterKg??=0;
  const dayFraction=(toMinute%WORLD_MINUTES_PER_DAY)/WORLD_MINUTES_PER_DAY,yearFraction=(toMinute%WORLD_MINUTES_PER_YEAR)/WORLD_MINUTES_PER_YEAR;
  e.dayPhase=dayFraction;e.seasonPhase=yearFraction;
  e.temperatureC=Math.round((14+9*Math.sin(yearFraction*Math.PI*2-Math.PI/2)+4*Math.sin(dayFraction*Math.PI*2-Math.PI/2))*10)/10;
  const weather=Math.max(0,Math.sin(toMinute/3117+world.seed*.001)*.65+Math.sin(toMinute/791)*.35-.35);
  e.precipitation=Math.round(weather*1000)/1000;
  e.soilMoisture=Math.max(0,Math.min(1,Number(e.soilMoisture||.5)+e.precipitation*delta/5000-Math.max(0,e.temperatureC-15)*delta/2_000_000));
  e.pollution=Math.max(0,Number(e.pollution||0)-delta/2_000_000);
  for(const d of world.resourceDeposits){
    if(!(d.renewPerDay>0))continue;
    const reservoir=renewalReservoir(d.type),wanted=d.renewPerDay*(delta/WORLD_MINUTES_PER_DAY);
    if(!reservoir)continue;
    const available=Math.max(0,Number(e.naturalReservoirs[reservoir]||0)),actual=Math.min(wanted,available);
    d.quantity+=actual;e.naturalReservoirs[reservoir]=available-actual;
  }
  return e;
}
