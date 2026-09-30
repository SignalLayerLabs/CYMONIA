const TAU=Math.PI*2;
const TRAFFIC_CELL=2;
const TRAFFIC_HALF_LIFE=20160;
const HARVEST_HALF_LIFE=10080;
const MAX_TRAFFIC_CELLS=900;
const MAX_SPATIAL_MEMORY=64;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));

function decay(value,last,at,halfLife){
  const elapsed=Math.max(0,Number(at||0)-Number(last||0));
  return Math.max(0,Number(value)||0)*Math.pow(.5,elapsed/Math.max(1,halfLife));
}
function cellKey(position){
  const x=Math.max(0,Math.min(49,Math.floor(Number(position?.x||0)/TRAFFIC_CELL)));
  const y=Math.max(0,Math.min(49,Math.floor(Number(position?.y||0)/TRAFFIC_CELL)));
  return `${x}:${y}`;
}
function cellCenter(key){
  const [x,y]=String(key).split(':').map(Number);
  return {x:(x+.5)*TRAFFIC_CELL,y:(y+.5)*TRAFFIC_CELL};
}
export function ensureLivingWorld(world){
  world.livingWorld??={version:1};
  const state=world.livingWorld;
  state.version=1;
  state.traffic??={cells:{},lastPruneWorldMinute:0};
  state.traffic.cells??={};
  state.structureUse??={};
  state.resourcePressure??={};
  return state;
}
function pruneRecord(record,limit,score){
  const entries=Object.entries(record);
  if(entries.length<=limit)return;
  entries.sort((a,b)=>score(b[1])-score(a[1]));
  for(const [key] of entries.slice(limit))delete record[key];
}
export function recordSpatialObservation(citizen,entityId,position,at=0,kind='entity'){
  if(!citizen||!entityId||!position)return null;
  citizen.spatialMemory??={entities:{}};
  citizen.spatialMemory.entities??={};
  citizen.spatialMemory.entities[String(entityId)]={
    position:{x:Number(position.x),y:Number(position.y)},
    worldMinute:Number(at)||0,
    kind:String(kind||'entity').slice(0,32)
  };
  pruneRecord(citizen.spatialMemory.entities,MAX_SPATIAL_MEMORY,x=>Number(x.worldMinute)||0);
  return citizen.spatialMemory.entities[String(entityId)];
}
export function rememberedCrowding(citizen,position,at=0,radius=10){
  const entries=Object.values(citizen?.spatialMemory?.entities||{});
  return entries.filter(entry=>
    entry.kind==='citizen' &&
    Number(at)-Number(entry.worldMinute||0)<=1440 &&
    Math.hypot(Number(entry.position?.x)-Number(position?.x),Number(entry.position?.y)-Number(position?.y))<=radius
  ).length;
}
export function recordTravel(world,citizen,action,at=world.clock?.worldMinute??0){
  if(!action||action.type!=='MOVE')return;
  const state=ensureLivingWorld(world),cells=state.traffic.cells;
  const path=Array.isArray(action.path)&&action.path.length>=2?action.path:[action.fromPosition,action.targetPosition].filter(Boolean);
  if(path.length<2)return;
  const loadFactor=Math.max(1,Number(action.physics?.loadFactor)||1);
  for(let i=0;i<path.length-1;i++){
    const a=path[i],b=path[i+1],distance=Math.hypot(b.x-a.x,b.y-a.y);
    const steps=Math.max(1,Math.ceil(distance/.9));
    for(let step=0;step<=steps;step++){
      const t=step/steps,position={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},key=cellKey(position);
      const current=cells[key]||{traffic:0,lastWorldMinute:at};
      current.traffic=Math.min(500,decay(current.traffic,current.lastWorldMinute,at,TRAFFIC_HALF_LIFE)+.65*loadFactor);
      current.lastWorldMinute=Number(at)||0;
      cells[key]=current;
    }
  }
  if(Object.keys(cells).length>MAX_TRAFFIC_CELLS){
    pruneRecord(cells,MAX_TRAFFIC_CELLS,x=>decay(x.traffic,x.lastWorldMinute,at,TRAFFIC_HALF_LIFE));
  }
}
export function trailStrengthAt(world,x,y,at=world.clock?.worldMinute??0){
  const state=ensureLivingWorld(world),entry=state.traffic.cells[cellKey({x,y})];
  if(!entry)return 0;
  const traffic=decay(entry.traffic,entry.lastWorldMinute,at,TRAFFIC_HALF_LIFE);
  return clamp(1-Math.exp(-traffic/10),0,1);
}
export function trailMultiplierAt(world,x,y,at=world.clock?.worldMinute??0){
  return 1-.28*trailStrengthAt(world,x,y,at);
}
export function recordHarvest(world,deposit,quantity,at=world.clock?.worldMinute??0){
  if(!deposit)return;
  const state=ensureLivingWorld(world),key=String(deposit.id),current=state.resourcePressure[key]||{pressure:0,lastWorldMinute:at};
  const prior=decay(current.pressure,current.lastWorldMinute,at,HARVEST_HALF_LIFE);
  current.pressure=Math.min(10000,prior+Math.max(0,Number(quantity)||0));
  current.lastWorldMinute=Number(at)||0;
  state.resourcePressure[key]=current;
}
export function resourceRenewalFactor(world,deposit,at=world.clock?.worldMinute??0){
  const state=ensureLivingWorld(world),entry=state.resourcePressure[String(deposit?.id)]||null;
  const pressure=entry?decay(entry.pressure,entry.lastWorldMinute,at,HARVEST_HALF_LIFE):0;

  // Preserve the sovereign baseline exactly until this deposit has actually
  // been exploited. This keeps Genesis/resource invariants stable while
  // allowing ecology to react causally after local extraction occurs.
  if(pressure<=0)return 1;

  const season=Number(world.environment?.seasonPhase||0),moisture=clamp(world.environment?.soilMoisture,.1,1);
  let seasonal=1;
  if(deposit?.type==='food')seasonal=.3+.7*Math.max(0,Math.sin((season-.05)*TAU));
  else if(deposit?.type==='timber')seasonal=.72+.28*moisture;
  else if(deposit?.type==='water')seasonal=.8+.35*clamp(world.environment?.precipitation,0,1);
  const pressurePenalty=1/(1+pressure/18);
  return clamp(seasonal*pressurePenalty,.08,1.35);
}
export function riverHydrology(world,y=50){
  const rain=clamp(world?.environment?.precipitation,0,1),soil=clamp(world?.environment?.soilMoisture,.1,1);
  const pulse=.5+.5*Math.sin((Number(world?.clock?.worldMinute)||0)/480+Number(y||0)*.035);
  const halfWidth=clamp(.92+rain*.62+(soil-.5)*.34,.82,1.72);
  const wetlandWidth=halfWidth+1.15+soil*.42;
  const flow=clamp(.58+rain*1.75+soil*.38+pulse*.12,.45,2.8);
  const depth=clamp(.48+rain*1.08+soil*.34,.42,1.95);
  return {halfWidth,wetlandWidth,flow,depth};
}
export function localVisibilityRadius(world,base=12){
  const phase=Number(world?.environment?.dayPhase||0);
  const sun=Math.sin((phase-.25)*TAU);
  const daylight=clamp((sun+.22)/1.22,0,1);
  const rain=clamp(world?.environment?.precipitation,0,1);
  return Math.max(4,Number(base||12)*(.46+.54*daylight)*(1-rain*.22));
}
export function nightPressure(world){
  const phase=Number(world?.environment?.dayPhase||0),sun=Math.sin((phase-.25)*TAU);
  return clamp((-sun+.05)/1.05,0,1);
}
export function recordStructureUse(world,citizen,position,deltaMinutes,at=world.clock?.worldMinute??0){
  if(!citizen?.alive||!position)return null;
  const structures=[
    ...(world.buildings||[]).filter(b=>b.position&&Number(b.condition??1)>0),
    ...(world.objects||[]).filter(o=>o.kind==='temporary_shelter'&&o.quantity>0&&o.position)
  ];
  let nearest=null,distance=Infinity;
  for(const structure of structures){
    const d=Math.hypot(position.x-structure.position.x,position.y-structure.position.y);
    if(d<distance){distance=d;nearest=structure;}
  }
  if(!nearest||distance>2.25)return null;
  const state=ensureLivingWorld(world),use=state.structureUse[nearest.id]||{
    minutes:0,sleepMinutes:0,visits:0,firstUseWorldMinute:at,lastUseWorldMinute:at,byCitizen:{}
  };
  const delta=Math.max(0,Number(deltaMinutes)||0),action=world.actions?.find(a=>a.id===citizen.currentActionId&&a.status==='active');
  use.minutes=Math.min(1e9,Number(use.minutes||0)+delta);
  if(['SLEEP','REST'].includes(action?.type))use.sleepMinutes=Math.min(1e9,Number(use.sleepMinutes||0)+delta);
  if(Number(at)-Number(use.lastUseWorldMinute||0)>60)use.visits=Math.min(1e7,Number(use.visits||0)+1);
  use.lastUseWorldMinute=Number(at)||0;
  use.firstUseWorldMinute=Math.min(Number(use.firstUseWorldMinute??at),Number(at)||0);
  const person=use.byCitizen[citizen.id]||{minutes:0,sleepMinutes:0,visits:0,lastWorldMinute:0};
  if(Number(at)-Number(person.lastWorldMinute||0)>60)person.visits=Math.min(1e6,Number(person.visits||0)+1);
  person.minutes=Math.min(1e8,Number(person.minutes||0)+delta);
  if(['SLEEP','REST'].includes(action?.type))person.sleepMinutes=Math.min(1e8,Number(person.sleepMinutes||0)+delta);
  person.lastWorldMinute=Number(at)||0;
  use.byCitizen[citizen.id]=person;
  if(Object.keys(use.byCitizen).length>40)pruneRecord(use.byCitizen,40,x=>Number(x.lastWorldMinute)||0);
  state.structureUse[nearest.id]=use;
  return use;
}
export function structureUseSummary(world,structureId,at=world.clock?.worldMinute??0){
  const use=ensureLivingWorld(world).structureUse[String(structureId)];
  if(!use)return {minutes:0,sleepMinutes:0,visits:0,frequentUsers:[],firstUseWorldMinute:null,lastUseWorldMinute:null};
  const frequentUsers=Object.entries(use.byCitizen||{}).sort((a,b)=>Number(b[1].minutes||0)-Number(a[1].minutes||0)).slice(0,8).map(([citizenId,value])=>({citizenId,minutes:Math.round(Number(value.minutes)||0),sleepMinutes:Math.round(Number(value.sleepMinutes)||0),visits:Number(value.visits)||0}));
  return {minutes:Math.round(Number(use.minutes)||0),sleepMinutes:Math.round(Number(use.sleepMinutes)||0),visits:Number(use.visits)||0,frequentUsers,firstUseWorldMinute:use.firstUseWorldMinute??null,lastUseWorldMinute:use.lastUseWorldMinute??null};
}
function toolScore(object,actionType){
  if(!object||object.quantity<=0)return 0;
  const transformed=object.provenance?.type==='TRANSFORMATION'||['artifact','bundle','elongated','frame','layered','flat'].includes(object.kind);
  if(!transformed)return 0;
  const p=object.properties||{},hard=clamp(p.hardness,0,1),tough=clamp(p.toughness,0,1),structure=clamp(Number(p.structuralIntegrity||0)/520,0,1);
  if(actionType==='CUT')return hard*.55+tough*.45;
  if(actionType==='DIG')return hard*.7+structure*.3;
  if(actionType==='BUILD'||actionType==='ASSEMBLE')return tough*.55+structure*.45;
  if(actionType==='GATHER'||actionType==='CARRY')return tough*.35+structure*.2;
  return 0;
}
export function actionEfficiency(world,citizen,actionType){
  const type=String(actionType||'').toUpperCase(),skill=clamp(citizen?.skills?.[type.toLowerCase()],0,1);
  let bestTool=0;
  for(const object of world.objects||[])if(object.holderId===citizen?.id)bestTool=Math.max(bestTool,toolScore(object,type));
  return clamp(1+skill*.28+bestTool*.32,1,1.55);
}
export function recordPractice(citizen,actionType,durationMinutes=0){
  const type=String(actionType||'').toUpperCase();
  if(!['GATHER','CARRY','CUT','DIG','ASSEMBLE','BUILD'].includes(type)||!citizen)return 0;
  citizen.skills??={};
  const key=type.toLowerCase(),prior=clamp(citizen.skills[key],0,1),gain=Math.min(.035,Math.max(0,Number(durationMinutes)||0)/9000)*(1-prior);
  citizen.skills[key]=clamp(prior+gain,0,1);
  return citizen.skills[key];
}
export function constructionPhase(project){
  if(!project)return 'unknown';
  if(project.status==='completed')return 'complete';
  const progress=clamp(Number(project.workDoneMinutes||0)/Math.max(1,Number(project.workRequiredMinutes)||1),0,1);
  if(progress<.08)return 'site';
  if(progress<.25)return 'foundation';
  if(progress<.55)return 'frame';
  if(progress<.8)return 'roof';
  return 'enclosed';
}
export function deriveStockpiles(world){
  const groups=new Map();
  for(const object of world.objects||[]){
    if(!(object.quantity>0)||!object.position||object.kind==='corpse'||object.kind==='temporary_shelter')continue;
    const free=object.holderId===null||object.holderId===undefined||String(object.holderId).startsWith('commons:');
    if(!free)continue;
    const key=`${Math.floor(object.position.x/4)}:${Math.floor(object.position.y/4)}`;
    let group=groups.get(key);
    if(!group){group={id:`observer:stockpile:${key}`,position:{x:0,y:0},objectIds:[],materials:{},massKg:0,count:0,observerOnly:true};groups.set(key,group);}
    const mass=Math.max(0,Number(object.quantity)||0)*Math.max(0,Number(object.massPerUnitKg)||1);
    group.position.x+=Number(object.position.x);group.position.y+=Number(object.position.y);group.count++;group.massKg+=mass;group.objectIds.push(object.id);
    const material=object.material||object.kind;group.materials[material]=(group.materials[material]||0)+Number(object.quantity||0);
  }
  return [...groups.values()].map(group=>({...group,position:{x:group.position.x/group.count,y:group.position.y/group.count}})).filter(group=>group.count>=2||group.massKg>=3).sort((a,b)=>b.massKg-a.massKg).slice(0,48);
}
function structureClusters(world){
  const structures=[
    ...(world.buildings||[]).filter(b=>b.position&&Number(b.condition??1)>0).map(b=>({...b,_building:true})),
    ...(world.objects||[]).filter(o=>o.kind==='temporary_shelter'&&o.quantity>0&&o.position).map(o=>({...o,_building:false}))
  ];
  const remaining=new Set(structures.map(s=>s.id)),byId=new Map(structures.map(s=>[s.id,s])),clusters=[];
  while(remaining.size){
    const first=remaining.values().next().value,queue=[first],ids=[];remaining.delete(first);
    while(queue.length){
      const id=queue.pop(),a=byId.get(id);ids.push(id);
      for(const otherId of [...remaining]){
        const b=byId.get(otherId);
        if(Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y)<=14){remaining.delete(otherId);queue.push(otherId);}
      }
    }
    clusters.push(ids.map(id=>byId.get(id)));
  }
  return clusters;
}
export function deriveSettlements(world,at=world.clock?.worldMinute??0){
  const useState=ensureLivingWorld(world).structureUse;
  const results=[];
  for(const cluster of structureClusters(world)){
    if(!cluster.length)continue;
    const center={x:cluster.reduce((s,x)=>s+x.position.x,0)/cluster.length,y:cluster.reduce((s,x)=>s+x.position.y,0)/cluster.length};
    const buildings=cluster.filter(x=>x._building).length;
    const useMinutes=cluster.reduce((s,x)=>s+Number(useState[x.id]?.minutes||0),0);
    const population=(world.citizens||[]).filter(c=>c.alive&&Math.hypot(c.position.x-center.x,c.position.y-center.y)<=18).length;
    if(population<3)continue;
    if(!(buildings>=2||(buildings>=1&&useMinutes>=360)||(cluster.length>=4&&useMinutes>=1440)))continue;
    const firstUse=cluster.map(x=>Number(useState[x.id]?.firstUseWorldMinute)).filter(Number.isFinite);
    const traffic=trailStrengthAt(world,center.x,center.y,at);
    const id=`observer:settlement:${Math.round(center.x/5)}:${Math.round(center.y/5)}`;
    results.push({id,observerOnly:true,label:'Persistent settlement cluster',position:center,structureIds:cluster.map(x=>x.id),structures:cluster.length,buildings,population,useMinutes:Math.round(useMinutes),traffic:Number(traffic.toFixed(3)),sinceWorldMinute:firstUse.length?Math.min(...firstUse):Number(at)||0});
  }
  return results.sort((a,b)=>b.population-a.population||b.structures-a.structures).slice(0,16);
}
export function reputationSummary(citizen){
  const values=Object.values(citizen?.relationships||{});
  if(!values.length)return {knownPeers:0,trust:0,affection:0,fear:0};
  const avg=key=>values.reduce((s,r)=>s+Number(r?.[key]||0),0)/values.length;
  return {knownPeers:values.length,trust:Number(avg('trust').toFixed(3)),affection:Number(avg('affection').toFixed(3)),fear:Number(avg('fear').toFixed(3))};
}
export function advanceLivingWorld(world,fromMinute,toMinute){
  const state=ensureLivingWorld(world),to=Number(toMinute)||0;
  if(to-Number(state.traffic.lastPruneWorldMinute||0)>=1440){
    for(const [key,entry] of Object.entries(state.traffic.cells)){
      const value=decay(entry.traffic,entry.lastWorldMinute,to,TRAFFIC_HALF_LIFE);
      if(value<.08)delete state.traffic.cells[key];
    }
    pruneRecord(state.traffic.cells,MAX_TRAFFIC_CELLS,x=>decay(x.traffic,x.lastWorldMinute,to,TRAFFIC_HALF_LIFE));
    for(const [key,entry] of Object.entries(state.resourcePressure)){
      const value=decay(entry.pressure,entry.lastWorldMinute,to,HARVEST_HALF_LIFE);
      if(value<.02)delete state.resourcePressure[key];
    }
    state.traffic.lastPruneWorldMinute=to;
  }
  return state;
}
export function publicLivingWorld(world,at=world.clock?.worldMinute??0){
  const state=ensureLivingWorld(world);
  const trails=Object.entries(state.traffic.cells).map(([key,entry])=>{
    const strength=trailStrengthAt(world,...Object.values(cellCenter(key)),at);
    return {key,...cellCenter(key),strength:Number(strength.toFixed(3))};
  }).filter(x=>x.strength>=.08).sort((a,b)=>b.strength-a.strength).slice(0,220);
  const ecology=Object.entries(state.resourcePressure).map(([depositId,entry])=>({depositId,pressure:Number(decay(entry.pressure,entry.lastWorldMinute,at,HARVEST_HALF_LIFE).toFixed(3))})).filter(x=>x.pressure>.01).sort((a,b)=>b.pressure-a.pressure).slice(0,24);
  return {
    version:1,
    revision:Math.floor((Number(at)||0)/60),
    trails,
    stockpiles:deriveStockpiles(world),
    settlements:deriveSettlements(world,at),
    river:riverHydrology(world,50),
    ecology
  };
}
