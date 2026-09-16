import {appendEvent} from './ledger.js';
import {stableId} from './rng.js';
import {MATERIAL_PROPERTIES} from './materials.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function impactKineticEnergyJ(massKg,speedMps){
  const m=Math.max(0,Number(massKg)||0),v=Math.max(0,Number(speedMps)||0);
  return .5*m*v*v;
}

function materialResistance(building){
  const materials=building?.materials||{};
  let mass=0,weighted=0;
  for(const [material,quantity] of Object.entries(materials)){
    const q=Math.max(0,Number(quantity)||0);
    if(!q)continue;
    const p=MATERIAL_PROPERTIES[material]||{};
    const strength=Math.max(25,Number(p.structuralIntegrity)||0,(Number(p.hardness)||.2)*250,(Number(p.toughness)||.2)*350,(Number(p.compressiveStrength)||0)*.35);
    mass+=q;weighted+=q*strength;
  }
  return mass?weighted/mass:90;
}

function fragmentCount(building,energy,resistance){
  const ratio=energy/Math.max(1,resistance*Math.max(1,Number(building.massKg)||1));
  return Math.max(4,Math.min(14,Math.round(4+Math.log2(1+ratio)*2)));
}

export function applyPhysicalImpact(world,{targetBuildingId,projectileMassKg,speedMps,actorId='world',causeIds=[]}={},at=world.clock.worldMinute){
  const building=(world.buildings||[]).find(b=>b.id===targetBuildingId);
  if(!building)throw new Error('impact_target_not_found');
  if(!(building.massKg>0)||building.condition<=0)throw new Error('impact_target_destroyed');
  const energyJ=impactKineticEnergyJ(projectileMassKg,speedMps);
  const resistance=materialResistance(building);
  const effectiveCapacityJ=Math.max(50,resistance*Math.max(1,building.massKg)*Math.max(.08,building.condition));
  const damage=clamp(energyJ/effectiveCapacityJ,0,.95);
  const impactEvent=appendEvent(world,'PHYSICAL_IMPACT',actorId,{buildingId:building.id,energyJ,projectileMassKg:Number(projectileMassKg)||0,speedMps:Number(speedMps)||0,resistance,previousCondition:building.condition},causeIds,at);
  if(energyJ<effectiveCapacityJ){
    building.condition=clamp(building.condition-Math.max(.005,damage*.35),0,1);
    appendEvent(world,'STRUCTURE_DAMAGED',actorId,{buildingId:building.id,condition:building.condition,energyJ},[impactEvent.id],at);
    return {fractured:false,energyJ,resistance,condition:building.condition};
  }
  const originalMass=Math.max(0,Number(building.massKg)||0);
  const count=fragmentCount(building,energyJ,resistance);
  const fragmentMass=originalMass/Math.max(1,count);
  const dominantMaterial=Object.entries(building.materials||{}).sort((a,b)=>Number(b[1])-Number(a[1]))[0]?.[0]||'composite';
  const fragments=[];
  for(let i=0;i<count;i++){
    const id=stableId('fragment',building.id,impactEvent.id,i),angle=(i/count)*Math.PI*2,radius=.22+(i%3)*.13;
    const o={id,kind:'debris',material:dominantMaterial,quantity:fragmentMass,massPerUnitKg:1,properties:{...(MATERIAL_PROPERTIES[dominantMaterial]||{})},holderId:null,position:{x:building.position.x+Math.cos(angle)*radius,y:building.position.y+Math.sin(angle)*radius},condition:clamp(building.condition*.6,.05,.8),provenance:{type:'FRACTURE',buildingId:building.id,eventId:impactEvent.id,index:i}};
    world.objects.push(o);fragments.push({id,massKg:fragmentMass,position:o.position});
  }
  building.condition=0;building.massKg=0;building.fracturedWorldMinute=at;
  const fractureEvent=appendEvent(world,'STRUCTURE_FRACTURED',actorId,{buildingId:building.id,position:{...building.position},energyJ,resistance,fragments},[impactEvent.id],at);
  return {fractured:true,energyJ,resistance,eventId:fractureEvent.id,fragments};
}
