// Sharing immutable historical data is a storage representation. Each
// Citizen still owns its own concepts, confidence and provenance records.
const citizenPools=new WeakMap();
import {knowledgeStorage} from './knowledge-storage.js';

function freezeEvidence(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freezeEvidence(child);
    Object.freeze(value);
  }
  return value;
}

export function createEvidencePool({maxCodeUnits=4*1024*1024,maxEntries=16384}={}){
  const entries=new Map(),canonical=new WeakSet();
  let codeUnits=0,deduplicatedEvidence=0;
  const pool={
    intern(value){
      if(!value||typeof value!=='object'||canonical.has(value))return value;
      let key;
      try{key=JSON.stringify(value);}catch{return value;}
      if(!key||key.length>8192||key.length>maxCodeUnits)return value;
      const prior=entries.get(key);
      if(prior){
        entries.delete(key);entries.set(key,prior);
        deduplicatedEvidence++;
        return prior;
      }
      const retained=freezeEvidence(value);
      canonical.add(retained);
      entries.set(key,retained);codeUnits+=key.length;
      while(entries.size>maxEntries||codeUnits>maxCodeUnits){
        const oldest=entries.keys().next().value;
        entries.delete(oldest);codeUnits-=oldest.length;
      }
      return retained;
    },
    hydrateCitizen(citizen){
      if(citizenPools.get(citizen)===pool)return citizen;
      citizenPools.set(citizen,pool);
      for(const entry of knowledgeStorage(citizen.knowledge)?[]:citizen.knowledge||[]){
        for(const source of entry.provenance||[])shareLearnedEvidence(citizen,source);
      }
      for(const memory of citizen.memories||[])shareLearnedEvidence(citizen,memory.source);
      return citizen;
    },
    stats(){return {deduplicatedEvidence,pooledEvidence:entries.size,evidencePoolCodeUnits:codeUnits};},
  };
  return pool;
}

export function shareLearnedEvidence(citizen,source){
  const pool=citizenPools.get(citizen);
  if(pool&&source?.evidence)source.evidence=pool.intern(source.evidence);
  return source;
}
