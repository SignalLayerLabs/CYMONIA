const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;

export function worldMinute(state,nowMs=Date.now()){
  if(!state?.clock)return 0;
  const rawEpoch=state.clock.realEpochMs;
  const epoch=Number(rawEpoch);
  const canonical=Number(state.clock.worldMinute)||0;
  if(rawEpoch===null||rawEpoch===undefined||!Number.isFinite(epoch))return canonical;
  return Math.max(canonical,Math.min(canonical+60,(Number(nowMs)-epoch)/1000));
}
export function citizenPosition(c,state,nowMs=Date.now()){
  const a=c?.currentAction;
  if(!a||a.type!=='MOVE'||!a.targetPosition||!a.fromPosition)return {...c.position};
  const now=worldMinute(state,nowMs),span=Math.max(.001,Number(a.endsWorldMinute)-Number(a.startedWorldMinute)),t=clamp((now-Number(a.startedWorldMinute))/span,0,1),path=Array.isArray(a.path)&&a.path.length>=2?a.path:[a.fromPosition,a.targetPosition];let total=0;const lengths=[];for(let i=0;i<path.length-1;i++){const d=Math.hypot(path[i+1].x-path[i].x,path[i+1].y-path[i].y);lengths.push(d);total+=d;}if(total<=0)return {...a.targetPosition};let remaining=t*total;for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]||i===lengths.length-1){const u=lengths[i]?clamp(remaining/lengths[i],0,1):1;return{x:lerp(Number(path[i].x),Number(path[i+1].x),u),y:lerp(Number(path[i].y),Number(path[i+1].y),u)};}remaining-=lengths[i];}return {...a.targetPosition};
}

// A display-only formation makes colocated people individually visible/selectable.
// Canonical positions, paths, and collision/interaction rules stay untouched.
export function citizenDisplayOffsets(state){
  const groups=new Map(),offsets=new Map();
  for(const c of [...(state?.citizens||[])].filter(c=>c.alive).sort((a,b)=>a.id.localeCompare(b.id))){
    const p=c.position,key=`${Math.round(p.x*4)},${Math.round(p.y*4)}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(c);
  }
  for(const group of groups.values()){
    const columns=Math.ceil(Math.sqrt(group.length)),rows=Math.ceil(group.length/columns);
    for(let i=0;i<group.length;i++){
      const row=Math.floor(i/columns),rowSize=Math.min(columns,group.length-row*columns);
      offsets.set(group[i].id,{x:(i%columns-(rowSize-1)/2)*24,y:(row-(rows-1)/2)*22});
    }
  }
  return offsets;
}
