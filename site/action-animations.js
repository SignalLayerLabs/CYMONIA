// Observer semantics only: this registry never schedules or applies an operation.
const frames=Object.freeze([0,1,2,3]);
const animation=(state,family,frameMs=150)=>Object.freeze({state,family,frames,frameMs});
export const ACTION_ANIMATIONS=Object.freeze({
  MOVE:animation('walk','walk',110),OBSERVE:animation('observe','observe',240),
  REST:animation('rest','rest',280),SLEEP:animation('sleep','sleep',320),
  EAT:animation('eat','consume',210),DRINK:animation('drink','consume',210),
  GATHER:animation('gather','reach',160),CARRY:animation('carry','carry',140),
  CUT:animation('cut','strike',145),DIG:animation('dig','dig',170),
  HEAT:animation('heat','heat',210),COOL:animation('cool','cool',210),MIX:animation('mix','mix',140),
  ASSEMBLE:animation('assemble','join',180),BUILD:animation('build','build',165),
  CARE:animation('care','care',220),TEACH:animation('teach','teach',220),
  COMMUNICATE:animation('communicate','social',240),EXPERIMENT:animation('experiment','manipulate',180),
  ATTACK:animation('attack','strike',120),DEFEND:animation('defend','defend',140),
  TRANSFER:animation('transfer','transfer',170),PROMISE:animation('promise','promise',240),
  CLAIM:animation('claim','claim',220),REPRODUCE:animation('reproduce','affection',280),
  DESTROY:animation('destroy','destroy',125),DISMANTLE:animation('dismantle','separate',200),
  REPAIR:animation('repair','repair',190),PICKUP:animation('pickup','pickup',180),DROP:animation('drop','drop',180),
});
export const PHYSICAL_ANIMATIONS=Object.freeze({
  apply_force:animation('force','push',160),impact:ACTION_ANIMATIONS.DESTROY,
  separate:ACTION_ANIMATIONS.DISMANTLE,join:ACTION_ANIMATIONS.ASSEMBLE,
  support:animation('support','support',200),contain:animation('contain','contain',200),
  move:ACTION_ANIMATIONS.CARRY,rotate:animation('rotate','rotate',160),
  compress:animation('compress','press',160),abrade:animation('abrade','rub',130),
  pierce:animation('pierce','pierce',165),transfer_heat:ACTION_ANIMATIONS.HEAT,
  cool:ACTION_ANIMATIONS.COOL,ignite:ACTION_ANIMATIONS.HEAT,extinguish:ACTION_ANIMATIONS.COOL,
  transfer_matter:ACTION_ANIMATIONS.TRANSFER,shape:animation('shape','shape',170),mix:ACTION_ANIMATIONS.MIX,
});
export const ANIMATED_SPRITE_STATES=Object.freeze(['idle',...new Set([...Object.values(ACTION_ANIMATIONS),...Object.values(PHYSICAL_ANIMATIONS)].map(a=>a.state))]);
const IDLE=animation('idle','idle',300);
export function actionAnimation(action){
  const primitive=action?.physicalOperation?.primitive;
  if(primitive)return PHYSICAL_ANIMATIONS[primitive]||ACTION_ANIMATIONS.OBSERVE;
  return ACTION_ANIMATIONS[action?.type]||(action?ACTION_ANIMATIONS.OBSERVE:IDLE);
}
const finite=n=>Number.isFinite(Number(n))?Number(n):0;
const present=o=>o&&(o.quantity==null||finite(o.quantity)>0)&&(o.massKg==null||finite(o.massKg)>0);
export function canonicalVisualIndex(world){
  const byId=new Map(),heldBy=new Map();
  for(const list of [world?.resourceDeposits,world?.objects,world?.buildings,world?.projects,world?.citizens])for(const entity of list||[])byId.set(entity.id,entity);
  for(const o of world?.objects||[])if(o.holderId&&present(o)){const held=heldBy.get(o.holderId)||[];held.push(o);heldBy.set(o.holderId,held);}
  return {byId,heldBy};
}
export function isHotObject(o){return present(o)&&(Boolean(o.burning)||finite(o.temperatureC??o.temperature??o.properties?.temperatureC)>80);}
export function actionVisualContext(citizen,worldOrIndex){
  const index=worldOrIndex?.byId?worldOrIndex:canonicalVisualIndex(worldOrIndex),a=citizen?.currentAction,op=a?.physicalOperation;
  const target=index.byId.get(op?.targetId||a?.targetId||a?.payload?.recipientId)||null;
  const source=index.byId.get(op?.sourceId)||null,owned=index.heldBy.get(citizen?.id)||[];
  const tool=index.byId.get(op?.toolId||a?.payload?.toolId)||null;
  const held=owned.find(o=>o.id!==tool?.id)||null;
  const heat=[target,source,held].find(isHotObject)||null;
  const positionOf=entity=>(entity?.holderId?index.byId.get(entity.holderId)?.position:null)||entity?.position||entity?.site||null;
  return {animation:actionAnimation(a),type:a?.type||null,primitive:op?.primitive||null,procedureId:a?.procedureId||null,target,source,tool:tool&&present(tool)?tool:null,held,heat,targetPosition:positionOf(target)||a?.targetPosition||null,heatPosition:positionOf(heat)};
}
export function materialColor(entity){
  return ({timber:0x92704b,wood:0x92704b,stone:0x989485,ore:0x778187,clay:0xae7655,water:0x7dbdbd,food:0x76974b,composite:0xa58a64})[entity?.material||entity?.type]||0xa58a64;
}
// Small render commands are shared by Canvas/Pixi. Each citizen owns one reused
// Graphics object in Pixi, including these bounded dust strokes (never entities).
export function actionContextShapes(context,nowMs,targetVector={x:12,y:0},heatVector=null){
  const {animation:a,held,tool,target,heat}=context,w=Math.sin(finite(nowMs)/a.frameMs*Math.PI/2),shapes=[];
  const rect=(x,y,width,height,color,alpha=1)=>shapes.push({kind:'rect',x,y,width,height,color,alpha});
  const line=(x,y,x2,y2,color,width=1,alpha=1)=>shapes.push({kind:'line',x,y,x2,y2,color,width,alpha});
  if(held){const color=materialColor(held),low=['pickup','drop'].includes(a.family),height=low?-4-5*(w+1)/2:-12;
    rect(2,height,7,5,color);line(2,height,9,height,0xd4c29b,.7);
  }
  if(tool){const x=7+w*2,y=-12-w*3;line(3,-9,x,y,0x8d6d45,1.4);rect(x-1,y-2,4,2,materialColor(tool));}
  if(target){
    const tx=finite(targetVector.x),ty=finite(targetVector.y),near=Math.hypot(tx,ty)<70;
    if(near&&['strike','destroy','dig','separate','repair','build','rub','pierce'].includes(a.family)){
      const count=a.family==='destroy'?5:a.family==='separate'?2:3;
      for(let i=0;i<count;i++){const phase=((finite(nowMs)/680+i/count)%1+1)%1;
        const spread=a.family==='destroy'?11:a.family==='separate'?4:7;
        rect(tx+(i-(count-1)/2)*spread*phase,ty-2-Math.sin(phase*Math.PI)*5,1.3,1.3,materialColor(target),(1-phase)*.65);
      }
    }
    // Recipient interaction is expressed by the arm gesture in the sheet, never
    // a speech glyph or an invented structure/recipient.
    if(near&&['teach','claim','care','affection','promise','social','transfer'].includes(a.family))line(5,-12,Math.min(14,Math.max(7,tx*.5)), -13+w*1.5,0xd4bc91,1.2,.8);
  }
  if(heat){
    const p=heatVector||(heat===target?targetVector:{x:8,y:-7}),burning=Boolean(heat.burning);
    for(let i=0;i<3;i++){const phase=((finite(nowMs)/900+i/3)%1+1)%1;
      line(p.x+i*2-2+Math.sin(phase*6)*1.5,p.y-3-phase*9,p.x+i*2-1,p.y-5-phase*9,burning?0xe9ad62:0xd7c9b3,.8,(1-phase)*.45);
    }
    if(burning)rect(p.x-1,p.y-3-Math.abs(w)*2,2,3,0xe58d39,.7);
  }
  return shapes;
}
const css=color=>`#${color.toString(16).padStart(6,'0')}`;
export function drawActionContextCanvas(ctx,shapes){
  ctx.save();for(const s of shapes){ctx.globalAlpha=s.alpha;if(s.kind==='rect'){ctx.fillStyle=css(s.color);ctx.fillRect(s.x,s.y,s.width,s.height);}else{ctx.strokeStyle=css(s.color);ctx.lineWidth=s.width;ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(s.x2,s.y2);ctx.stroke();}}ctx.restore();
}
export function drawActionContextPixi(graphics,shapes){
  graphics.clear();for(const s of shapes)if(s.kind==='rect')graphics.rect(s.x,s.y,s.width,s.height).fill({color:s.color,alpha:s.alpha});else graphics.moveTo(s.x,s.y).lineTo(s.x2,s.y2).stroke({color:s.color,alpha:s.alpha,width:s.width});
}
