import {REAL_MS_PER_WORLD_MINUTE,WORLD_MINUTES_PER_DAY,WORLD_MINUTES_PER_YEAR} from './constants.js';
export function worldMinuteAt(world,nowMs=Date.now()){
  const elapsed=Math.max(0,Number(nowMs)-Number(world.clock.realEpochMs));
  return Math.floor(elapsed/REAL_MS_PER_WORLD_MINUTE);
}
export function worldDate(minute){
  const m=Math.max(0,Math.floor(minute));
  const year=Math.floor(m/WORLD_MINUTES_PER_YEAR)+1;
  const rem=m%WORLD_MINUTES_PER_YEAR;
  const day=Math.floor(rem/WORLD_MINUTES_PER_DAY)+1;
  const hour=Math.floor((rem%WORLD_MINUTES_PER_DAY)/60);
  const minuteOfHour=rem%60;
  return {year,day,hour,minute:minuteOfHour,label:`Y${year} D${day} ${String(hour).padStart(2,'0')}:${String(minuteOfHour).padStart(2,'0')}`};
}
