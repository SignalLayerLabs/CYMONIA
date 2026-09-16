const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function seedOf(world){const n=Number(world?.seed);if(Number.isFinite(n))return n;const m=String(world?.worldId||'').match(/(\d{5,})/);return m?Number(m[1]):20260915;}
function hashUnit(seed,x,y,salt=0){let h=2166136261>>>0;const s=`${seed}|${Math.floor(x*16)}|${Math.floor(y*16)}|${salt}`;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return(h>>>0)/4294967295;}
function smooth(t){return t*t*(3-2*t);}
function valueNoise(seed,x,y,salt=0){const x0=Math.floor(x),y0=Math.floor(y),fx=smooth(x-x0),fy=smooth(y-y0);const a=hashUnit(seed,x0,y0,salt),b=hashUnit(seed,x0+1,y0,salt),c=hashUnit(seed,x0,y0+1,salt),d=hashUnit(seed,x0+1,y0+1,salt);return a+(b-a)*fx+(c-a+(d-b-c+a)*fx)*fy;}
export function riverCenterX(world,y){const seed=seedOf(world),phase=(seed%997)/997*TAU;return 43.8+Math.sin(y*.125+phase)*2.5+Math.sin(y*.043+1.7+phase*.33)*1.15;}
export function terrainAt(world,x,y){
  x=clamp(Number(x)||0,0,100);y=clamp(Number(y)||0,0,100);const seed=seedOf(world);
  const large=valueNoise(seed,x/22,y/22,1),detail=valueNoise(seed,x/7.5,y/7.5,2),micro=valueNoise(seed,x/2.7,y/2.7,3);
  const elevation=(large-.5)*3.4+(detail-.5)*1.15;
  const riverDistance=Math.abs(x-riverCenterX(world,y));
  const moisture=clamp(.22+(1-riverDistance/26)*.48+(1-large)*.18+(detail-.5)*.15,0,1);
  let kind='meadow',movementCost=1,cover=.08;
  if(riverDistance<1.1){kind='river';movementCost=4.2;cover=0;}
  else if(riverDistance<2.35){kind='wetland';movementCost=1.65;cover=.05;}
  else if(elevation>1.25||detail>.82){kind='rocky';movementCost=1.52;cover=.03;}
  else if(moisture>.62&&detail>.42){kind='forest';movementCost=1.34;cover=.5;}
  else if(moisture<.29&&micro>.54){kind='dry_grass';movementCost=1.08;cover=.04;}
  return {kind,movementCost,elevation,moisture,riverDistance,cover,passable:true};
}
function structureRadius(entity){if(entity?.kind==='temporary_shelter')return .9;return Number(entity?.footprintRadius)||1.55;}
export function structureOccupancyAt(world,x,y,{ignoreId=null}={}){
  for(const b of world?.buildings||[]){if(b.id===ignoreId||!b.position)continue;const r=structureRadius(b);if(Math.hypot(x-b.position.x,y-b.position.y)<r)return {entity:b,radius:r};}
  for(const o of world?.objects||[]){if(o.id===ignoreId||o.kind!=='temporary_shelter'||!(o.quantity>0)||!o.position)continue;const r=structureRadius(o);if(Math.hypot(x-o.position.x,y-o.position.y)<r)return {entity:o,radius:r};}
  return null;
}
export function resolveAccessibleTarget(world,citizen,target,targetId=null){
  const t={x:clamp(Number(target?.x)||0,1,99),y:clamp(Number(target?.y)||0,1,99)};
  const occupied=structureOccupancyAt(world,t.x,t.y,{ignoreId:targetId});if(!occupied)return t;
  const c=occupied.entity.position,from=citizen?.position||{x:c.x-1,y:c.y};let dx=from.x-c.x,dy=from.y-c.y,n=Math.hypot(dx,dy);if(n<.001){dx=1;dy=0;n=1;}const r=occupied.radius+.35;return {x:clamp(c.x+dx/n*r,1,99),y:clamp(c.y+dy/n*r,1,99)};
}

