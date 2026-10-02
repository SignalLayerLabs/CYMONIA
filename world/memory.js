import {stableId} from './rng.js';

export const MAX_CITIZEN_MEMORIES=512;

export function trimCitizenMemories(citizen){
  const memories=citizen.memories;
  if(!Array.isArray(memories)||memories.length<=MAX_CITIZEN_MEMORIES)return 0;
  const trimmed=memories.length-MAX_CITIZEN_MEMORIES;
  memories.splice(0,trimmed);
  return trimmed;
}

export function recordMemory(citizen,{kind='episodic',content,source=null,confidence=.7,salience=.5,worldMinute=0}={}){
  const m={id:stableId('mem',citizen.id,citizen.memories.length,worldMinute,JSON.stringify(content)),kind,content,source,confidence:Math.max(0,Math.min(1,confidence)),salience:Math.max(0,Math.min(1,salience)),createdWorldMinute:worldMinute,lastRecalledWorldMinute:worldMinute};
  citizen.memories.push(m);
  trimCitizenMemories(citizen);
  return m;
}

export function decayMemories(citizen,nowMinute){
  for(const m of citizen.memories){
    const age=Math.max(0,nowMinute-m.lastRecalledWorldMinute);
    m.confidence=Math.max(.05,m.confidence-age/5_000_000*(1-m.salience*.8));
  }
  citizen.memories=citizen.memories.filter(m=>m.salience>.8||m.confidence>.08);
  trimCitizenMemories(citizen);
}
