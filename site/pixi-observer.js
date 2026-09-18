import {terrainAtPublic,terrainDecoration,terrainPalette} from './terrain-model.js';
import {TransientMatterEffects} from './transient-physics.js';
import {isoPoint,sceneEntries,staticSceneKey,citizenFrame,artHash} from './medieval-art.js';
import {citizenVisualPose} from './citizen-animation.js';
import {SpineCitizenAdapter} from './spine-citizen-adapter.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function renderWorldMinute(state,nowMs=Date.now()){const raw=state?.clock?.realEpochMs,epoch=Number(raw),canonical=Number(state?.clock?.worldMinute)||0;return raw!=null&&Number.isFinite(epoch)?Math.max(canonical,(nowMs-epoch)/1000):canonical;}
function citizenPosition(c,state,nowMs=Date.now()){const a=c?.currentAction;if(!a||a.type!=='MOVE'||!a.targetPosition||!a.fromPosition)return {...c.position};const now=renderWorldMinute(state,nowMs),span=Math.max(.001,Number(a.endsWorldMinute)-Number(a.startedWorldMinute)),t=clamp((now-Number(a.startedWorldMinute))/span,0,1),path=Array.isArray(a.path)&&a.path.length>=2?a.path:[a.fromPosition,a.targetPosition];let total=0;const lengths=[];for(let i=0;i<path.length-1;i++){const d=Math.hypot(path[i+1].x-path[i].x,path[i+1].y-path[i].y);lengths.push(d);total+=d;}if(total<=0)return {...a.targetPosition};let remaining=t*total;for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]||i===lengths.length-1){const u=lengths[i]?clamp(remaining/lengths[i],0,1):1;return{x:path[i].x+(path[i+1].x-path[i].x)*u,y:path[i].y+(path[i+1].y-path[i].y)*u};}remaining-=lengths[i];}return {...a.targetPosition};}
const ACTION_ICON={MOVE:'→',OBSERVE:'◉',REST:'·',SLEEP:'z',EAT:'•',DRINK:'≈',GATHER:'⌁',CARRY:'▣',CUT:'╱',DIG:'⌄',BUILD:'⌂',CARE:'+',TEACH:'◇',COMMUNICATE:'◇',EXPERIMENT:'✦',ATTACK:'⚠',DEFEND:'◈',TRANSFER:'↔',PROMISE:'∞',CLAIM:'⌁',REPRODUCE:'◌'};
function colorNumber(css){const m=String(css).match(/rgb\((\d+),(\d+),(\d+)\)/);return m?(Number(m[1])<<16)|(Number(m[2])<<8)|Number(m[3]):0x587040;}
function hashUnit(value){let h=2166136261>>>0;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return(h>>>0)/4294967295;}
const point=isoPoint;

