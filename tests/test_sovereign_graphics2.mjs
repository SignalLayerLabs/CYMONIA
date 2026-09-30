import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ACTION_TYPES} from '../world/constants.js';
import {PHYSICAL_PRIMITIVES} from '../world/physical-operations.js';
import {citizenSprite,sceneEntries,staticSceneKey} from '../site/medieval-art.js';
const visuals=await import('../site/action-animations.js').catch(()=>({}));
const animation=await import('../site/citizen-animation.js');
const primitives=PHYSICAL_PRIMITIVES;

test('every canonical action has an explicit multi-frame Graphics 2.0 animation',()=>{
  assert.ok(visuals.ACTION_ANIMATIONS,'action animation registry exists');
  assert.deepEqual(Object.keys(visuals.ACTION_ANIMATIONS).sort(),[...ACTION_TYPES].sort(),'a new canonical action must add its visual mapping');
  for(const type of ACTION_TYPES){
    const visual=visuals.ACTION_ANIMATIONS[type];
    assert.ok(visual.state,type);assert.ok(visual.frames.length>=4,type);assert.ok(visual.frameMs>0,type);
    assert.equal(visuals.actionAnimation({type}),visual,type);
  }
  assert.notEqual(visuals.ACTION_ANIMATIONS.CUT.state,visuals.ACTION_ANIMATIONS.DESTROY.state);
  assert.notEqual(visuals.ACTION_ANIMATIONS.COMMUNICATE.state,visuals.ACTION_ANIMATIONS.TEACH.state);
});

test('all physical primitives resolve to motion and unknown future operations stay visible',()=>{
  assert.ok(visuals.PHYSICAL_ANIMATIONS);
  assert.deepEqual(Object.keys(visuals.PHYSICAL_ANIMATIONS).sort(),[...PHYSICAL_PRIMITIVES].sort(),'a new physical primitive must add its visual mapping');
  for(const primitive of primitives){
    assert.ok(visuals.PHYSICAL_ANIMATIONS[primitive],primitive);
    const selected=visuals.actionAnimation({type:'EXPERIMENT',physicalOperation:{primitive}});
    assert.equal(selected,visuals.PHYSICAL_ANIMATIONS[primitive]);assert.ok(selected.frames.length>=4);
  }
  const fallback=visuals.actionAnimation({type:'FUTURE',physicalOperation:{primitive:'new_primitive'}});
  assert.equal(fallback.state,'observe');
});

test('observer time advances actual atlas frames deterministically without canonical mutation',()=>{
  assert.equal(typeof animation.citizenAnimationFrame,'function');
  for(const type of ACTION_TYPES){
    const c=Object.freeze({id:'citizen:1',kind:'GENESIS',currentAction:Object.freeze({type})}),before=JSON.stringify(c);
    const frames=new Set(Array.from({length:12},(_,i)=>animation.citizenAnimationFrame(c,i*110).frame));
    assert.ok(frames.size>=3,`${type} animates`);
    assert.deepEqual(animation.citizenAnimationFrame(c,100),animation.citizenAnimationFrame(c,100));
    assert.equal(JSON.stringify(c),before);
    assert.equal(citizenSprite(c).atlas==='sleep',type==='SLEEP','legacy static API stays intact');
  }
});

test('context uses canonical holders, targets, tools and heat rather than fabricating them',()=>{
  assert.equal(typeof visuals.actionVisualContext,'function');
  const c={id:'c',position:{x:5,y:5},currentAction:{type:'HEAT',targetId:'cold',physicalOperation:{primitive:'transfer_heat',targetId:'cold',sourceId:'hot',toolId:'tool'}}};
  const w={citizens:[c],objects:[{id:'held',holderId:'c',material:'stone',quantity:1},{id:'cold',temperatureC:20,material:'ore',position:{x:5,y:5},quantity:1},{id:'hot',temperatureC:400,quantity:1},{id:'tool',holderId:'c',kind:'tool',material:'timber',quantity:1}]};
  const before=JSON.stringify(w),context=visuals.actionVisualContext(c,w);
  assert.equal(context.target.id,'cold');assert.equal(context.tool.id,'tool');assert.equal(context.held.id,'held');
  assert.equal(context.heat.id,'hot');assert.equal(JSON.stringify(w),before);
  delete c.currentAction.physicalOperation;
  assert.equal(visuals.actionVisualContext(c,w).heat,null,'HEAT alone cannot create flames or embers');
  c.currentAction={type:'PICKUP',targetId:'cold'};
  w.objects[0].holderId=null;
  assert.equal(visuals.actionVisualContext(c,w).held?.id,'tool','pickup does not visually transfer ownership early');
  w.objects[3].holderId=null;
  assert.equal(visuals.actionVisualContext(c,w).held,null);
});

test('ground artifacts and canonical debris are visible, carried items are excluded, condition invalidates cache',()=>{
  const w={objects:[{id:'ore',kind:'resource',material:'ore',quantity:2,condition:1,position:{x:4,y:4}},{id:'fragment',kind:'debris',material:'timber',quantity:1,condition:.3,position:{x:5,y:4}},{id:'held',holderId:'c',material:'stone',quantity:1,position:{x:5,y:5}}]};
  const before=JSON.stringify(w),entries=sceneEntries(w,{decorations:false}),key=staticSceneKey(w);
  assert.ok(entries.some(e=>e.id==='ore'&&e.kind==='object'));
  assert.ok(entries.some(e=>e.id==='fragment'&&e.kind==='debris'));
  assert.equal(entries.some(e=>e.id==='held'),false);assert.equal(JSON.stringify(w),before);
  w.objects[0].condition=.4;assert.notEqual(staticSceneKey(w),key);
  w.objects[0].holderId='c';assert.equal(sceneEntries(w,{decorations:false}).some(e=>e.id==='ore'),false);
});

