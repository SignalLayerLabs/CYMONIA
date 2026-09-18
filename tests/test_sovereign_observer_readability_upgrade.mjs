import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {observerConceptView} from '../site/observer-concepts.js';

test('Observer translates opaque resource concepts without mutating canonical knowledge',()=>{
  const world={resourceDeposits:[{id:'dep:water',type:'water'}],buildings:[],projects:[],objects:[]};
  const citizen={language:{lexicon:{'k:water':'mira'}}};
  const entry={concept:'k:water',confidence:.91,provenance:[{kind:'observation',entityId:'dep:water',evidence:{appearance:'moving reflective fluid'}}]};
  const before=JSON.stringify({world,citizen,entry}),view=observerConceptView(world,citizen,entry);
  assert.equal(view.label,'Water source');assert.equal(view.canonicalId,'k:water');assert.equal(view.token,'mira');
  assert.match(view.tooltip,/Canonical concept: k:water/);assert.equal(JSON.stringify({world,citizen,entry}),before);
});

test('Observer gives readable structure and sensory fallbacks without guessing canonical state',()=>{
  const world={resourceDeposits:[],buildings:[{id:'hut:1'}],projects:[],objects:[]};
  assert.equal(observerConceptView(world,{language:{lexicon:{}}},{concept:'kstruct:1',provenance:[{kind:'observation',entityId:'hut:1'}]}).label,'Constructed structure');
  assert.equal(observerConceptView(world,{language:{lexicon:{}}},{concept:'k:unknown',provenance:[{kind:'observation',evidence:{appearance:'fibrous rigid material'}}]}).label,'Observed: fibrous rigid material');
});

test('Observer exposes population framing and readable concept UI',()=>{
  const renderer=fs.readFileSync(new URL('../site/sovereign-renderer.js',import.meta.url),'utf8');
  const world=fs.readFileSync(new URL('../site/sovereign-world.js',import.meta.url),'utf8');
  const html=fs.readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
  assert.match(renderer,/fitPopulation\(\)/);assert.match(renderer,/populationVisibility\(\)/);
  assert.match(world,/observerConceptView/);assert.match(world,/fitPopulation/);
  assert.match(html,/id="fitPopulation"/);assert.match(html,/id="populationLabel"/);
});
