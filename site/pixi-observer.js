import {terrainAtPublic,terrainDecoration,terrainPalette,riverCenterXPublic} from './terrain-model.js';
import {TransientMatterEffects} from './transient-physics.js';
import {isoPoint,sceneEntries,staticSceneKey} from './medieval-art.js';
import {citizenVisualPose} from './citizen-animation.js';
import {SpineCitizenAdapter} from './spine-citizen-adapter.js';
import {canonicalVisualIndex,actionVisualContext,actionContextShapes,drawActionContextPixi,materialColor,isHotObject} from './action-animations.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
import {citizenPosition,citizenDisplayOffsets} from './observer-motion.js';
function colorNumber(css){const m=String(css).match(/rgb\((\d+),(\d+),(\d+)\)/);return m?(Number(m[1])<<16)|(Number(m[2])<<8)|Number(m[3]):0x587040;}
function hashUnit(value){let h=2166136261>>>0;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return(h>>>0)/4294967295;}
const point=isoPoint;
const CITIZEN_STAND_SIZE=10.5;
const CITIZEN_SLEEP_SIZE=15;
const CITIZEN_STAND_ANCHOR_Y=1;
const CITIZEN_SLEEP_ANCHOR_Y=1;
const CITIZEN_STAND_LIFT=0;
const CITIZEN_SLEEP_LIFT=-2;

