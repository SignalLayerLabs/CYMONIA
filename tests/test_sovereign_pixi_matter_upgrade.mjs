import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);

test('Observer loads pinned PixiJS and Matter.js before the sovereign module',()=>{
  const html=fs.readFileSync(path.join(root,'site/index.html'),'utf8');
  assert.match(html,/pixi\.js@8\.19\.0\/dist\/pixi\.min\.js/);
  assert.match(html,/matter-js@0\.20\.0\/build\/matter\.min\.js/);
  assert.ok(html.indexOf('pixi.js@8.19.0')<html.indexOf('sovereign-world.js'));
  assert.ok(html.indexOf('matter-js@0.20.0')<html.indexOf('sovereign-world.js'));
});

test('Pixi observer keeps explicit render layers and a Canvas fallback',()=>{
  const source=fs.readFileSync(path.join(root,'site/pixi-observer.js'),'utf8');
  for(const layer of ['terrainLayer','waterLayer','vegetationLayer','resourceLayer','structureLayer','citizenLayer','effectsLayer','atmosphereLayer'])assert.match(source,new RegExp(layer));
  assert.match(source,/PIXI\.Application/);
  assert.match(source,/preference:\s*['"]webgl['"]/);
  const renderer=fs.readFileSync(path.join(root,'site/sovereign-renderer.js'),'utf8');
  assert.match(renderer,/PixiObserverLayer/);
  assert.match(renderer,/gpuCanvas/);
  assert.match(renderer,/canvasFallback/);
});

test('Matter transient physics is observer-only and consumes canonical fracture events',()=>{
  const source=fs.readFileSync(path.join(root,'site/transient-physics.js'),'utf8');
  assert.match(source,/STRUCTURE_FRACTURED/);
  assert.match(source,/Matter\.Engine/);
  assert.match(source,/observerOnly\s*=\s*true/);
  assert.doesNotMatch(source,/fetch\s*\(/);
  assert.doesNotMatch(source,/\/api\/v2\/(intent|avatar)/);
});
