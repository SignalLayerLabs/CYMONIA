import {actionAnimation,ANIMATED_SPRITE_STATES} from './action-animations.js';

const ACTION_ANIMATION={
  MOVE:'walk',OBSERVE:'observe',REST:'idle',SLEEP:'sleep',EAT:'eat',DRINK:'drink',
  GATHER:'gather',CARRY:'carry',CUT:'cut',DIG:'dig',HEAT:'work',COOL:'work',MIX:'work',
  ASSEMBLE:'build',BUILD:'build',CARE:'care',TEACH:'communicate',COMMUNICATE:'communicate',
  EXPERIMENT:'experiment',ATTACK:'attack',DEFEND:'defend',TRANSFER:'carry',
  PROMISE:'communicate',CLAIM:'communicate',REPRODUCE:'idle',DESTROY:'attack',
  DISMANTLE:'build',REPAIR:'build',PICKUP:'gather',DROP:'gather',
};
// Row-major order of every 4x4 Citizen action atlas. Sleep has its own atlas.
export const CITIZEN_SPRITE_STATES=Object.freeze([
  'idle','walk','observe','eat','drink','gather','carry','cut',
  'dig','work','build','care','communicate','experiment','attack','defend',
]);
function hashUnit(value){
  let h=2166136261>>>0;
  for(const ch of String(value||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return(h>>>0)/4294967295;
}
export function animationForCitizen(citizen){
  return ACTION_ANIMATION[citizen?.currentAction?.type]||'idle';
}
const stateIndices=new Map(ANIMATED_SPRITE_STATES.map((state,i)=>[state,i]));
export function citizenAnimationFrame(citizen,nowMs=0){
  const visual=actionAnimation(citizen?.currentAction);
  const time=Number.isFinite(Number(nowMs))?Number(nowMs):0;
  // Observer time and stable identity phase only. No wall-clock randomness or
  // writes to the current action, procedure or canonical world.
  const step=Math.floor(time/visual.frameMs)+Math.floor(hashUnit(citizen?.id)*4);
  const phase=((step%4)+4)%4;
  return {animation:visual.state,frame:stateIndices.get(visual.state)*4+visual.frames[phase],phase,frameMs:visual.frameMs};
}
export function citizenVisualPose(citizen,nowMs=Date.now()){
  const action=animationForCitizen(citizen);
  const phase=Number(nowMs)/180+hashUnit(citizen?.id)*Math.PI*2;
  const wave=Math.sin(phase),pulse=Math.sin(phase*.5);
  let y=0,rotation=0,scaleX=1,scaleY=1,shadowScale=1;
  if(action==='walk'){
    y=-Math.abs(wave)*1.6;rotation=wave*.035;scaleX=1+Math.abs(wave)*.025;
    scaleY=1-Math.abs(wave)*.03;shadowScale=1-Math.abs(wave)*.08;
  }else if(['gather','cut','dig','build','work'].includes(action)){
    y=Math.abs(wave)*.55;rotation=wave*.065;scaleY=1-Math.abs(wave)*.025;shadowScale=1.03;
  }else if(action==='carry'){
    y=-Math.abs(wave)*.7;rotation=wave*.018;scaleY=.98;
  }else if(action==='sleep'){
    y=2.2;rotation=-.11;scaleX=1.05;scaleY=.86;shadowScale=1.18;
  }else if(['communicate','care','observe','experiment'].includes(action)){
    y=pulse*.25;rotation=wave*.025;scaleY=1+pulse*.015;
  }else if(['attack','defend'].includes(action)){
    y=-Math.abs(wave)*.7;rotation=wave*.09;scaleX=1+Math.abs(wave)*.04;scaleY=.97;
  }else{
    y=pulse*.18;scaleX=1-pulse*.006;scaleY=1+pulse*.012;
  }
  return {animation:action,y,rotation,scaleX,scaleY,shadowScale};
}
