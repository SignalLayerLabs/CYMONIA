import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createSovereignGenesis} from '../world/index.js';
import {citizenDisplayOffsets} from '../site/observer-motion.js';

const root=path.resolve(process.cwd());

test('moving colocated citizens receive distinct display offsets',()=>{
  const world=createSovereignGenesis({seed:20260915,realEpochMs:0});
  const [a,b]=world.citizens;
  a.position={x:50,y:50};b.position={x:50,y:50};
  a.currentAction={type:'MOVE',fromPosition:{x:50,y:50},targetPosition:{x:70,y:50},startedWorldMinute:0,endsWorldMinute:100};
  b.currentAction={type:'MOVE',fromPosition:{x:50,y:50},targetPosition:{x:70,y:50},startedWorldMinute:0,endsWorldMinute:100};
  world.clock.worldMinute=50;
  const offsets=citizenDisplayOffsets(world,50000);
  assert.notDeepEqual(offsets.get(a.id),offsets.get(b.id));
});

test('display offsets are fixed screen pixels, not multiplied by zoom',()=>{
  const renderer=fs.readFileSync(path.join(root,'site/sovereign-renderer.js'),'utf8');
  const pixi=fs.readFileSync(path.join(root,'site/pixi-observer.js'),'utf8');
  assert.match(renderer,/\+offset\.x/);
  assert.match(renderer,/\+offset\.y/);
  assert.match(pixi,/offset\.x\/Math\.max\(\.001,camera\.zoom\)/);
  assert.match(pixi,/sp\.x\+=offset\.x/);
  assert.match(pixi,/sp\.y\+=offset\.y/);
});

test('same-world updates can automatically reframe dispersed population',()=>{
  const renderer=fs.readFileSync(path.join(root,'site/sovereign-renderer.js'),'utf8');
  assert.match(renderer,/visibility\.visible\/visibility\.total<\.96/);
  assert.match(renderer,/autoFramePopulation=true/);
  assert.match(renderer,/autoFramePopulation=false/);
});
