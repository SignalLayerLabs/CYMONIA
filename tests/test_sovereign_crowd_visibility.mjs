import test from 'node:test';
import assert from 'node:assert/strict';
import * as motion from '../site/observer-motion.js';

function crowdedWorld(){
  return {clock:{worldMinute:0,realEpochMs:null},citizens:Array.from({length:100},(_,i)=>({id:`genesis:${String(i+1).padStart(3,'0')}`,alive:true,position:{x:50,y:50}}))};
}

test('100 colocated citizens receive distinct stable visual slots without moving the world',()=>{
  assert.equal(typeof motion.citizenDisplayOffsets,'function');
  const w=crowdedWorld(),before=JSON.stringify(w),offsets=motion.citizenDisplayOffsets(w);
  assert.equal(offsets.size,100);
  assert.equal(new Set([...offsets.values()].map(p=>`${p.x},${p.y}`)).size,100);
  const positions=[...offsets.values()];
  for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++){
    assert.ok(Math.hypot(positions[i].x-positions[j].x,positions[i].y-positions[j].y)>=20);
  }
  assert.equal(JSON.stringify(w),before);
  assert.deepEqual(motion.citizenDisplayOffsets({...w,citizens:[...w.citizens].reverse()}),offsets);
});

test('isolated citizens remain at their physical position and dead citizens take no visual slot',()=>{
  assert.equal(typeof motion.citizenDisplayOffsets,'function');
  const w=crowdedWorld();w.citizens=w.citizens.slice(0,2);w.citizens[1].alive=false;
  assert.deepEqual([...motion.citizenDisplayOffsets(w)], [['genesis:001',{x:0,y:0}]]);
});

test('zooming out after fitting a widely dispersed population never zooms in',async()=>{
  const {SovereignRenderer}=await import('../site/sovereign-renderer.js');
  const r=Object.create(SovereignRenderer.prototype),w=crowdedWorld();
  w.citizens=w.citizens.slice(0,2);w.citizens[0].position={x:10,y:90};w.citizens[1].position={x:90,y:10};
  r.state=w;r.citizenOffsets=new Map();r.camera={width:375,height:667};
  r.fitPopulation();const before=r.camera.targetZoom;
  r.zoomBy(.9);
  assert.ok(r.camera.targetZoom<=before,`${before} -> ${r.camera.targetZoom}`);
});
