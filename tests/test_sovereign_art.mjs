import test from 'node:test';
import assert from 'node:assert/strict';
import {isoPoint,isoInverse,sceneEntries,staticSceneKey,spriteBounds} from '../site/medieval-art.js';

test('isometric projection round trips camera coordinates',()=>{
  for(const [x,y] of [[0,0],[50,50],[13.7,86.2],[100,100]]){
    const p=isoPoint(x,y),q=isoInverse(p.x,p.y);
    assert.ok(Math.abs(q.x-x)<1e-9 && Math.abs(q.y-y)<1e-9);
  }
});
test('art follows canonical depletion, construction progress and collapse without mutating state',()=>{
  const w={worldId:'test',resourceDeposits:[{id:'wood',type:'timber',quantity:1,position:{x:60,y:40}}],objects:[],projects:[{id:'p',status:'construction',site:{x:55,y:50},workDoneMinutes:5,workRequiredMinutes:10}],buildings:[{id:'b',position:{x:53,y:55},massKg:100,condition:1}]};
  const before=JSON.stringify(w),a=sceneEntries(w,{decorations:false}),key=staticSceneKey(w);
  assert.ok(a.some(e=>e.id==='b'&&e.kind==='building'));
  assert.ok(a.some(e=>e.id==='p'&&e.progress===.5));
  assert.equal(JSON.stringify(w),before);
  w.resourceDeposits[0].quantity=0;w.buildings[0].condition=0;w.projects[0].workDoneMinutes=8;
  assert.notEqual(staticSceneKey(w),key);
  const b=sceneEntries(w,{decorations:false});
  assert.equal(b.some(e=>e.id==='wood'||e.id==='b'),false);
  assert.equal(b.find(e=>e.id==='p').progress,.8);
});
test('empty Genesis never acquires decorative buildings',()=>{
  assert.equal(sceneEntries({worldId:'genesis',seed:1},{decorations:false}).length,0);
});

test('tall sprites retain their complete visible and selectable bounds at maximum zoom',()=>{
  const b=spriteBounds({w:100,h:180},100*3.1,500,900);
  assert.equal(b.width,310);assert.equal(b.height,558);
  assert.ok(b.y<400,'tree crown remains visible even when its ground anchor is below the viewport');
  assert.ok(b.y+b.height>900,'bounds include ground shadow');
});
