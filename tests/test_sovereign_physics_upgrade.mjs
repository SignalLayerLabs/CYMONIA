import test from 'node:test';
import assert from 'node:assert/strict';
import {terrainAt, travelProfile, carriedMassKg, resolveAccessibleTarget} from '../world/terrain.js';
import {createSovereignGenesis} from '../world/genesis.js';

function world(){
  return {
    seed:20260915,
    buildings:[{id:'b1',position:{x:60,y:60},massKg:500}],
    objects:[
      {id:'pack',holderId:'c1',quantity:20,massPerUnitKg:1,kind:'gathered_material'},
      {id:'shelter',kind:'temporary_shelter',quantity:1,position:{x:50,y:50},properties:{thermalProtection:.7,precipitationProtection:.85}},
    ],
  };
}
const citizen={id:'c1',position:{x:40,y:40},body:{massKg:70}};

test('terrain model exposes visible physical classes with different movement costs',()=>{
  const w=world();
  let water=null, meadow=null;
  for(let y=5;y<95&&!water;y+=1)for(let x=5;x<95&&!water;x+=1){const t=terrainAt(w,x,y);if(t.kind==='river')water=t;if(t.kind==='meadow')meadow=t;}
  assert.ok(water,'expected deterministic river terrain');
  assert.ok(meadow,'expected meadow terrain');
  assert.ok(water.movementCost>meadow.movementCost);
  assert.equal(typeof water.moisture,'number');
});

test('carried mass increases travel time',()=>{
  const w=world();
  const target={x:48,y:40};
  const loaded=travelProfile(w,citizen,target);
  const empty=travelProfile({...w,objects:[]},citizen,target);
  assert.ok(carriedMassKg(w,citizen)>0);
  assert.ok(loaded.minimumMinutes>empty.minimumMinutes);
  assert.ok(loaded.loadFactor>1);
});

test('terrain cost affects travel duration over same geometric distance',()=>{
  const w=world();
  let riverPoint=null, grassPoint=null;
  for(let y=20;y<80&&!riverPoint;y+=1)for(let x=20;x<80&&!riverPoint;x+=1){if(terrainAt(w,x,y).kind==='river')riverPoint={x,y};}
  for(let y=20;y<80&&!grassPoint;y+=1)for(let x=20;x<80&&!grassPoint;x+=1){if(terrainAt(w,x,y).kind==='meadow')grassPoint={x,y};}
  assert.ok(riverPoint&&grassPoint);
  const nearRiver={...citizen,position:{x:riverPoint.x-3,y:riverPoint.y}};
  const riverTrip=travelProfile(w,nearRiver,{x:riverPoint.x+3,y:riverPoint.y});
  const grassStart={x:grassPoint.x-3,y:grassPoint.y};
  const grassTrip=travelProfile(w,{...citizen,position:grassStart},{x:grassPoint.x+3,y:grassPoint.y});
  assert.ok(riverTrip.averageTerrainCost>grassTrip.averageTerrainCost);
});

test('movement target is kept outside unrelated structure core',()=>{
  const w=world();
  const resolved=resolveAccessibleTarget(w,citizen,{x:60,y:60},null);
  assert.ok(Math.hypot(resolved.x-60,resolved.y-60)>=1.5);
});

test('backend and Observer terrain models stay classification-compatible',async()=>{
  const {terrainAtPublic}=await import('../site/terrain-model.js');
  const w=world();w.worldId='sovereign-20260915';w.seed=20260915;
  for(const [x,y] of [[10,10],[44,48],[61,54],[36,61],[80,25]])assert.equal(terrainAt(w,x,y).kind,terrainAtPublic(w,x,y).kind);
});

test('route detours around occupied structure core',()=>{
  const w=world(),c={...citizen,position:{x:50,y:60}};
  const profile=travelProfile(w,c,{x:70,y:60});
  assert.ok(profile.path.length>=3,'expected a detour waypoint');
  const wp=profile.path[1];
  assert.ok(Math.hypot(wp.x-60,wp.y-60)>1.5);
});


test('weather and physical capacity influence travel time without changing destination semantics',()=>{
  const clear=createSovereignGenesis({seed:505,realEpochMs:0}),slow=clear.citizens[0];
  slow.position={x:70,y:70};slow.genome.physicalCapacity=.7;clear.environment.precipitation=0;clear.environment.soilMoisture=.4;
  const target={x:78,y:70},slowTrip=travelProfile(clear,slow,target);
  const wet=createSovereignGenesis({seed:505,realEpochMs:0}),fit=wet.citizens[0];
  fit.position={x:70,y:70};fit.genome.physicalCapacity=1.3;wet.environment.precipitation=1;wet.environment.soilMoisture=.9;
  const wetFitTrip=travelProfile(wet,fit,target);
  assert.ok(slowTrip.capabilityFactor>wetFitTrip.capabilityFactor);
  assert.ok(wetFitTrip.weatherFactor>slowTrip.weatherFactor);
  assert.deepEqual(wetFitTrip.targetPosition,target);
});
