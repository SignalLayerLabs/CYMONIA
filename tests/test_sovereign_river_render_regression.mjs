import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createSovereignGenesis} from '../world/index.js';
import {terrainAt,nearestDryLandPoint,isWaterTerrainKind,isSleepUnsafeTerrainKind} from '../world/terrain.js';
import {citizenDisplayOffsets} from '../site/observer-motion.js';

const root=path.resolve(process.cwd());

test('nearest dry land point escapes river and sleep-unsafe terrain',()=>{
  const world=createSovereignGenesis({seed:20260915,realEpochMs:0});
  let riverPoint=null,wetPoint=null;
  for(let y=0;y<100 && (!riverPoint||!wetPoint);y+=.5){
    for(let x=0;x<100 && (!riverPoint||!wetPoint);x+=.5){
      const kind=terrainAt(world,x,y).kind;
      if(!riverPoint&&kind==='river')riverPoint={x,y};
      if(!wetPoint&&kind==='wetland')wetPoint={x,y};
    }
  }
  assert.ok(riverPoint);
  assert.ok(wetPoint);
  const fromRiver=nearestDryLandPoint(world,riverPoint,12,{sleepSafe:false});
  const fromWet=nearestDryLandPoint(world,wetPoint,12,{sleepSafe:true});
  assert.equal(isWaterTerrainKind(terrainAt(world,fromRiver.x,fromRiver.y).kind),false);
  assert.equal(isSleepUnsafeTerrainKind(terrainAt(world,fromWet.x,fromWet.y).kind),false);
});

test('display offsets are suppressed for movers and sleepers',()=>{
  const world=createSovereignGenesis({seed:20260915,realEpochMs:0});
  const [a,b]=world.citizens;
  a.currentAction={type:'MOVE',fromPosition:{x:50,y:50},targetPosition:{x:60,y:60},startedWorldMinute:0,endsWorldMinute:20};
  b.currentAction={type:'SLEEP',startedWorldMinute:0,endsWorldMinute:20};
  const offsets=citizenDisplayOffsets(world,0);
  assert.deepEqual(offsets.get(a.id),{x:0,y:0});
  assert.deepEqual(offsets.get(b.id),{x:0,y:0});
});

test('pixi observer contains water animation hook and reduced sleep lift',()=>{
  const pixi=fs.readFileSync(path.join(root,'site/pixi-observer.js'),'utf8');
  assert.match(pixi,/tilePosition\.x=minute\*0\.45/);
  assert.match(pixi,/const CITIZEN_SLEEP_LIFT=-2;/);
});
