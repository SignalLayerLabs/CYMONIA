import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {animationForCitizen,citizenVisualPose} from '../site/citizen-animation.js';

test('canonical actions map to Observer animation states only',()=>{
  assert.equal(animationForCitizen({currentAction:{type:'MOVE'}}),'walk');
  assert.equal(animationForCitizen({currentAction:{type:'BUILD'}}),'build');
  assert.equal(animationForCitizen({currentAction:{type:'SLEEP'}}),'sleep');
  assert.equal(animationForCitizen({currentAction:null}),'idle');
  const c={id:'c:1',currentAction:{type:'MOVE'}},before=JSON.stringify(c),pose=citizenVisualPose(c,1000);
  assert.equal(pose.animation,'walk');
  for(const key of ['y','rotation','scaleX','scaleY','shadowScale'])assert.ok(Number.isFinite(pose[key]),key);
  assert.equal(JSON.stringify(c),before);
});

test('Spine support is optional and does not vendor proprietary runtime into the MIT shell',()=>{
  const adapter=fs.readFileSync(new URL('../site/spine-citizen-adapter.js',import.meta.url),'utf8');
  const pixi=fs.readFileSync(new URL('../site/pixi-observer.js',import.meta.url),'utf8');
  const html=fs.readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
  const docs=fs.readFileSync(new URL('../docs/observer/spine.md',import.meta.url),'utf8');
  assert.match(adapter,/CYMONIA_SPINE/);assert.match(adapter,/animationForCitizen/);
  assert.match(pixi,/SpineCitizenAdapter/);assert.match(pixi,/citizenVisualPose/);
  assert.doesNotMatch(html,/@esotericsoftware|spine-pixi-v8/i);assert.match(docs,/Spine Runtimes License/);assert.match(docs,/fallback/i);
});
