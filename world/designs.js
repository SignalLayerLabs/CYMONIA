const MAX_PRIMITIVES=32;
const PRIMITIVES=new Set(['point','line','strip','panel','volume','block','frame','layer','enclosure','opening','ridge','shell','support','repeated_unit','surface_motif']);

function fail(reason){const error=new Error(reason);error.code=reason;throw error;}
function sorted(value){
  if(Array.isArray(value))return value.map(sorted);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])]));
  return value;
}
export function canonicalDesignJson(value){return JSON.stringify(sorted(value));}
export function designHash(value){let hash=2166136261;for(const character of canonicalDesignJson(value)){hash^=character.charCodeAt(0);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16).padStart(8,'0');}
function knownConcept(citizen,concept){return (citizen?.knowledge||[]).some(item=>(item.concept||item.id)===concept);}
function hasCycle(designs,id,parents,seen=new Set()){if(seen.has(id))return true;seen.add(id);return parents.some(parent=>parent===id||hasCycle(designs,parent,designs[parent]?.parentDesignIds||[],new Set(seen)));}
export function validateDesign(world,citizen,input){
  if(!input||typeof input!=='object')fail('design_invalid');
  const concepts=[...new Set(input.concepts||[])];
  if(!input.domain||!input.formCode)fail('design_shape_invalid');
  if(concepts.some(concept=>!knownConcept(citizen,concept)))fail('unknown_concept');
  const materials=input.materialRequirements||input.materials||{};
  for(const [material,quantity] of Object.entries(materials)){if(!Number.isFinite(quantity)||quantity<=0)fail('material_requirement_invalid');}
  const genome=input.visualGenome||{};
  const sequence=genome.primitiveSequence||[];
  if(sequence.length>MAX_PRIMITIVES)fail('genome_too_complex');
  for(const primitive of sequence){if(!PRIMITIVES.has(primitive.kind)&&!PRIMITIVES.has(primitive.shape))fail('genome_primitive_invalid');}
  const designs=Object.fromEntries((world?.designs||[]).map(design=>[design.id,design]));
  const parents=[...new Set(input.parentDesignIds||[])];
  if(parents.some(parent=>!designs[parent]))fail('unknown_parent_design');
  if(hasCycle(designs,input.id||'design:pending',parents))fail('design_genealogy_cycle');
  return true;
}
export function registerDesign(world,citizen,input,worldMinute=world?.clock?.worldMinute||0){
  validateDesign(world,citizen,input);
  world.designs ||= [];
  const parents=[...new Set(input.parentDesignIds||[])];
  const design={...structuredClone(input),id:input.id||'design:'+designHash({...input,creatorId:citizen.id,createdWorldMinute:worldMinute}),creatorId:citizen.id,parentDesignIds:parents,createdWorldMinute:worldMinute,materialRequirements:structuredClone(input.materialRequirements||input.materials||{}),visualGenome:structuredClone(input.visualGenome||{}),provenance:structuredClone(input.provenance||{origin:'citizen_invention',causalEventIds:[]})};
  if(world.designs.some(existing=>designHash(existing)===designHash(design)))fail('design_not_novel');
  world.designs.push(design);
  return design;
}
export function deriveDesign(world,citizen,parentDesignId,changes={},worldMinute=world?.clock?.worldMinute||0){
  const parent=world?.designs?.find(design=>design.id===parentDesignId);
  if(!parent)fail('unknown_parent_design');
  return registerDesign(world,citizen,{...structuredClone(parent),...structuredClone(changes),id:undefined,parentDesignIds:[parentDesignId],provenance:{origin:'design_derivation',parentDesignIds:[parentDesignId],causalEventIds:changes.causalEventIds||[]}},worldMinute);
}
export function publicDesign(design){return structuredClone({id:design.id,parentDesignIds:design.parentDesignIds||[],domain:design.domain,formCode:design.formCode,materialRequirements:design.materialRequirements,physical:design.physical,visualGenome:design.visualGenome,createdWorldMinute:design.createdWorldMinute,hash:designHash(design)});}
export function publicDesigns(world){return (world?.designs||[]).map(publicDesign);}
