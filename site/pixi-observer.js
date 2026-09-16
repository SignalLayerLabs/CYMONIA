import {terrainAtPublic,terrainDecoration,terrainPalette} from './terrain-model.js';
import {TransientMatterEffects} from './transient-physics.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function renderWorldMinute(state,nowMs=Date.now()){const epoch=Number(state?.clock?.realEpochMs),canonical=Number(state?.clock?.worldMinute)||0;return Number.isFinite(epoch)?Math.max(canonical,(nowMs-epoch)/1000):canonical;}
function citizenPosition(c,state,nowMs=Date.now()){const a=c?.currentAction;if(!a||a.type!=='MOVE'||!a.targetPosition||!a.fromPosition)return {...c.position};const now=renderWorldMinute(state,nowMs),span=Math.max(.001,Number(a.endsWorldMinute)-Number(a.startedWorldMinute)),t=clamp((now-Number(a.startedWorldMinute))/span,0,1),path=Array.isArray(a.path)&&a.path.length>=2?a.path:[a.fromPosition,a.targetPosition];let total=0;const lengths=[];for(let i=0;i<path.length-1;i++){const d=Math.hypot(path[i+1].x-path[i].x,path[i+1].y-path[i].y);lengths.push(d);total+=d;}if(total<=0)return {...a.targetPosition};let remaining=t*total;for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]||i===lengths.length-1){const u=lengths[i]?clamp(remaining/lengths[i],0,1):1;return{x:path[i].x+(path[i+1].x-path[i].x)*u,y:path[i].y+(path[i+1].y-path[i].y)*u};}remaining-=lengths[i];}return {...a.targetPosition};}
const ACTION_ICON={MOVE:'→',OBSERVE:'◉',REST:'·',SLEEP:'z',EAT:'•',DRINK:'≈',GATHER:'⌁',CARRY:'▣',CUT:'╱',DIG:'⌄',BUILD:'⌂',CARE:'+',TEACH:'◇',COMMUNICATE:'◇',EXPERIMENT:'✦',ATTACK:'⚠',DEFEND:'◈',TRANSFER:'↔',PROMISE:'∞',CLAIM:'⌁',REPRODUCE:'◌'};
function colorNumber(css){const m=String(css).match(/rgb\((\d+),(\d+),(\d+)\)/);return m?(Number(m[1])<<16)|(Number(m[2])<<8)|Number(m[3]):0x587040;}
function hashUnit(value){let h=2166136261>>>0;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return(h>>>0)/4294967295;}
function point(x,y,elevation=0){return{x:x*9.2,y:y*9.2*.76-elevation*2.8};}

