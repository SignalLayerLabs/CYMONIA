// The checkpoint is the observation's time. Wall time cannot complete a
// physical action or move a citizen beyond the latest confirmed position.
export function worldMinute(state,nowMs=Date.now()){
  return Math.max(0,Number(state?.clock?.worldMinute)||0);
}
export function citizenPosition(c,state,nowMs=Date.now()){
  return {...c.position};
}

// A display-only formation makes colocated people individually visible/selectable.
// Canonical positions, paths, and collision/interaction rules stay untouched.
export function citizenDisplayOffsets(state,nowMs=Date.now()){
  const groups=new Map(),offsets=new Map();

  // Display offsets are fixed SCREEN PIXELS. Group by interpolated current
  // position so moving Citizens remain individually visible while travelling.
  const SLOT_SPACING=24;
  const NORM=Math.sqrt(5);
  const axisX={x:2/NORM*SLOT_SPACING,y:1/NORM*SLOT_SPACING};
  const axisY={x:-2/NORM*SLOT_SPACING,y:1/NORM*SLOT_SPACING};

  for(const c of [...(state?.citizens||[])]
    .filter(c=>c.alive)
    .sort((a,b)=>a.id.localeCompare(b.id))){
    const p=citizenPosition(c,state,nowMs);
    const key=`${Math.round(p.x*3)},${Math.round(p.y*3)}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(c);
  }

  for(const group of groups.values()){
    if(group.length===1){
      offsets.set(group[0].id,{x:0,y:0});
      continue;
    }
    const columns=Math.ceil(Math.sqrt(group.length));
    const rows=Math.ceil(group.length/columns);
    for(let i=0;i<group.length;i++){
      const row=Math.floor(i/columns),col=i%columns;
      const rowSize=Math.min(columns,group.length-row*columns);
      const gx=col-(rowSize-1)/2,gy=row-(rows-1)/2;
      offsets.set(group[i].id,{
        x:gx*axisX.x+gy*axisY.x,
        y:gx*axisX.y+gy*axisY.y
      });
    }
  }
  return offsets;
}
