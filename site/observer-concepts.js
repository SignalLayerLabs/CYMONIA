const RESOURCE_LABELS={
  water:'Water source',
  food:'Edible resource',
  timber:'Timber source',
  stone:'Stone deposit',
  clay:'Clay deposit',
  ore:'Ore deposit',
};

const titleCase=value=>String(value||'').replace(/[_:-]+/g,' ').replace(/\b\w/g,m=>m.toUpperCase()).trim();
const clean=value=>String(value||'').replace(/\s+/g,' ').trim();

function provenanceRows(entry){
  return Array.isArray(entry?.provenance)?entry.provenance.filter(Boolean):[];
}
function provenanceEntityId(entry){
  for(const p of provenanceRows(entry)){
    const id=p?.entityId||p?.evidence?.entityId||p?.sourceEntityId;
    if(id)return String(id);
  }
  return null;
}
function findEntity(world,id){
  if(!world||!id)return null;
  const resource=(world.resourceDeposits||[]).find(x=>x.id===id);
  if(resource)return {kind:'resource',value:resource};
  const building=(world.buildings||[]).find(x=>x.id===id);
  if(building)return {kind:'building',value:building};
  const project=(world.projects||[]).find(x=>x.id===id);
  if(project)return {kind:'project',value:project};
  const object=(world.objects||[]).find(x=>x.id===id);
  if(object)return {kind:'object',value:object};
  return null;
}
function entityLabel(entity){
  if(!entity)return null;
  const value=entity.value||{};
  if(entity.kind==='resource')return RESOURCE_LABELS[value.type]||`${titleCase(value.type||'Natural')} resource`;
  if(entity.kind==='building'){
    const form=value.form||value.kind||value.type;
    return form?`${titleCase(form)} structure`:'Constructed structure';
  }
  if(entity.kind==='project'){
    const form=value.form||value.kind||value.type;
    return form?`${titleCase(form)} construction project`:'Construction project';
  }
  if(entity.kind==='object'){
    const material=titleCase(value.material);
    const kind=titleCase(value.kind||value.type||'object');
    return [material,kind].filter(Boolean).join(' ')||'Physical object';
  }
  return null;
}
function evidenceLabel(entry){
  for(const p of provenanceRows(entry)){
    const evidence=p?.evidence||{};
    const appearance=clean(evidence.appearance);
    if(appearance)return `Observed: ${appearance.slice(0,72)}`;
    const touch=clean(evidence.touch);
    if(touch)return `Observed material: ${touch.slice(0,64)}`;
    if(p?.kind==='communication')return 'Shared concept';
    if(p?.kind==='teaching')return 'Taught concept';
    if(p?.kind==='experiment')return 'Experimental concept';
  }
  return null;
}

export function observerConceptView(world,citizen,entry={}){
  const canonicalId=String(entry?.concept||'unknown');
  const token=citizen?.language?.lexicon?.[canonicalId]||null;
  const entityId=provenanceEntityId(entry);
  const entity=findEntity(world,entityId);
  let label=entityLabel(entity)||evidenceLabel(entry);
  if(!label&&canonicalId.startsWith('kstruct:'))label='Observed structure';
  if(!label&&token)label=`Shared concept “${token}”`;
  if(!label)label='Unknown observed concept';

  const confidence=Number.isFinite(Number(entry?.confidence))?Number(entry.confidence):null;
  const kinds=[...new Set(provenanceRows(entry).map(p=>p?.kind).filter(Boolean))];
  const tooltip=[
    `Observer interpretation: ${label}`,
    `Canonical concept: ${canonicalId}`,
    confidence===null?null:`Confidence: ${Math.round(confidence*100)}%`,
    kinds.length?`Learned by: ${kinds.join(', ')}`:null,
    entityId?`Entity: ${entityId}`:null,
    token?`Citizen word: ${token}`:null,
  ].filter(Boolean).join(' · ');

  return {label,canonicalId,confidence,token,entityId,sourceKinds:kinds,tooltip};
}
export function observerConceptLabel(world,citizen,entry){
  return observerConceptView(world,citizen,entry).label;
}
