// Presentation geometry only. Never changes the canonical simulation.
export const SECTOR_COLORS = {technology:'#86c7e8',research:'#baa9e0',mobility:'#e6ba6b',housing:'#dfaaa0',food:'#9bb97b',energy:'#e4c16b',security:'#b997a2',logistics:'#8bb8ac',finance:'#99badd',media:'#c8a3ce',information:'#c8a3ce',goods:'#9bb97b'};
export const INSTITUTIONS = [
  {id:'institution:central_bank',key:'central_bank',name:'Central Bank',x:49,y:40,sprite:8},
  {id:'institution:government',key:'government',name:'Government',x:61,y:48,sprite:9},
  {id:'institution:justice',key:'justice',name:'Justice',x:48,y:61,sprite:10},
  {id:'institution:police',key:'police',name:'Police',x:36,y:49,sprite:11},
];
export function cameraScale(c) { return Math.min(c.width/1380,(c.height-80)/720)*c.zoom; }
export function project(x,y,c) {
  const s=cameraScale(c);
  return {x:c.width/2+(x-y)*8*s+c.panX,y:c.height*.51+(x+y-100)*4*s+c.panY};
}
export function unproject(x,y,c) {
  const s=cameraScale(c),a=(x-c.width/2-c.panX)/(8*s),b=(y-c.height*.51-c.panY)/(4*s)+100;
  return {x:(a+b)/2,y:(b-a)/2};
}
export function buildingSprite(b,sector) {
  if(b.status==='construction')return Number(b.progress??0)<35?12:13;
  return ({housing:0,food:1,goods:1,technology:3,research:4,energy:5,logistics:6,mobility:7,security:11,media:14,information:14,finance:15})[sector]??2;
}
export function sceneEntities(world) {
  const companies=new Map((world.companies||[]).map(c=>[c.id,c]));
  const entities=(world.buildings||[]).map(b=>({id:b.id,kind:'building',x:b.x,y:b.y,data:b,company:companies.get(b.company_id),sprite:buildingSprite(b,companies.get(b.company_id)?.sector)}));
  for(const c of world.companies||[])if(!world.buildings?.some(b=>b.company_id===c.id))entities.push({id:c.id,kind:'company',x:c.x,y:c.y,data:c,company:c,sprite:buildingSprite(c,c.sector)});
  for(const i of INSTITUTIONS)if(world.institutions?.[i.key])entities.push({...i,kind:'institution',data:world.institutions[i.key]});
  for(const c of world.citizens||[])entities.push({id:c.id,kind:'citizen',x:c.x,y:c.y,data:c});
  return entities.sort((a,b)=>(a.x+a.y)-(b.x+b.y)||a.id.localeCompare(b.id));
}
export function pickEntity(hits,x,y) {
  for(let i=hits.length-1;i>=0;i--){const h=hits[i];if(x>=h.x-h.width/2&&x<=h.x+h.width/2&&y>=h.y-h.height&&y<=h.y+5)return h;}
  return null;
}