function firstPathCollision(world,from,to,targetId=null,samples=40){for(let i=1;i<samples;i++){const t=i/samples,x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t,occ=structureOccupancyAt(world,x,y,{ignoreId:targetId});if(occ)return occ;}return null;}
export function routePath(world,citizen,target,targetId=null){const from={...citizen.position},to=resolveAccessibleTarget(world,citizen,target,targetId),collision=firstPathCollision(world,from,to,targetId);if(!collision)return[from,to];const c=collision.entity.position,r=collision.radius+1,dx=to.x-from.x,dy=to.y-from.y,n=Math.hypot(dx,dy)||1,px=-dy/n,py=dx/n,preferred=((Math.floor(from.x*13+from.y*7+to.x*5+to.y*11))&1)?1:-1;for(const side of [preferred,-preferred]){const waypoint={x:clamp(c.x+px*r*side,1,99),y:clamp(c.y+py*r*side,1,99)};if(structureOccupancyAt(world,waypoint.x,waypoint.y,{ignoreId:targetId}))continue;const first=firstPathCollision(world,from,waypoint,targetId,28),second=firstPathCollision(world,waypoint,to,targetId,28);if(!first&&!second)return[from,waypoint,to];}return[from,to];}
function segmentSamples(world,a,b,targetId,count=12){let terrainTotal=0,structurePenalty=0;const kinds=new Set();for(let i=0;i<=count;i++){const t=i/count,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,terrain=terrainAt(world,x,y);terrainTotal+=terrain.movementCost;kinds.add(terrain.kind);if(structureOccupancyAt(world,x,y,{ignoreId:targetId}))structurePenalty+=.8;}return{distance:Math.hypot(b.x-a.x,b.y-a.y),terrainTotal,count:count+1,structurePenalty,kinds};}

export function carriedMassKg(world,citizen){let kg=0;for(const o of world?.objects||[])if(o.holderId===citizen.id&&o.quantity>0)kg+=Math.max(0,Number(o.quantity)||0)*Math.max(0,Number(o.massPerUnitKg)||1);return kg;}
export function travelProfile(world,citizen,target,{targetId=null,samples=24}={}){
  const path=routePath(world,citizen,target,targetId),count=Math.max(4,Math.ceil(samples/Math.max(1,path.length-1)));let distance=0,terrainTotal=0,sampleCount=0,structurePenalty=0;const kinds=new Set();
  for(let i=0;i<path.length-1;i++){const part=segmentSamples(world,path[i],path[i+1],targetId,count);distance+=part.distance;terrainTotal+=part.terrainTotal;sampleCount+=part.count;structurePenalty+=part.structurePenalty;for(const k of part.kinds)kinds.add(k);}
  const averageTerrainCost=terrainTotal/Math.max(1,sampleCount),loadKg=carriedMassKg(world,citizen),bodyKg=Math.max(35,Number(citizen.body?.massKg)||70),loadFactor=1+Math.min(1.25,loadKg/bodyKg*.9),detourFactor=1+Math.min(.65,structurePenalty/Math.max(1,sampleCount)),physicalCapacity=clamp(Number(citizen.genome?.physicalCapacity)||1,.55,1.55),capabilityFactor=1/physicalCapacity,rain=Math.max(0,Number(world.environment?.precipitation)||0),weatherFactor=1+Math.min(.35,rain*.22+Math.max(0,Number(world.environment?.soilMoisture||0)-.75)*.15),baseMinutes=distance*2,minimumMinutes=Math.max(1,Math.ceil(baseMinutes*averageTerrainCost*loadFactor*detourFactor*capabilityFactor*weatherFactor));
  return {distance,minimumMinutes,averageTerrainCost,loadKg,loadFactor,detourFactor,physicalCapacity,capabilityFactor,weatherFactor,terrainKinds:[...kinds],targetPosition:path[path.length-1],path};
}
export function environmentalExposure(world,citizen){const here=terrainAt(world,citizen.position.x,citizen.position.y),rain=Math.max(0,Number(world?.environment?.precipitation)||0);let thermalProtection=0,precipitationProtection=0,shelterId=null;for(const o of world?.objects||[]){if(o.kind!=='temporary_shelter'||!(o.quantity>0)||!o.position)continue;if(Math.hypot(citizen.position.x-o.position.x,citizen.position.y-o.position.y)<=1.8){const t=Number(o.properties?.thermalProtection||0),p=Number(o.properties?.precipitationProtection||0);if(t+p>thermalProtection+precipitationProtection){thermalProtection=t;precipitationProtection=p;shelterId=o.id;}}}for(const b of world?.buildings||[]){if(!b.position)continue;if(Math.hypot(citizen.position.x-b.position.x,citizen.position.y-b.position.y)<=1.8){const t=Number(b.protection?.thermal||.75),p=Number(b.protection?.precipitation||.8);if(t+p>thermalProtection+precipitationProtection){thermalProtection=t;precipitationProtection=p;shelterId=b.id;}}}return {terrain:here.kind,moisture:here.moisture,rain,thermalProtection:clamp(thermalProtection,0,.98),precipitationProtection:clamp(precipitationProtection,0,.98),rainExposure:rain*(1-clamp(precipitationProtection,0,.98)),shelterId};}
