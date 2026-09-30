import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {learn} from '../world/epistemics.js';
import {enumerateAffordances} from '../world/affordances.js';
import {applyAcceptedPlan} from '../world/cognition.js';
import {advanceWorldTo} from '../world/engine.js';
import {
  constructionDemand,
  constructionNeedStillOpen,
  developmentPressureAt,
  ensureLivingWorld,
  recordSpatialObservation,
  resourceRenewalFactor,
} from '../world/living-world.js';

function preparedBuilder(seed=101){
  const world=createSovereignGenesis({seed,realEpochMs:0}),citizen=world.citizens[0];
  citizen.position={x:70,y:70};
  world.objects=world.objects.filter(o=>o.kind!=='temporary_shelter');
  for(let i=0;i<2;i++){
    const object={
      id:`tested-material:${i}`,kind:'gathered_material',material:'timber',
      quantity:1,massPerUnitKg:1,holderId:citizen.id,position:{...citizen.position},
      condition:1,provenance:{type:'GATHERED'}
    };
    world.objects.push(object);citizen.possessions.push(object.id);citizen.knownEntityIds.push(object.id);
    learn(citizen,`tested:${i}`,{kind:'experiment',evidence:{entityId:object.id,property:'hardness',value:.5}},.9,0);
  }
  return {world,citizen};
}

test('not knowing any structures is no longer construction demand',()=>{
  const {world,citizen}=preparedBuilder(101);
  citizen.body.sleepPressure=10;
  citizen.body.exposure={terrain:'meadow',rainExposure:0,thermalProtection:0,precipitationProtection:0,shelterId:null};
  const demand=constructionDemand(world,citizen,citizen.position,500);
  assert.equal(demand.shouldBuild,false);
  assert.deepEqual(demand.evidence.needCitizenIds,[]);
  const newBuild=enumerateAffordances(world,citizen,500).find(candidate=>candidate.key?.startsWith('build:new:'));
  assert.equal(newBuild,undefined);
});

test('observed unsheltered physical need can justify construction',()=>{
  const {world,citizen}=preparedBuilder(103);
  citizen.body.sleepPressure=88;
  citizen.body.exposure={terrain:'meadow',rainExposure:.6,thermalProtection:0,precipitationProtection:0,shelterId:null};
  const demand=constructionDemand(world,citizen,citizen.position,1000);
  assert.equal(demand.shouldBuild,true);
  assert.ok(demand.evidence.needCitizenIds.includes(citizen.id));
  assert.equal(constructionNeedStillOpen(world,demand.evidence,1001),true);
  const newBuild=enumerateAffordances(world,citizen,1000).find(candidate=>candidate.key?.startsWith('build:new:'));
  assert.ok(newBuild);
  assert.equal(newBuild.proposal.actions.at(-1).payload.demandEvidence.generation,2);
});

test('vacant known capacity blocks another structure even during shelter need',()=>{
  const {world,citizen}=preparedBuilder(105);
  citizen.body.sleepPressure=90;
  citizen.body.exposure={terrain:'meadow',rainExposure:.7,thermalProtection:0,precipitationProtection:0,shelterId:null};
  const building={
    id:'vacant:1',kind:'structure',position:{x:71,y:70},footprintRadius:2.5,
    condition:1,massKg:20,createdWorldMinute:100,provenance:{initiatorId:'someone'}
  };
  world.buildings.push(building);citizen.knownEntityIds.push(building.id);
  recordSpatialObservation(citizen,building.id,building.position,500,'structure');
  const demand=constructionDemand(world,citizen,citizen.position,500);
  assert.equal(demand.shouldBuild,false);
  assert.ok(demand.evidence.vacantCapacity>0);
});

test('legacy build plans without generation-2 demand evidence are closed',()=>{
  const {world}=preparedBuilder(107);
  assert.equal(constructionNeedStillOpen(world,null,500),false);
  assert.equal(constructionNeedStillOpen(world,{generation:1,needCitizenIds:['x'],origin:{x:50,y:50}},500),false);
});

test('dense development creates a real ecological cost',()=>{
  const world=createSovereignGenesis({seed:109,realEpochMs:0});
  const deposit=world.resourceDeposits.find(d=>d.type==='timber');
  const baseline=resourceRenewalFactor(world,deposit,0);
  assert.equal(baseline,1);
  for(let i=0;i<8;i++)world.buildings.push({
    id:`dense:${i}`,kind:'structure',
    position:{x:deposit.position.x+(i%4)*1.2,y:deposit.position.y+Math.floor(i/4)*1.2},
    footprintRadius:2.5,condition:1,massKg:20,createdWorldMinute:10,provenance:{}
  });
  assert.ok(developmentPressureAt(world,deposit.position,18)>.1);
  assert.ok(resourceRenewalFactor(world,deposit,100)<1);
});


test('hard need survives execution gate and starts a canonical project',()=>{
  const {world,citizen}=preparedBuilder(111);
  citizen.body.sleepPressure=92;
  citizen.body.exposure={
    terrain:'meadow',
    rainExposure:.7,
    thermalProtection:0,
    precipitationProtection:0,
    shelterId:null
  };

  const candidate=enumerateAffordances(world,citizen,1000).find(x=>x.key?.startsWith('build:new:'));
  assert.ok(candidate);
  const buildAction=candidate.proposal.actions.at(-1);
  assert.equal(buildAction.type,'BUILD');
  assert.equal(buildAction.payload.demandEvidence.generation,2);

  // Execute only the terminal BUILD here so the gate is checked while the
  // physical need that created the evidence is still open.
  world.clock.worldMinute=1000;
  citizen.currentActionId=null;
  applyAcceptedPlan(world,citizen,{
    source:'local',
    affordanceFamily:'build',
    concepts:[...candidate.proposal.concepts],
    actions:[buildAction],
  },1000);

  advanceWorldTo(world,1_020_000);

  const started=world.ledger.find(event=>event.type==='CONSTRUCTION_STARTED');
  assert.ok(started);
  assert.equal(started.payload?.demandEvidence?.generation,2);
  assert.ok(world.projects.some(project=>project.status==='construction'||project.status==='completed'));
});
