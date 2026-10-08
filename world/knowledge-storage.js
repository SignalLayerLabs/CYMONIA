// Logical knowledge and standalone exports remain complete ordinary arrays.
// The Worker may persist these adapters as immutable compressed archive
// references; only that explicitly selected private checkpoint codec differs.
const stores=new WeakMap(),views=new WeakMap();
export function bindKnowledgeStorage(array,store){stores.set(array,store);return array;}
export function knowledgeStorage(array){return stores.get(array)||null;}
export function bindKnowledgeView(view,read){views.set(view,read);return view;}
export function knowledgeSnapshotValue(value){return views.get(value)?.()??value;}
export function activeKnowledgeCount(citizen){
  const store=knowledgeStorage(citizen.knowledge);
  return store?store.activeCount:citizen.knowledge.filter(k=>k.active!==false).length;
}
export function recentKnowledge(citizen,limit){
  const store=knowledgeStorage(citizen.knowledge);
  if(store)return store.recent(limit);
  const result=[];
  for(let i=citizen.knowledge.length-1;i>=0&&result.length<limit;i--)
    if(citizen.knowledge[i].active!==false)result.push(citizen.knowledge[i]);
  return result.reverse();
}
export function activeConcepts(citizen){
  const store=knowledgeStorage(citizen.knowledge);
  return store?store.activeConcepts():citizen.knowledge.filter(k=>k.active!==false).map(k=>k.concept);
}
export function knowledgeForEntity(citizen,entityId){
  const store=knowledgeStorage(citizen.knowledge);
  return store?store.forEntity(entityId):citizen.knowledge.filter(k=>k.active!==false&&
    k.provenance?.some(s=>s.evidence?.entityId===entityId));
}
