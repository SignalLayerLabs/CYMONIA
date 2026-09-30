import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {learn} from '../world/epistemics.js';
import {enumerateAffordances} from '../world/affordances.js';
import {
  constructionDemand,
  ensureLivingWorld,
  recordSpatialObservation,
} from '../world/living-world.js';

function preparedBuilder(seed=101){
  const world=createSovereignGenesis({seed,realEpochMs:0}),citizen=world.citizens[0];
  citizen.position={x:70,y:70};
  world.objects=world.objects.filter(o=>o.kind!=='temporary_shelter');
  const materials=[];
  for(let i=0;i<2;i++){
    const object={
      id:`tested-material:${i}`,kind:'gathered_material',material:'timber',
      quantity:1,massPerUnitKg:1,holderId:citizen.id,position:{...citizen.position},
      condition:1,provenance:{type:'GATHERED'}
    };
    world.objects.push(object);
    citizen.possessions.push(object.id);
    citizen.knownEntityIds.push(object.id);
    learn(citizen,`tested:${i}`,{
      kind:'experiment',
      evidence:{entityId:object.id,property:'hardness',value:.5}
    },.9,0);
    materials.push(object);
  }
  return {world,citizen,materials};
}

test('unused known structure supply suppresses another new construction',()=>{
  const {world,citizen}=preparedBuilder(101);
  for(let i=0;i<4;i++){
    const building={
      id:`existing:${i}`,kind:'structure',position:{x:68+i*2,y:71},
      footprintRadius:2.5,condition:1,massKg:20,createdWorldMinute:100,
      provenance:{initiatorId:`someone:${i}`}
    };
    world.buildings.push(building);
    citizen.knownEntityIds.push(building.id);
    recordSpatialObservation(citizen,building.id,building.position,500,'structure');
  }
  const demand=constructionDemand(world,citizen,{x:72,y:72},500);
  assert.equal(demand.shouldBuild,false);
  assert.ok(demand.evidence.vacancyRatio>.5);
  const newBuild=enumerateAffordances(world,citizen,500).find(candidate=>candidate.key?.startsWith('build:new:'));
  assert.equal(newBuild,undefined);
});

test('crowding plus exposure can create construction demand without a global quota',()=>{
  const {world,citizen}=preparedBuilder(103);
  const building={
    id:'used:shelter',kind:'structure',position:{x:70,y:70},
    footprintRadius:2.2,condition:1,massKg:20,createdWorldMinute:50,
    provenance:{initiatorId:'someone'}
  };
  world.buildings.push(building);
  citizen.knownEntityIds.push(building.id);
  recordSpatialObservation(citizen,building.id,building.position,900,'structure');

  const use=ensureLivingWorld(world).structureUse;
  use[building.id]={
    minutes:3000,sleepMinutes:1800,visits:20,
    firstUseWorldMinute:100,lastUseWorldMinute:990,
    byCitizen:{}
  };

  for(let i=1;i<12;i++){
    const other=world.citizens[i];
    other.position={x:69+(i%4),y:69+(i%3)};
    recordSpatialObservation(citizen,other.id,other.position,990,'citizen');
  }
  citizen.body.exposure={rainExposure:.8,thermalProtection:.1,precipitationProtection:.1,terrain:'meadow'};
  world.environment.precipitation=.9;

  const demand=constructionDemand(world,citizen,{x:72,y:72},1000);
  assert.equal(demand.shouldBuild,true);
  assert.ok(demand.evidence.capacityGap>0);
  assert.ok(demand.evidence.exposureNeed>.5);
});

test('construction demand has no global structure cap',()=>{
  const {world,citizen}=preparedBuilder(107);
  citizen.knownEntityIds=[citizen.id,...citizen.possessions];
  citizen.spatialMemory={entities:{}};

  // A distant civilization can contain many structures. If this Citizen has
  // never perceived them, they are not omniscient evidence against a local need.
  for(let i=0;i<150;i++)world.buildings.push({
    id:`distant:${i}`,kind:'structure',
    position:{x:5+(i%10)*2,y:5+Math.floor(i/10)*1.5},
    footprintRadius:2.2,condition:1,massKg:20,createdWorldMinute:10,
    provenance:{initiatorId:`distant-citizen:${i}`}
  });

  const demand=constructionDemand(world,citizen,citizen.position,1000);
  assert.equal(demand.shouldBuild,true);
  assert.equal(demand.evidence.knownStructures,0);
});