test('world renderers use physical animation context and never draw action glyphs',()=>{
  for(const file of ['pixi-observer.js','sovereign-renderer.js']){
    const code=fs.readFileSync(new URL(`../site/${file}`,import.meta.url),'utf8');
    assert.doesNotMatch(code,/ACTION_ICON/);assert.match(code,/actionVisualContext/);assert.match(code,/animatedCitizenSprite/);
  }
});

// Read the PNG independently of the atlas builder/browser. Pillow emits ordinary
// RGBA PNGs; standard PNG row filters are enough to inspect actual rendered pixels.
function rgbaPng(file){
  const bytes=fs.readFileSync(file),parts=[];let width,height;
  for(let at=8;at<bytes.length;){const size=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,at+8+size);if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);assert.equal(data[9],6);}if(type==='IDAT')parts.push(data);at+=size+12;}
  const packed=inflateSync(Buffer.concat(parts)),stride=width*4,pixels=Buffer.alloc(stride*height);
  for(let y=0;y<height;y++){
    const filter=packed[y*(stride+1)];
    for(let x=0;x<stride;x++){const left=x>=4?pixels[y*stride+x-4]:0,up=y?pixels[(y-1)*stride+x]:0,corner=y&&x>=4?pixels[(y-1)*stride+x-4]:0;let predictor=0;
      if(filter===1)predictor=left;else if(filter===2)predictor=up;else if(filter===3)predictor=Math.floor((left+up)/2);else if(filter===4){const p=left+up-corner,a=Math.abs(p-left),b=Math.abs(p-up),c=Math.abs(p-corner);predictor=a<=b&&a<=c?left:b<=c?up:corner;}
      pixels[y*stride+x]=(packed[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  return {width,height,pixels};
}
import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {ANIMATION_ATLAS} from '../site/citizen-animation-atlas.js';

test('bundled animation cells contain four distinct articulated images for every state and identity',()=>{
  assert.deepEqual(ANIMATION_ATLAS.states,visuals.ANIMATED_SPRITE_STATES);
  for(const [variant,name] of ['blue','rust','green','linked'].entries()){
    const image=rgbaPng(new URL(`../site/assets/citizen-${name}-animated.png`,import.meta.url));
    assert.equal(image.width,ANIMATION_ATLAS.variants[variant].width);assert.equal(image.height,ANIMATION_ATLAS.variants[variant].height);
    for(const [stateIndex,state] of ANIMATION_ATLAS.states.entries()){
      const hashes=new Set();
      for(let phase=0;phase<4;phase++){
        const frame=stateIndex*4+phase,ox=(frame%16)*96,oy=Math.floor(frame/16)*112,hash=createHash('sha256');let opaque=0;
        for(let y=0;y<112;y++){
          const row=image.pixels.subarray(((oy+y)*image.width+ox)*4,((oy+y)*image.width+ox+96)*4);hash.update(row);
          for(let x=0;x<96;x++){const alpha=row[x*4+3];opaque+=alpha>24?1:0;if(x<2||x>93||y<2||y>109)assert.equal(alpha,0,`${name} ${state} has clipped pixels`);}
        }
        assert.ok(opaque>100,`${name} ${state} frame ${phase} contains a person`);hashes.add(hash.digest('hex'));
      }
      assert.equal(hashes.size,4,`${name} ${state} must change actual image pixels in all four frames`);
    }
  }
});

import {SovereignRenderer} from '../site/sovereign-renderer.js';
test('unowned scenery never acquires the avatar ownership ring in Canvas fallback',()=>{
  const r=Object.create(SovereignRenderer.prototype);r.state={seed:1,citizens:[],objects:[],projects:[],buildings:[],resourceDeposits:[]};r.camera={zoom:1};r.selected=null;r.follow=null;r.ownedCitizen=null;r.artKey='';r.project=()=>({x:50,y:50});
  r.art={atlasFor:()=>({frames:Array.from({length:16},()=>({w:2,h:3}))}),drawEntry:()=>true};
  let ownerRings=0;
  // This narrow Canvas adapter records the ownership drawing side effect; art,
  // terrain and the renderer itself execute their normal production paths.
  const ctx={strokeStyle:'',beginPath(){},ellipse(){if(this.strokeStyle==='#8fd7ff')ownerRings++;},stroke(){},save(){},restore(){},translate(){},rotate(){},scale(){},fillRect(){}};
  r.drawWorldObjects(ctx,{width:100,height:100},{},0,1000);
  assert.ok(r.artEntries.some(e=>e.id===null),'fixture has ordinary unowned scenery');
  assert.equal(ownerRings,0);
});

test('held physical targets follow their holder and heat follows its canonical source position',()=>{
  const c={id:'actor',position:{x:4,y:8},currentAction:{type:'HEAT',physicalOperation:{primitive:'transfer_heat',targetId:'held',sourceId:'source'}}};
  const world={citizens:[c],objects:[{id:'held',holderId:'actor',position:{x:80,y:80},material:'ore',quantity:1},{id:'source',position:{x:5,y:8},temperatureC:400,quantity:1}]};
  const before=JSON.stringify(world),context=visuals.actionVisualContext(c,world);
  assert.deepEqual(context.targetPosition,c.position,'stale stored object position is not its rendered held location');
  assert.deepEqual(context.heatPosition,{x:5,y:8});
  const strokes=visuals.actionContextShapes(context,0,{x:0,y:0},{x:-20,y:4}).filter(s=>s.kind==='line'&&s.color===0xd7c9b3);
  assert.equal(strokes.length,3);assert.ok(strokes.every(s=>s.x<-10),'shimmer stays at the projected source, not an invented handheld flame');
  assert.equal(JSON.stringify(world),before);
});