export class PixiObserverLayer{
  constructor(canvasFallback,art){
    this.canvasFallback=canvasFallback;this.art=art;this.app=null;this.ready=false;this.failed=false;this.state=null;this.staticKey='';this.hits=[];this.citizenSprites=new Map();this.frames=[];this.groundSource=null;this.staticEntries=[];this.livingKey='';
    // Logical object layers share a depth-sorted container, so trees can occlude people correctly.
    this.vegetationLayer=[];this.resourceLayer=[];this.structureLayer=[];this.citizenLayer=null;this.spineAdapter=null;this.ownedCitizenId=null;this.debrisSprites=[];this.hotObjects=[];
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
      this.terrainLayer=new PIXI.Container();this.trailLayer=new PIXI.Container();this.riverOverlayLayer=new PIXI.Container();this.waterLayer=new PIXI.Graphics();this.riverFlowLayer=new PIXI.Graphics();this.stockpileLayer=new PIXI.Container();this.citizenLayer=new PIXI.Container();this.citizenLayer.sortableChildren=true;this.effectsLayer=new PIXI.Container();this.atmosphereLayer=new PIXI.Container();
      this.root.addChild(this.terrainLayer,this.trailLayer,this.riverOverlayLayer,this.waterLayer,this.riverFlowLayer,this.stockpileLayer,this.citizenLayer,this.effectsLayer);this.app.stage.addChild(this.atmosphereLayer);
      this.transient=new TransientMatterEffects(this.effectsLayer);
      await this.art.ready;
      if(!this.art.atlas)throw new Error('Art atlas unavailable');
      const source=PIXI.Texture.from(this.art.atlas).source;
      this.frames=this.art.frames.map(f=>new PIXI.Texture({source,frame:new PIXI.Rectangle(f.x,f.y,f.w,f.h)}));
      this.citizenTextures=new Map([['base',this.frames]]);
      for(const atlas of ['sleep',...this.art.citizenAtlases.map((_,i)=>`citizen:${i}`),...this.art.animatedCitizenAtlases.map((_,i)=>`animated:${i}`)]){
        const asset=this.art.atlasFor({atlas});if(!asset.image)continue;
        const source=PIXI.Texture.from(asset.image).source;
        this.citizenTextures.set(atlas,asset.frames.map(f=>new PIXI.Texture({source,frame:new PIXI.Rectangle(f.x,f.y,f.w,f.h)})));
      }
      this.spineAdapter=new SpineCitizenAdapter(PIXI,globalThis.CYMONIA_SPINE);
      await this.spineAdapter.preload();
      this.ready=true;
    }catch(error){console.warn('Pixi observer unavailable; Canvas fallback remains active.',error);this.app?.destroy(true,{children:true});this.app=null;this.failed=true;}
  }
  setState(state,offsets=citizenDisplayOffsets(state)){this.state=state;this.citizenOffsets=offsets;this.visualIndex=canonicalVisualIndex(state);}
  setOwnedCitizen(id){this.ownedCitizenId=id||null;}
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
    this.vegetationLayer=[];this.resourceLayer=[];this.structureLayer=[];this.hotObjects=[];this.waterLayer.clear();
    this.staticEntries=sceneEntries(this.state);
    for(const e of this.staticEntries){
      const t=terrainAtPublic(this.state,e.position.x,e.position.y),p=point(e.position.x,e.position.y,t.elevation);
      if(e.frame===-1){this.waterLayer.ellipse(p.x,p.y,15,7).stroke({width:1,color:0xbce4db,alpha:.5});continue;}
      const sprite=this.sprite(e.frame,e.size);sprite.position.set(p.x,p.y);sprite.zIndex=p.y;
      if(e.condition!=null)sprite.tint=Number(e.condition)<.4?0xa69a81:Number(e.condition)<.75?0xc9bea3:0xffffff;
      if(e.kind==='debris'){sprite.scale.y*=.6;sprite.rotation=(hashUnit(e.id)-.5)*.3;}
      if(isHotObject(e)){const effect=new PIXI.Graphics();effect.position.set(p.x,p.y);effect.zIndex=p.y+.2;this.citizenLayer.addChild(effect);this.structureLayer.push(effect);this.hotObjects.push({entry:e,effect});}
      if(e.kind==='project'){const bar=new PIXI.Graphics();bar.rect(-22,6,44,3).fill(0x2b3024).rect(-22,6,44*e.progress,3).fill(0xd8bd76);bar.position.set(p.x,p.y);bar.zIndex=p.y+.1;this.structureLayer.push(bar);this.citizenLayer.addChild(bar);}
      this.citizenLayer.addChild(sprite);
      (e.kind==='scenery'?this.vegetationLayer:e.kind==='resource'?this.resourceLayer:this.structureLayer).push(sprite);
    }
    this.staticKey=this.staticSignature(this.state);
  }
  livingSignature(state){return `${state?.livingWorld?.revision||0}|${state?.livingWorld?.trails?.length||0}|${state?.livingWorld?.stockpiles?.length||0}|${Number(state?.livingWorld?.river?.halfWidth||0).toFixed(2)}`;}
  rebuildLiving(){
    const PIXI=globalThis.PIXI,key=this.livingSignature(this.state);this.clearLayer(this.trailLayer);this.clearLayer(this.riverOverlayLayer);this.clearLayer(this.stockpileLayer);
    for(const trail of this.state?.livingWorld?.trails||[]){
      const t=terrainAtPublic(this.state,trail.x,trail.y),p=point(trail.x,trail.y,t.elevation),strength=clamp(Number(trail.strength)||0,0,1);
      const g=new PIXI.Graphics();g.ellipse(p.x,p.y,3.5+strength*4,1.2+strength*1.8).fill({color:0x806746,alpha:.08+strength*.3});this.trailLayer.addChild(g);
    }
    const river=new PIXI.Graphics(),hydro=this.state?.livingWorld?.river||{halfWidth:1,flow:1};let started=false;
    for(let y=0;y<=100;y+=1.5){const x=riverCenterXPublic(this.state,y),t=terrainAtPublic(this.state,x,y),p=point(x,y,t.elevation);if(!started){river.moveTo(p.x,p.y);started=true;}else river.lineTo(p.x,p.y);}
    river.stroke({width:Math.max(8,10+Number(hydro.halfWidth||1)*5),color:0x4f98aa,alpha:.22});this.riverOverlayLayer.addChild(river);
    for(const stock of this.state?.livingWorld?.stockpiles||[]){
      const t=terrainAtPublic(this.state,stock.position.x,stock.position.y),p=point(stock.position.x,stock.position.y,t.elevation),g=new PIXI.Graphics(),size=clamp(Math.sqrt(Math.max(1,Number(stock.massKg)||1)),3,10);
      g.rect(p.x-size,p.y-size*.55,size*2,size*.8).fill({color:0x8d7048,alpha:.72});g.rect(p.x-size*.65,p.y-size*.9,size*1.3,size*.55).fill({color:0xb08a55,alpha:.78});this.stockpileLayer.addChild(g);
    }
    this.livingKey=key;
  }
  animateRiver(minute){
    if(!this.riverFlowLayer)return;this.riverFlowLayer.clear();const flow=Math.max(.2,Number(this.state?.livingWorld?.river?.flow)||1);
    for(let i=0;i<14;i++){const y=(Number(minute)*flow*.08+i*7.7)%100,x=riverCenterXPublic(this.state,y),y2=Math.min(100,y+1.4),x2=riverCenterXPublic(this.state,y2),a=point(x,y,terrainAtPublic(this.state,x,y).elevation),b=point(x2,y2,terrainAtPublic(this.state,x2,y2).elevation);this.riverFlowLayer.moveTo(a.x,a.y).lineTo(b.x,b.y).stroke({width:1.1,color:0xd8eeeb,alpha:.28});}
  }
  ensureCitizens(){
    const PIXI=globalThis.PIXI,alive=new Set();
    for(const c of this.state.citizens||[]){
      if(!c.alive)continue;alive.add(c.id);if(this.citizenSprites.has(c.id))continue;
      let entry=this.spineAdapter?.create(c)||null;
      if(!entry){
        const visual=this.art.animatedCitizenSprite(c,0,CITIZEN_STAND_SIZE,CITIZEN_SLEEP_SIZE);
        const container=new PIXI.Container(),body=new PIXI.Sprite(this.citizenTextures.get(visual.atlas)[visual.frame]),shadow=new PIXI.Graphics();
        body.anchor.set(.5,CITIZEN_STAND_ANCHOR_Y);body.scale.set(visual.size/body.texture.width);
        shadow.ellipse(1,1,6,2.8).fill({color:0x1d281c,alpha:.22});
        container.addChild(shadow,body);
        entry={container,body,shadow,spine:false,visual};
      }
      const ownedRing=new PIXI.Graphics();ownedRing.ellipse(0,1,11,5).stroke({width:1.5,color:0x8fd7ff,alpha:.95});ownedRing.visible=false;
      const ownerMark=new PIXI.Text({text:'YOU',style:{fontFamily:'system-ui',fontSize:8,fontWeight:'700',fill:0xbfe8ff,stroke:{color:0x17251f,width:2}}});ownerMark.anchor.set(.5);ownerMark.position.set(0,-31);ownerMark.visible=false;
      entry.container.addChildAt(ownedRing,0);entry.container.addChild(ownerMark);entry.ownedRing=ownedRing;entry.ownerMark=ownerMark;
      entry.actionGraphics=new PIXI.Graphics();entry.container.addChild(entry.actionGraphics);
      this.citizenLayer.addChild(entry.container);this.citizenSprites.set(c.id,entry);
    }
    for(const [id,e] of this.citizenSprites)if(!alive.has(id)){e.container.destroy({children:true});this.citizenSprites.delete(id);}
  }
  screenPoint(x,y,elevation=0,camera){const p=point(x,y,elevation),origin=point(camera.x,camera.y);return{x:camera.width/2+(p.x-origin.x)*camera.zoom,y:camera.height/2+(p.y-origin.y)*camera.zoom};}
  ingestCanonicalEffects(events,camera){for(const e of events||[])if(e.type==='STRUCTURE_FRACTURED')this.transient?.ingest(e,(x,y)=>this.screenPoint(x,y,terrainAtPublic(this.state,x,y).elevation,camera));}
  render(state,camera,minute,{selected=null,follow=null,nowMs=performance.now()}={}){
    if(!this.ready||!this.app)return false;if(this.state!==state||!this.visualIndex)this.visualIndex=canonicalVisualIndex(state);this.state=state;
    if(this.staticKey!==this.staticSignature(state))this.rebuildStatic();if(this.livingKey!==this.livingSignature(state))this.rebuildLiving();this.animateRiver(minute);this.ensureCitizens();
    const origin=point(camera.x,camera.y);this.root.scale.set(camera.zoom);this.root.position.set(camera.width/2-origin.x*camera.zoom,camera.height/2-origin.y*camera.zoom);this.hits=[];
    const hits=[];
    for(const e of this.staticEntries){if(!e.id)continue;const t=terrainAtPublic(state,e.position.x,e.position.y),p=this.screenPoint(e.position.x,e.position.y,t.elevation,camera);hits.push({...this.art.hitRecord(e,p,camera.zoom),depth:point(e.position.x,e.position.y,t.elevation).y});}
    for(const c of state.citizens||[]){if(!c.alive)continue;const e=this.citizenSprites.get(c.id),pos=citizenPosition(c,state),t=terrainAtPublic(state,pos.x,pos.y),p=point(pos.x,pos.y,t.elevation),a=c.currentAction,moving=a?.type==='MOVE'&&minute<Number(a.endsWorldMinute),active=c.id===selected||c.id===follow;
      const offset=this.citizenOffsets?.get(c.id)||{x:0,y:0};p.x+=offset.x;p.y+=offset.y;
      const context=actionVisualContext(c,this.visualIndex),target=context.targetPosition;
      const targetPoint=target?point(target.x,target.y,terrainAtPublic(state,target.x,target.y).elevation):null;
      const vector=targetPoint?{x:targetPoint.x-p.x,y:targetPoint.y-p.y}:{x:12,y:0};
      const flip=targetPoint?vector.x<0:Boolean(moving&&a?.targetPosition&&a?.fromPosition&&a.targetPosition.x-a.targetPosition.y<a.fromPosition.x-a.fromPosition.y);
      e.container.position.set(p.x,p.y);e.container.zIndex=p.y;
      if(e.spine){
        this.spineAdapter?.update(e,c,{flip});
      }else{
        const visual=this.art.animatedCitizenSprite(c,nowMs,CITIZEN_STAND_SIZE,CITIZEN_SLEEP_SIZE),sleeping=visual.sleep,body=e.body;
        body.texture=this.citizenTextures.get(visual.atlas)[visual.frame];e.visual=visual;
        body.anchor.set(.5,visual.anchorY??(sleeping?CITIZEN_SLEEP_ANCHOR_Y:CITIZEN_STAND_ANCHOR_Y));
        const scale=visual.size/body.texture.width;
        if(sleeping){
          body.y=visual.atlas.startsWith('animated:')?0:CITIZEN_SLEEP_LIFT;body.rotation=0;
          body.scale.set((flip?-1:1)*scale,scale);
          if(e.shadow){e.shadow.position.set(0,2);e.shadow.scale.x=1.1;e.shadow.scale.y=.78;}
        }else{
          const pose=citizenVisualPose(c,nowMs);
          body.y=CITIZEN_STAND_LIFT+pose.y;body.rotation=pose.rotation;
          body.scale.set((flip?-1:1)*scale*pose.scaleX,scale*pose.scaleY);
          if(e.shadow)e.shadow.scale.set(pose.shadowScale,1);
        }
      }
      const owned=c.id===this.ownedCitizenId;if(e.ownedRing)e.ownedRing.visible=owned;if(e.ownerMark)e.ownerMark.visible=owned;
      if(e.task)e.task.text='';
      e.actionGraphics.visible=active||owned||camera.zoom>.7;
      e.actionGraphics.scale.x=flip?-1:1;
      let heatVector=null;
      if(context.heatPosition&&context.heat?.holderId!==c.id){const hp=context.heatPosition,hq=point(hp.x,hp.y,terrainAtPublic(state,hp.x,hp.y).elevation);heatVector={x:(hq.x-p.x)*(flip?-1:1),y:hq.y-p.y};}
      drawActionContextPixi(e.actionGraphics,actionContextShapes(context,nowMs,{x:vector.x*(flip?-1:1),y:vector.y},heatVector));
      const body=e.body,sp=this.screenPoint(pos.x,pos.y,t.elevation,camera);sp.x+=offset.x*camera.zoom;sp.y+=offset.y*camera.zoom;
      if(e.spine){
        hits.push({id:c.id,kind:'citizen',x:sp.x,y:sp.y-12*camera.zoom,r:15*camera.zoom,depth:p.y});
      }else{
        hits.push({...this.art.hitRecord({...e.visual,id:c.id,kind:'citizen',size:body.texture.width*Math.abs(body.scale.x)},
          {x:sp.x,y:sp.y+body.y*camera.zoom},camera.zoom,body.scale.x<0,
          {anchorY:body.anchor.y,scaleY:Math.abs(body.scale.y/body.scale.x),rotation:body.rotation}),depth:p.y});
      }
    }
    this.hits=hits.sort((a,b)=>a.depth-b.depth);
    this.waterLayer.alpha=.72+.24*Math.sin(minute*.13);
    if(this.waterLayer&&'tilePosition' in this.waterLayer&&this.waterLayer.tilePosition){
      this.waterLayer.tilePosition.x=minute*0.45;
      this.waterLayer.tilePosition.y=Math.sin(minute*.09)*1.5;
    }
    for(const {entry,effect} of this.hotObjects)drawActionContextPixi(effect,actionContextShapes({animation:{frameMs:210},heat:entry,target:entry},nowMs,{x:0,y:0}));
    this.ingestCanonicalEffects(state.recentLedger||state.ledgerEvents||[],camera);
    const debris=(this.transient?.update()||[]).slice(0,256);
    for(let i=0;i<debris.length;i++){
      const d=debris[i];let sprite=this.debrisSprites[i];
      if(!sprite){sprite=new globalThis.PIXI.Sprite(globalThis.PIXI.Texture.WHITE);sprite.anchor.set(.5);sprite.tint=materialColor({material:'stone'});this.effectsLayer.addChild(sprite);this.debrisSprites.push(sprite);}
      sprite.visible=true;sprite.alpha=d.alpha;sprite.width=d.size;sprite.height=d.size;sprite.position.set((d.x-camera.width/2)/camera.zoom+origin.x,(d.y-camera.height/2)/camera.zoom+origin.y);sprite.rotation=d.angle;
    }
    for(let i=debris.length;i<this.debrisSprites.length;i++)this.debrisSprites[i].visible=false;
    return true;
  }
}
