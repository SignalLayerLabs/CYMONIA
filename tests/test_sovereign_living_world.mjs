import test from 'node:test';
import assert from 'node:assert/strict';
import {createSovereignGenesis} from '../world/genesis.js';
import {startAction,completeDueActions} from '../world/actions.js';
import {travelProfile} from '../world/terrain.js';
import {
  actionEfficiency,
  constructionPhase,
  deriveSettlements,
  deriveStockpiles,
  ensureLivingWorld,
  publicLivingWorld,
  recordHarvest,
  recordPractice,
  recordStructureUse,
  recordTravel,
  rememberedCrowding,
  resourceRenewalFactor,
  riverHydrology,
  trailMultiplierAt,
} from '../world/living-world.js';

test('movement leaves bounded trails that make repeated travel physically easier',()=>{
  const world=createSovereignGenesis({seed:20260915,realEpochMs:0});
  const citizen=world.citizens[0];
  citizen.position={x:10,y:10};
  const target={x:30,y:10};
  const before=travelProfile(world,citizen,target).minimumMinutes;
  const action=startAction(world,citizen,{type:'MOVE',durationMinutes:1,targetPosition:target,purpose:'explore'},0);
  completeDueActions(world,action.endsWorldMinute);
  assert.ok(Object.keys(ensureLivingWorld(world).traffic.cells).length>0);
  assert.ok(trailMultiplierAt(world,20,10,action.endsWorldMinute)<1);
  citizen.position={x:10,y:10};
  const after=travelProfile(world,citizen,target).minimumMinutes;
  assert.ok(after<=before);
  assert.ok(publicLivingWorld(world,action.endsWorldMinute).trails.length>0);
});

test('spatial crowd knowledge does not become omniscient',()=>{
  const world=createSovereignGenesis({seed:7,realEpochMs:0}),citizen=world.citizens[0];
  assert.equal(rememberedCrowding(citizen,{x:80,y:80},100,10),0);
});

test('resource pressure reduces renewal without making it negative',()=>{
  const world=createSovereignGenesis({seed:11,realEpochMs:0}),deposit=world.resourceDeposits.find(x=>x.type==='timber');
  const before=resourceRenewalFactor(world,deposit,0);
  recordHarvest(world,deposit,30,10);
  const after=resourceRenewalFactor(world,deposit,11);
  assert.ok(after>0);
  assert.ok(after<before);
});

test('construction phases expose gradual physical progress',()=>{
  const project={status:'construction',workDoneMinutes:0,workRequiredMinutes:100};
  assert.equal(constructionPhase(project),'site');
  project.workDoneMinutes=15;assert.equal(constructionPhase(project),'foundation');
  project.workDoneMinutes=40;assert.equal(constructionPhase(project),'frame');
  project.workDoneMinutes=65;assert.equal(constructionPhase(project),'roof');
  project.workDoneMinutes=90;assert.equal(constructionPhase(project),'enclosed');
  project.status='completed';assert.equal(constructionPhase(project),'complete');
});

test('transformed tools and practice can improve physical action efficiency',()=>{
  const world=createSovereignGenesis({seed:13,realEpochMs:0}),citizen=world.citizens[0];
  const base=actionEfficiency(world,citizen,'BUILD');
  world.objects.push({id:'tool:1',kind:'frame',material:'composite',quantity:1,massPerUnitKg:1,holderId:citizen.id,position:{...citizen.position},properties:{hardness:.8,toughness:.9,structuralIntegrity:420},provenance:{type:'TRANSFORMATION'}});
  recordPractice(citizen,'BUILD',600);
  assert.ok(actionEfficiency(world,citizen,'BUILD')>base);
});

test('unheld material clusters become observer stockpiles, not property',()=>{
  const world=createSovereignGenesis({seed:17,realEpochMs:0});
  world.objects.push({id:'loose:a',kind:'gathered_material',material:'timber',quantity:2,massPerUnitKg:1,holderId:null,position:{x:70,y:70},condition:1});
  world.objects.push({id:'loose:b',kind:'gathered_material',material:'stone',quantity:2,massPerUnitKg:1,holderId:null,position:{x:71,y:70},condition:1});
  const stock=deriveStockpiles(world).find(x=>x.objectIds.includes('loose:a'));
  assert.ok(stock);
  assert.equal(stock.observerOnly,true);
});

test('repeated structure use can support an observer-only settlement classification',()=>{
  const world=createSovereignGenesis({seed:19,realEpochMs:0});
  world.buildings=[
    {id:'b:a',position:{x:70,y:70},condition:1,massKg:20},
    {id:'b:b',position:{x:76,y:72},condition:1,massKg:20},
  ];
  for(let i=0;i<5;i++)world.citizens[i].position={x:72,y:71};
  for(let n=0;n<20;n++)for(let i=0;i<5;i++)recordStructureUse(world,world.citizens[i],world.citizens[i].position,30,100+n*30);
  const settlements=deriveSettlements(world,800);
  assert.ok(settlements.length>=1);
  assert.equal(settlements[0].observerOnly,true);
});

test('river hydrology responds to rain and soil moisture',()=>{
  const world=createSovereignGenesis({seed:23,realEpochMs:0});
  world.environment.precipitation=0;world.environment.soilMoisture=.3;
  const dry=riverHydrology(world,50);
  world.environment.precipitation=1;world.environment.soilMoisture=1;
  const wet=riverHydrology(world,50);
  assert.ok(wet.halfWidth>dry.halfWidth);
  assert.ok(wet.flow>dry.flow);
  assert.ok(wet.depth>dry.depth);
});


test('untouched renewable deposits preserve the sovereign baseline rate',()=>{
  const world=createSovereignGenesis({seed:31,realEpochMs:0});
  for(const deposit of world.resourceDeposits.filter(d=>d.renewPerDay>0)){
    assert.equal(resourceRenewalFactor(world,deposit,1),1);
  }
});
