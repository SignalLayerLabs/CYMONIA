import {knowledgeStorage} from '../../world/knowledge-storage.js';

const MAX_STRINGS=65536,MAX_UNITS=2*1024*1024;
const FORMAT='checkpoint-index-strings-v1',REFS='checkpoint-index-refs-v1';
const fail=()=>{throw new Error('knowledge_index_dictionary_invalid');};

// Only immutable strings are shared. Ordered personal index vectors retain
// membership; private evidence continues to live in the unchanged archive.
export function checkpointIndexDictionary(world){
  const strings=[],positions=new Map(),knownArrays=new WeakSet();let units=0;
  const add=value=>{
    if(typeof value!=='string'||positions.has(value)||value.length>4096||
      strings.length>=MAX_STRINGS||units+value.length>MAX_UNITS)return;
    positions.set(value,strings.length);strings.push(value);units+=value.length;
  };
  for(const citizen of world.citizens||[]){
    const store=knowledgeStorage(citizen.knowledge);if(!store)continue;
    for(const value of store.concepts)add(value);
    for(const value of store.entities){if(Array.isArray(value))for(const id of value)add(id);else add(value);}
    for(const id of store.fallbackIds.values())add(id);
    if(Array.isArray(citizen.knownEntityIds)){
      knownArrays.add(citizen.knownEntityIds);for(const id of citizen.knownEntityIds)add(id);
    }
  }
  return {strings,positions,knownArrays};
}

function encodeRef(value,dictionary,undefinedAsNull=false){
  if(typeof value==='string')return dictionary.positions.get(value)??value;
  if(value===undefined)return undefinedAsNull?[null]:[];
  // A one-element tuple distinguishes original numbers/arrays/objects from
  // numeric dictionary references. Strings outside the bound remain inline.
  return [value];
}
export function checkpointIndexHeader(dictionary){return {format:FORMAT,strings:dictionary.strings};}
export function encodeKnownIndex(values,dictionary){
  return {format:REFS,refs:values.map(value=>encodeRef(value,dictionary))};
}
export function encodeKnowledgeIndex(saved,dictionary){
  return {...saved,format:'knowledge-packed-v3',
    concepts:saved.concepts.map(value=>encodeRef(value,dictionary,true)),
    entities:saved.entities.map(value=>encodeRef(value,dictionary)),
    fallbackIds:saved.fallbackIds.map(([index,id])=>[index,encodeRef(id,dictionary)])};
}

export function readCheckpointIndexHeader(header){
  if(!header||header.format!==FORMAT||!Array.isArray(header.strings)||header.strings.length>MAX_STRINGS)fail();
  let units=0;
  for(const value of header.strings){if(typeof value!=='string'||value.length>4096||(units+=value.length)>MAX_UNITS)fail();}
  return header.strings;
}
function decodeRef(value,strings){
  if(!strings)throw new Error('knowledge_index_dictionary_missing');
  if(typeof value==='number'){
    if(!Number.isSafeInteger(value)||value<0||value>=strings.length)fail();
    return strings[value];
  }
  if(typeof value==='string')return value;
  if(Array.isArray(value)&&value.length<=1)return value[0];
  fail();
}
function decodeRefs(values,strings){
  if(!strings)throw new Error('knowledge_index_dictionary_missing');
  if(!Array.isArray(values))fail();
  return values.map(value=>decodeRef(value,strings));
}
export function restoreCitizenIndices(citizen,strings){
  const known=citizen?.knownEntityIds;
  if(known!=null&&!Array.isArray(known)){
    if(known.format!==REFS)fail();
    citizen.knownEntityIds=decodeRefs(known.refs,strings);
  }
  const saved=citizen?.knowledge;
  if(saved?.format==='knowledge-packed-v3'){
    saved.concepts=decodeRefs(saved.concepts,strings);
    saved.entities=decodeRefs(saved.entities,strings);
    if(!Array.isArray(saved.fallbackIds))fail();
    saved.fallbackIds=saved.fallbackIds.map(pair=>{
      if(!Array.isArray(pair)||pair.length!==2)fail();
      return [pair[0],decodeRef(pair[1],strings)];
    });
    saved.format='knowledge-packed-v2';
  }
  return citizen;
}