export class PixiObserverLayer{
  constructor(canvasFallback,art){
    this.canvasFallback=canvasFallback;this.art=art;this.app=null;this.ready=false;this.failed=false;this.state=null;this.staticKey='';this.hits=[];this.citizenSprites=new Map();this.frames=[];this.groundSource=null;this.staticEntries=[];
    // Logical object layers share a depth-sorted container, so trees can occlude people correctly.
    this.vegetationLayer=[];this.resourceLayer=[];this.structureLayer=[];this.citizenLayer=null;this.spineAdapter=null;
    this.init();
  }
  async init(){
    const PIXI=globalThis.PIXI;if(!PIXI){this.failed=true;return;}
    try{
      this.app=new PIXI.Application();
      await this.app.init({resizeTo:this.canvasFallback.parentElement||window,background:0x68784d,antialias:true,autoDensity:true,resolution:Math.min(globalThis.devicePixelRatio||1,2),preference:'webgl'});
      this.app.canvas.id='gpuCanvas';this.app.canvas.className='gpu-world-canvas';this.app.canvas.setAttribute('aria-hidden','true');
      this.canvasFallback.parentElement?.insertBefore(this.app.canvas,this.canvasFallback);
      this.root=new PIXI.Container();this.app.stage.addChild(this.root);
      this.terrainLayer=new PIXI.Container();this.waterLayer=new PIXI.Graphics();this.citizenLayer=new PIXI.Container();this.citizenLayer.sortableChildren=true;this.effectsLayer=new PIXI.Container();this.atmosphereLayer=new PIXI.Container();
      this.root.addChild(this.terrainLayer,this.waterLayer,this.citizenLayer,this.effectsLayer);this.app.stage.addChild(this.atmosphereLayer);
      this.transient=new TransientMatterEffects(this.effectsLayer);
      await this.art.ready;
      if(!this.art.atlas)throw new Error('Art atlas unavailable');
      const source=PIXI.Texture.from(this.art.atlas).source;
      this.frames=this.art.frames.map(f=>new PIXI.Texture({source,frame:new PIXI.Rectangle(f.x,f.y,f.w,f.h)}));
      this.spineAdapter=new SpineCitizenAdapter(PIXI,globalThis.CYMONIA_SPINE);
      await this.spineAdapter.preload();
      this.ready=true;
    }catch(error){console.warn('Pixi observer unavailable; Canvas fallback remains active.',error);this.app?.destroy(true,{children:true});this.app=null;this.failed=true;}
  }
  setState(state){this.state=state;}
  staticSignature(state){return `${staticSceneKey(state)}|${this.art.revision}`;}
  clearLayer(layer){for(const child of layer.removeChildren())child.destroy({children:true});}
  sprite(frame,size){const s=new globalThis.PIXI.Sprite(this.frames[frame]);s.anchor.set(.5,.94);s.scale.set(size/s.texture.width);return s;}
  rebuildStatic(){
    const PIXI=globalThis.PIXI,ground=this.art.groundFor(this.state);
    if(this.groundSource!==ground){
      this.groundSprite?.texture.destroy(true);this.clearLayer(this.terrainLayer);
      const s=new PIXI.Sprite(PIXI.Texture.from(ground));s.position.set(-1600,0);this.terrainLayer.addChild(s);this.groundSprite=s;this.groundSource=ground;
    }
    for(const s of [...this.vegetationLayer,...this.resourceLayer,...this.structureLayer])s.destroy({children:true});
    this.vegetationLayer=[];this.resourceLayer=[];this.structureLayer=[];this.waterLayer.clear();
    this.staticEntries=sceneEntries(this.state);
    for(const e of this.staticEntries){
      const t=terrainAtPublic(this.state,e.position.x,e.position.y),p=point(e.position.x,e.position.y,t.elevation);
      if(e.frame===-1){this.waterLayer.ellipse(p.x,p.y,15,7).stroke({width:1,color:0xbce4db,alpha:.5});continue;}
      const sprite=this.sprite(e.frame,e.size);sprite.position.set(p.x,p.y);sprite.zIndex=p.y;
      if(e.kind==='project'){const bar=new PIXI.Graphics();bar.rect(-22,6,44,3).fill(0x2b3024).rect(-22,6,44*e.progress,3).fill(0xd8bd76);bar.position.set(p.x,p.y);bar.zIndex=p.y+.1;this.structureLayer.push(bar);this.citizenLayer.addChild(bar);}
      this.citizenLayer.addChild(sprite);
      (e.kind==='scenery'?this.vegetationLayer:e.kind==='resource'?this.resourceLayer:this.structureLayer).push(sprite);
    }
    this.staticKey=this.staticSignature(this.state);
  }
  ensureCitizens(){
    const PIXI=globalThis.PIXI,alive=new Set();
    for(const c of this.state.citizens||[]){
      if(!c.alive)continue;alive.add(c.id);if(this.citizenSprites.has(c.id))continue;
      let entry=this.spineAdapter?.create(c)||null;
      if(!entry){
        const container=new PIXI.Container(),body=this.sprite(citizenFrame(c),19),shadow=new PIXI.Graphics();
        shadow.ellipse(1,1,6,2.8).fill({color:0x1d281c,alpha:.22});
        const task=new PIXI.Text({text:'',style:{fontFamily:'Georgia',fontSize:10,fill:0xf8e8b5,stroke:{color:0x283021,width:2}}});
        task.anchor.set(.5);task.position.set(0,-41);container.addChild(shadow,body,task);
        entry={container,body,task,shadow,baseScale:Math.abs(body.scale.x),spine:false};
      }
      this.citizenLayer.addChild(entry.container);this.citizenSprites.set(c.id,entry);
    }
    for(const [id,e] of this.citizenSprites)if(!alive.has(id)){e.container.destroy({children:true});this.citizenSprites.delete(id);}
  }
  screenPoint(x,y,elevation=0,camera){const p=point(x,y,elevation),origin=point(camera.x,camera.y);return{x:camera.width/2+(p.x-origin.x)*camera.zoom,y:camera.height/2+(p.y-origin.y)*camera.zoom};}
  ingestCanonicalEffects(events,camera){for(const e of events||[])if(e.type==='STRUCTURE_FRACTURED')this.transient?.ingest(e,(x,y)=>this.screenPoint(x,y,terrainAtPublic(this.state,x,y).elevation,camera));}
  render(state,camera,minute,{selected=null,follow=null}={}){
    if(!this.ready||!this.app)return false;this.state=state;
    if(this.staticKey!==this.staticSignature(state))this.rebuildStatic();this.ensureCitizens();
    const origin=point(camera.x,camera.y);this.root.scale.set(camera.zoom);this.root.position.set(camera.width/2-origin.x*camera.zoom,camera.height/2-origin.y*camera.zoom);this.hits=[];
    const hits=[];
    for(const e of this.staticEntries){if(!e.id)continue;const t=terrainAtPublic(state,e.position.x,e.position.y),p=this.screenPoint(e.position.x,e.position.y,t.elevation,camera);hits.push({...this.art.hitRecord(e,p,camera.zoom),depth:point(e.position.x,e.position.y,t.elevation).y});}
    for(const c of state.citizens||[]){if(!c.alive)continue;const e=this.citizenSprites.get(c.id),pos=citizenPosition(c,state),t=terrainAtPublic(state,pos.x,pos.y),p=point(pos.x,pos.y,t.elevation),a=c.currentAction,moving=a?.type==='MOVE'&&minute<Number(a.endsWorldMinute),active=c.id===selected||c.id===follow;
      const flip=Boolean(moving&&a?.targetPosition&&a?.fromPosition&&a.targetPosition.x-a.targetPosition.y<a.fromPosition.x-a.fromPosition.y);
      e.container.position.set(p.x,p.y);e.container.zIndex=p.y;
      if(e.spine){
        this.spineAdapter?.update(e,c,{flip});
      }else{
        const pose=citizenVisualPose(c,performance.now());
        e.body.y=pose.y;e.body.rotation=pose.rotation;
        e.body.scale.set((flip?-1:1)*e.baseScale*pose.scaleX,e.baseScale*pose.scaleY);
        if(e.shadow)e.shadow.scale.x=pose.shadowScale;
      }
      e.task.text=a&&(active||camera.zoom>2)?ACTION_ICON[a.type]||'·':'';
      const sp=this.screenPoint(pos.x,pos.y,t.elevation,camera);hits.push({...this.art.hitRecord({id:c.id,kind:'citizen',frame:citizenFrame(c),size:19},{x:sp.x,y:sp.y+e.body.y*camera.zoom},camera.zoom,e.body.scale.x<0),depth:p.y});
    }
    this.hits=hits.sort((a,b)=>a.depth-b.depth);
    this.waterLayer.alpha=.7+.3*Math.sin(minute*.13);
    this.ingestCanonicalEffects(state.recentLedger||state.ledgerEvents||[],camera);this.clearLayer(this.effectsLayer);
    for(const d of this.transient?.update()||[]){const g=new globalThis.PIXI.Graphics();g.rect(-d.size/2,-d.size/2,d.size,d.size).fill({color:0x897b69,alpha:d.alpha});g.position.set((d.x-camera.width/2)/camera.zoom+origin.x,(d.y-camera.height/2)/camera.zoom+origin.y);g.rotation=d.angle;this.effectsLayer.addChild(g);}
    return true;
  }
}
