import test from 'node:test';
import assert from 'node:assert/strict';
import * as artModule from '../site/medieval-art.js';

const actions = [
  ['REST',0],['MOVE',1],['OBSERVE',2],['EAT',3],
  ['DRINK',4],['GATHER',5],['CARRY',6],['CUT',7],
  ['DIG',8],['HEAT',9],['COOL',9],['MIX',9],['BUILD',10],['ASSEMBLE',10],
  ['CARE',11],['COMMUNICATE',12],['TEACH',12],['PROMISE',12],['CLAIM',12],
  ['EXPERIMENT',13],['ATTACK',14],['DEFEND',15],['TRANSFER',6],['REPRODUCE',0],
];

test('every canonical action selects its illustrated pose without changing citizen identity or state',()=>{
  assert.equal(typeof artModule.citizenSprite,'function');
  for(const kind of ['GENESIS','HUMAN_LINKED']){
    const c={id:'genesis:002',kind};
    const variant=artModule.citizenFrame(c)-12;
    for(const [type,frame] of actions){
      c.currentAction={type};const before=JSON.stringify(c);
      const sprite=artModule.citizenSprite(c);
      assert.equal(sprite.atlas,`citizen:${variant}`,type);
      assert.equal(sprite.frame,frame,type);
      assert.equal(JSON.stringify(c),before);
    }
    c.currentAction={type:'SLEEP'};
    assert.equal(artModule.citizenSprite(c).atlas,'sleep');
    assert.equal(artModule.citizenSprite(c).frame,variant);
    for(const currentAction of [null,{type:'FUTURE_ACTION'}]){
      c.currentAction=currentAction;
      assert.equal(artModule.citizenSprite(c).frame,0);
    }
  }
});

test('unavailable state atlases fall back to a visible standing citizen, including sleep',()=>{
  const art=Object.create(artModule.MedievalArt.prototype);
  art.atlas={width:4};art.frames=Array.from({length:16},()=>({x:0,y:0,w:1,h:2}));
  art.citizenAtlases=[];art.sleepFrames=[];art.sleepAtlas=null;
  assert.equal(typeof art.citizenSprite,'function');
  for(const type of ['SLEEP','BUILD','EAT']){
    const sprite=art.citizenSprite({id:'human',kind:'HUMAN_LINKED',currentAction:{type}},10.5,15);
    assert.equal(sprite.atlas,'base');assert.equal(sprite.frame,15);
    assert.equal(sprite.size,10.5);assert.equal(sprite.sleep,false);
  }
});

test('trimmed action frames preserve scale and use their own alpha mask for selection',()=>{
  const art=Object.create(artModule.MedievalArt.prototype);
  const frames=Array.from({length:16},()=>({x:0,y:0,w:2,h:4}));
  frames[6]={x:2,y:0,w:4,h:4};
  const pixels=new Uint8ClampedArray(6*4*4);
  pixels[(1*6+2)*4+3]=255;
  art.citizenAtlases=Array.from({length:4},()=>({image:{width:6},frames,pixels}));
  assert.equal(typeof art.citizenSprite,'function');
  const c={id:'human',kind:'HUMAN_LINKED',currentAction:{type:'CARRY'}};
  const sprite=art.citizenSprite(c,10,15);
  assert.equal(sprite.size,20,'wider props must not shrink the character');
  const hit=art.hitRecord(sprite,{x:100,y:100},1,false,{anchorY:1});
  assert.equal(art.hitTest(hit,92.5,87.5),true);
  assert.equal(art.hitTest(hit,107.5,87.5),false,'transparent pixels are not selectable');
  const flipped=art.hitRecord(sprite,{x:100,y:100},1,true,{anchorY:1});
  assert.equal(art.hitTest(flipped,107.5,87.5),true);
  assert.equal(art.hitTest(flipped,92.5,87.5),false);
});