export class PixiObserverLayer{
  constructor(canvasFallback){
    this.canvasFallback=canvasFallback;this.app=null;this.ready=false;this.failed=false;this.state=null;this.staticKey='';this.hits=[];this.citizenSprites=new Map();
    this.terrainLayer=null;this.waterLayer=null;this.vegetationLayer=null;this.resourceLayer=null;this.structureLayer=null;this.citizenLayer=null;this.effectsLayer=null;this.atmosphereLayer=null;this.root=null;this.transient=null;
    this.init();
  }
  async init(){
    const PIXI=globalThis.PIXI;if(!PIXI){this.failed=true;return;}
    try{
      this.app=new PIXI.Application();
      await this.app.init({resizeTo:this.canvasFallback.parentElement||window,backgroundAlpha:0,antialias:false,autoDensity:true,resolution:Math.min(globalThis.devicePixelRatio||1,2),preference:'webgl'});
      this.app.canvas.id='gpuCanvas';this.app.canvas.className='gpu-world-canvas';this.app.canvas.setAttribute('aria-hidden','true');
      this.canvasFallback.parentElement?.insertBefore(this.app.canvas,this.canvasFallback);
      this.root=new PIXI.Container();this.app.stage.addChild(this.root);
      this.terrainLayer=new PIXI.Container();this.waterLayer=new PIXI.Container();this.vegetationLayer=new PIXI.Container();this.resourceLayer=new PIXI.Container();this.structureLayer=new PIXI.Container();this.citizenLayer=new PIXI.Container();this.effectsLayer=new PIXI.Container();this.atmosphereLayer=new PIXI.Container();
      for(const layer of [this.terrainLayer,this.waterLayer,this.vegetationLayer,this.resourceLayer,this.structureLayer,this.citizenLayer,this.effectsLayer])this.root.addChild(layer);
      this.app.stage.addChild(this.atmosphereLayer);
      this.transient=new TransientMatterEffects(this.effectsLayer);this.ready=true;
    }catch(error){console.warn('Pixi observer unavailable; Canvas fallback remains active.',error);this.failed=true;}
  }
  setState(state){this.state=state;}
  staticSignature(state){return `${state?.worldId}|${state?.buildings?.length||0}|${state?.projects?.length||0}|${state?.objects?.length||0}|${state?.resourceDeposits?.map(d=>`${d.id}:${Math.round(d.quantity)}`).join(',')||''}`;}
  clearLayer(layer){if(!layer)return;for(const child of layer.removeChildren())child.destroy?.({children:true});}
  gRect(layer,x,y,w,h,color,alpha=1){const PIXI=globalThis.PIXI,g=new PIXI.Graphics();g.rect(x,y,w,h).fill({color,alpha});layer.addChild(g);return g;}
  gCircle(layer,x,y,r,color,alpha=1){const PIXI=globalThis.PIXI,g=new PIXI.Graphics();g.circle(x,y,r).fill({color,alpha});layer.addChild(g);return g;}
  rebuildStatic(){
    if(!this.ready||!this.state)return;const PIXI=globalThis.PIXI;
    for(const l of [this.terrainLayer,this.waterLayer,this.vegetationLayer,this.resourceLayer,this.structureLayer])this.clearLayer(l);
    for(let y=0;y<100;y+=2)for(let x=0;x<100;x+=2){const t=terrainAtPublic(this.state,x+1,y+1),p=point(x,y,t.elevation),q=point(x+2,y+2,t.elevation),w=q.x-p.x,h=q.y-p.y,color=colorNumber(terrainPalette(t.kind,0));const target=t.kind==='river'?this.waterLayer:this.terrainLayer;this.gRect(target,p.x,p.y,w+1,h+1,color,1);if(t.kind==='forest'){const d=terrainDecoration(this.state,x+1,y+1);if(d.density>.43){const c=point(x+1+(d.density-.5)*.8,y+1,t.elevation),g=new PIXI.Graphics();g.rect(c.x-1,c.y-7,2,7).fill(0x5b4027);g.circle(c.x,c.y-9,5).fill(0x315d39);g.circle(c.x-4,c.y-8,3.5).fill(0x3d6d3f);g.circle(c.x+4,c.y-8,3.5).fill(0x274f31);this.vegetationLayer.addChild(g);}}else if(t.kind==='wetland'){const d=terrainDecoration(this.state,x+1,y+1);if(d.density>.58){const c=point(x+1,y+1,t.elevation),g=new PIXI.Graphics();for(let i=0;i<4;i++)g.moveTo(c.x+(i-1.5)*2,c.y+2).lineTo(c.x+(i-1.5)*2,c.y-5-d.density*4).stroke({width:.8,color:0x839560});this.vegetationLayer.addChild(g);}}}
    for(const d of this.state.resourceDeposits||[]){const t=terrainAtPublic(this.state,d.position.x,d.position.y),p=point(d.position.x,d.position.y,t.elevation);let color=0x9a8c72;if(d.type==='water')color=0x6ab2c1;else if(d.type==='timber')color=0x315d39;else if(d.type==='food')color=0x789148;else if(d.type==='ore')color=0x59666d;else if(d.type==='clay')color=0x916b4d;const r=4+Math.min(8,Math.log10(Math.max(10,d.quantity))*1.4);this.gCircle(this.resourceLayer,p.x,p.y,r,color,.88);}
    for(const o of this.state.objects||[]){if(o.kind!=='temporary_shelter'||!(o.quantity>0)||!o.position)continue;const t=terrainAtPublic(this.state,o.position.x,o.position.y),p=point(o.position.x,o.position.y,t.elevation),g=new PIXI.Graphics();g.poly([p.x-9,p.y+3,p.x,p.y-11,p.x+9,p.y+3]).fill(0xb39b67).stroke({width:1,color:0x5a432b});this.structureLayer.addChild(g);}
    for(const pjt of this.state.projects||[]){if(pjt.status!=='construction')continue;const t=terrainAtPublic(this.state,pjt.site.x,pjt.site.y),p=point(pjt.site.x,pjt.site.y,t.elevation),progress=pjt.workRequiredMinutes?clamp(pjt.workDoneMinutes/pjt.workRequiredMinutes,0,1):.2,g=new PIXI.Graphics();g.rect(p.x-11,p.y-2,22,4).fill(0x9f8050);for(let i=-1;i<=1;i++)g.moveTo(p.x+i*8,p.y).lineTo(p.x+i*8,p.y-8-14*progress).stroke({width:2,color:0xd0af69});this.structureLayer.addChild(g);}
    for(const b of this.state.buildings||[]){if(!(b.massKg>0)||b.condition<=0)continue;const t=terrainAtPublic(this.state,b.position.x,b.position.y),p=point(b.position.x,b.position.y,t.elevation),g=new PIXI.Graphics();g.rect(p.x-14,p.y-20,28,20).fill(0x9c9678).stroke({width:1,color:0xe0d2a4});g.poly([p.x-18,p.y-20,p.x,p.y-34,p.x+18,p.y-20]).fill(0x6c4e35);this.structureLayer.addChild(g);}
    this.staticKey=this.staticSignature(this.state);
  }
  ensureCitizens(){if(!this.ready||!this.state)return;const PIXI=globalThis.PIXI,alive=new Set();for(const c of this.state.citizens||[]){if(!c.alive)continue;alive.add(c.id);let entry=this.citizenSprites.get(c.id);if(!entry){const container=new PIXI.Container(),body=new PIXI.Graphics();body.circle(0,-13,3.5).fill(0xd8bc92);body.rect(-4,-10,8,10).fill(c.kind==='HUMAN_LINKED'?0x315b76:0x4f7258);body.moveTo(-2,0).lineTo(-3,5).stroke({width:1.3,color:0x2f271f});body.moveTo(2,0).lineTo(3,5).stroke({width:1.3,color:0x2f271f});const task=new PIXI.Text({text:'',style:{fontFamily:'serif',fontSize:9,fill:0xf3dda0,stroke:{color:0x1d2b20,width:2}}});task.anchor.set(.5);task.position.set(0,-23);container.addChild(body,task);this.citizenLayer.addChild(container);entry={container,body,task};this.citizenSprites.set(c.id,entry);}}
    for(const [id,e] of this.citizenSprites)if(!alive.has(id)){e.container.destroy({children:true});this.citizenSprites.delete(id);}
  }
  screenPoint(worldX,worldY,elevation=0,camera){const p=point(worldX,worldY,elevation),scale=camera.zoom;return{x:this.app.screen.width/2+(p.x-camera.x*9.2)*scale,y:this.app.screen.height/2+(p.y-camera.y*9.2*.76)*scale};}
  ingestCanonicalEffects(events,camera){if(!this.transient)return;for(const e of events||[])if(e.type==='STRUCTURE_FRACTURED')this.transient.ingest(e,(x,y)=>this.screenPoint(x,y,terrainAtPublic(this.state,x,y).elevation,camera));}
  render(state,camera,minute,{selected=null,follow=null}={}){
    if(!this.ready||!this.app)return false;this.state=state;if(this.staticKey!==this.staticSignature(state))this.rebuildStatic();this.ensureCitizens();
    const cssW=this.app.screen.width,cssH=this.app.screen.height;this.root.scale.set(camera.zoom);this.root.position.set(cssW/2-camera.x*9.2*camera.zoom,cssH/2-camera.y*9.2*.76*camera.zoom);
    this.hits=[];
    for(const c of state.citizens||[]){if(!c.alive)continue;const e=this.citizenSprites.get(c.id);if(!e)continue;const pos=citizenPosition(c,state,Date.now()),t=terrainAtPublic(state,pos.x,pos.y),p=point(pos.x,pos.y,t.elevation),a=c.currentAction,moving=a?.type==='MOVE'&&minute<Number(a.endsWorldMinute),phase=performance.now()/125+hashUnit(c.id)*Math.PI*2;e.container.position.set(p.x,p.y+(moving?Math.sin(phase)*1.2:0));e.container.scale.set(1/camera.zoom*.95+camera.zoom*.05);e.task.text=a?ACTION_ICON[a.type]||'·':'';e.container.alpha=c.alive?1:.35;const sp=this.screenPoint(pos.x,pos.y,t.elevation,camera);this.hits.push({id:c.id,kind:'citizen',x:sp.x,y:sp.y-8*camera.zoom,r:12*Math.max(.7,camera.zoom)});if(c.id===selected||c.id===follow){e.container.alpha=1;}}
    for(const d of state.resourceDeposits||[]){const t=terrainAtPublic(state,d.position.x,d.position.y),sp=this.screenPoint(d.position.x,d.position.y,t.elevation,camera);this.hits.push({id:d.id,kind:'resource',x:sp.x,y:sp.y,r:14*Math.max(.7,camera.zoom)});}
    for(const b of state.buildings||[]){if(!(b.massKg>0)||b.condition<=0)continue;const t=terrainAtPublic(state,b.position.x,b.position.y),sp=this.screenPoint(b.position.x,b.position.y,t.elevation,camera);this.hits.push({id:b.id,kind:'building',x:sp.x,y:sp.y-12*camera.zoom,r:22*Math.max(.7,camera.zoom)});}
    for(const pjt of state.projects||[]){if(pjt.status!=='construction')continue;const t=terrainAtPublic(state,pjt.site.x,pjt.site.y),sp=this.screenPoint(pjt.site.x,pjt.site.y,t.elevation,camera);this.hits.push({id:pjt.id,kind:'project',x:sp.x,y:sp.y-8*camera.zoom,r:18*Math.max(.7,camera.zoom)});}
    for(const o of state.objects||[]){if(o.kind!=='temporary_shelter'||!(o.quantity>0)||!o.position)continue;const t=terrainAtPublic(state,o.position.x,o.position.y),sp=this.screenPoint(o.position.x,o.position.y,t.elevation,camera);this.hits.push({id:o.id,kind:'shelter',x:sp.x,y:sp.y-5*camera.zoom,r:15*Math.max(.7,camera.zoom)});}
    const rain=Number(state.environment?.precipitation||0);this.waterLayer.alpha=.88+.08*Math.sin(minute*.13);this.vegetationLayer.y=Math.sin(minute*.05)*.35;this.atmosphereLayer.removeChildren().forEach(x=>x.destroy?.());if(rain>.08){const PIXI=globalThis.PIXI,g=new PIXI.Graphics();for(let i=0;i<Math.min(90,20+Math.round(rain*100));i++){const x=hashUnit(`${Math.floor(minute/2)}|${i}|x`)*cssW,y=hashUnit(`${i}|y`)*cssH;g.moveTo(x,y).lineTo(x-4,y+10).stroke({width:1,color:0xc6dedb,alpha:.18+rain*.2});}this.atmosphereLayer.addChild(g);}
    this.ingestCanonicalEffects(state.recentLedger||state.ledgerEvents||[],camera);const debris=this.transient?.update()||[];this.effectsLayer.removeChildren().forEach(x=>x.destroy?.());for(const d of debris){const g=new globalThis.PIXI.Graphics();g.rect(-d.size/2,-d.size/2,d.size,d.size).fill({color:0x897b69,alpha:d.alpha});g.position.set((d.x-cssW/2+camera.x*9.2*camera.zoom)/camera.zoom,(d.y-cssH/2+camera.y*9.2*.76*camera.zoom)/camera.zoom);g.rotation=d.angle;this.effectsLayer.addChild(g);}
    return true;
  }
}
