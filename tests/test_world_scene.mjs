import test from 'node:test';
import assert from 'node:assert/strict';
import { project, unproject, sceneEntities, buildingSprite, pickEntity } from '../site/world-scene.js';

const camera = { width: 1000, height: 650, zoom: 1, panX: 0, panY: 0 };
test('world center stays inside the viewport, and inverse mapping survives zoom and pan', () => {
  for (const c of [camera, {...camera,width:390,zoom:2,panX:75,panY:-30}]) {
    const p=project(50,50,c);
    assert.ok(p.x>0 && p.x<c.width && p.y>0 && p.y<c.height);
    const world=unproject(p.x,p.y,c);
    assert.ok(Math.abs(world.x-50)<1e-8 && Math.abs(world.y-50)<1e-8);
  }
});
test('construction at zero percent remains a foundation, with a distinct frame phase', () => {
  assert.equal(buildingSprite({status:'construction',progress:0},'housing'),12);
  assert.equal(buildingSprite({status:'construction',progress:50},'housing'),13);
  assert.equal(buildingSprite({status:'operational',progress:100},'housing'),0);
  assert.equal(buildingSprite({status:'operational'},'information'),14);
});
test('scene uses only existing institutions and sorts Citizens and buildings together by depth', () => {
  const world={citizens:[{id:'a',x:10,y:10}],buildings:[{id:'b',x:5,y:5,status:'construction',progress:0}],companies:[],institutions:{justice:{open_cases:2}}};
  const original=JSON.stringify(world);
  const scene=sceneEntities(world);
  assert.deepEqual(scene.map(e=>e.id),['b','a','institution:justice']);
  assert.equal(scene.at(-1).data.open_cases,2);
  assert.equal(JSON.stringify(world),original);
});
test('picking respects front-to-back order and the building silhouette above its ground point', () => {
  const hits=[{id:'back',x:100,y:100,width:80,height:80},{id:'front',x:100,y:110,width:40,height:40}];
  assert.equal(pickEntity(hits,100,90)?.id,'front');
  assert.equal(pickEntity(hits,100,35)?.id,'back');
  assert.equal(pickEntity(hits,250,250),null);
});
