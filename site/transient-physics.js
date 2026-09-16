const observerOnly=true;
const TAU=Math.PI*2;
function hash32(value){let h=2166136261>>>0;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
function unit(key){return hash32(key)/4294967295;}

export function fragmentVisualSpecs(event){
  if(!event||event.type!=='STRUCTURE_FRACTURED')return [];
  const p=event.payload||{},origin=p.position||{x:50,y:50};
  return (p.fragments||[]).map((f,i)=>{const a=unit(`${event.id}|${f.id}|a`)*TAU,r=.25+unit(`${event.id}|${i}|r`)*1.5;return{id:f.id,massKg:Math.max(.01,Number(f.massKg)||1),x:origin.x+Math.cos(a)*r,y:origin.y+Math.sin(a)*r,vx:Math.cos(a)*(1.2+unit(`${event.id}|${i}|vx`)*2.2),vy:Math.sin(a)*(1.2+unit(`${event.id}|${i}|vy`)*2.2)-1.5,angularVelocity:(unit(`${event.id}|${i}|av`)-.5)*.18,ttlMs:2600+Math.round(unit(`${event.id}|${i}|ttl`)*2800)};});
}

export class TransientMatterEffects{
  constructor(pixiLayer=null){this.observerOnly=observerOnly;this.layer=pixiLayer;this.engine=null;this.bodies=new Map();this.seen=new Set();this.ready=Boolean(globalThis.Matter);if(this.ready)this.engine=globalThis.Matter.Engine.create({gravity:{x:0,y:.35,scale:.001}});}
  ingest(event,screenProject){if(!this.ready||!event||event.type!=='STRUCTURE_FRACTURED'||this.seen.has(event.id))return;this.seen.add(event.id);const M=globalThis.Matter;for(const spec of fragmentVisualSpecs(event)){const p=screenProject?screenProject(spec.x,spec.y):{x:spec.x,y:spec.y},size=Math.max(2,Math.min(9,2+Math.sqrt(spec.massKg))),body=M.Bodies.rectangle(p.x,p.y,size,size,{density:Math.max(.001,Math.min(.04,spec.massKg/1000)),friction:.65,restitution:.22,frictionAir:.018,label:`observer-debris:${spec.id}`});M.Body.setVelocity(body,{x:spec.vx,y:spec.vy});M.Body.setAngularVelocity(body,spec.angularVelocity);M.Composite.add(this.engine.world,body);this.bodies.set(spec.id,{body,expires:performance.now()+spec.ttlMs,size});}}
  update(now=performance.now()){if(!this.ready)return [];globalThis.Matter.Engine.update(this.engine,1000/60);const visible=[];for(const [id,item] of this.bodies){if(now>=item.expires){globalThis.Matter.Composite.remove(this.engine.world,item.body);this.bodies.delete(id);continue;}visible.push({id,x:item.body.position.x,y:item.body.position.y,angle:item.body.angle,size:item.size,alpha:Math.max(0,Math.min(1,(item.expires-now)/900))});}return visible;}
}
export {observerOnly};
