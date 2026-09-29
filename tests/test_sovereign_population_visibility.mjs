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

test('display formation scales with the world instead of accordioning in screen space',()=>{
  const renderer=fs.readFileSync(path.join(root,'site/sovereign-renderer.js'),'utf8');
  const pixi=fs.readFileSync(path.join(root,'site/pixi-observer.js'),'utf8');
  assert.match(renderer,/return \{x:p\.x\+offset\.x,y:p\.y\+offset\.y\}/);
  assert.doesNotMatch(renderer,/\*z\+offset\.x/);
  assert.match(pixi,/p\.x\+=offset\.x;p\.y\+=offset\.y/);
  assert.match(pixi,/sp\.x\+=offset\.x\*camera\.zoom/);
  assert.match(pixi,/sp\.y\+=offset\.y\*camera\.zoom/);
});

test('same-world auto framing only zooms outward for dispersed population',()=>{
  const renderer=fs.readFileSync(path.join(root,'site/sovereign-renderer.js'),'utf8');
  assert.match(renderer,/visibility\.visible\/visibility\.total<\.92/);
  assert.match(renderer,/fitPopulation\(\{onlyOut:true\}\)/);
  assert.match(renderer,/onlyOut\?Math\.min\(this\.camera\.targetZoom,fittedZoom\):fittedZoom/);
  assert.match(renderer,/autoFramePopulation=false/);
});
