import {shareLearnedEvidence} from './evidence-pool.js';
import {recordMemory} from './memory.js';
const knowledgeIndexes=new WeakMap();
const entityIndexes=new WeakMap();
export function knowsEntity(citizen,entityId){
  const entries=citizen.knownEntityIds;
  if(!Array.isArray(entries))return false;
  let index=entityIndexes.get(entries);
  if(!index||entries.length<index.length){
    index={length:0,ids:new Set()};
    entityIndexes.set(entries,index);
  }
  // Canonical entity lists are append-only. Replaced snapshot arrays and
  // truncated lists rebuild automatically; new IDs are indexed once.
  for(let i=index.length;i<entries.length;i++)index.ids.add(entries[i]);
  index.length=entries.length;
  return index.ids.has(entityId);
}
export function knowledgeEntry(citizen,concept){
  if(concept!==concept)return null;
  const entries=citizen.knowledge;
  let index=knowledgeIndexes.get(entries);
  if(!index||entries.length<index.length){index={length:0,concepts:new Map()};knowledgeIndexes.set(entries,index);}
  // Canonical knowledge is appended by learn() and deactivated by forget().
  // Index only new evidence; snapshot reloads/replaced arrays get a fresh index.
  for(let i=index.length;i<entries.length;i++){
    const entry=entries[i],current=index.concepts.get(entry.concept);
    if(entry.active!==false&&!current)index.concepts.set(entry.concept,entry);
  }
  index.length=entries.length;
  const entry=index.concepts.get(concept);
  if(!entry)return null;
  if(entry.active!==false)return entry;
  // Imported snapshots can contain several entries for one concept. Retain
  // Array.find's first-active semantics when the prior entry is forgotten.
  const replacement=entries.find(k=>k.concept===concept&&k.active!==false)||null;
  if(replacement)index.concepts.set(concept,replacement);else index.concepts.delete(concept);
  return replacement;
}
export function knows(citizen,concept){return Boolean(knowledgeEntry(citizen,concept));}
export function learn(citizen,concept,provenance,confidence=.7,worldMinute=0){if(!provenance?.kind)throw new Error('knowledge_provenance_required');shareLearnedEvidence(citizen,provenance);let k=knowledgeEntry(citizen,concept);if(k){k.confidence=Math.max(k.confidence,confidence);k.provenance.push(provenance);return k;}k={concept:String(concept),confidence:Math.max(0,Math.min(1,confidence)),provenance:[provenance],active:true,learnedWorldMinute:worldMinute};citizen.knowledge.push(k);recordMemory(citizen,{kind:'semantic',content:{concept},source:provenance,confidence,salience:.5,worldMinute});return k;}
export function forget(citizen,concept){const k=knowledgeEntry(citizen,concept);if(k)k.active=false;return Boolean(k);}
export function validateProposalKnowledge(world,citizen,proposal){for(const concept of proposal?.concepts||[]){if(!knows(citizen,concept))return {ok:false,reason:`unknown_concept:${concept}`};}for(const a of proposal?.actions||[]){for(const concept of a.concepts||[]){if(!knows(citizen,concept))return {ok:false,reason:`unknown_concept:${concept}`};}}return {ok:true};}
