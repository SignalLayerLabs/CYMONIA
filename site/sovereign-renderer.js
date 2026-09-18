import {terrainAtPublic,terrainPalette,terrainDecoration,riverCenterXPublic,seedOfWorld} from './terrain-model.js';
import {PixiObserverLayer} from './pixi-observer.js';
import {MedievalArt,isoPoint,isoInverse,sceneEntries,staticSceneKey,citizenFrame,artHash,spriteBounds} from './medieval-art.js';

const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const ACTION_ICON={MOVE:'→',OBSERVE:'◉',REST:'·',SLEEP:'z',EAT:'•',DRINK:'≈',GATHER:'⌁',CARRY:'▣',CUT:'╱',DIG:'⌄',BUILD:'⌂',CARE:'+',TEACH:'◇',COMMUNICATE:'◇',EXPERIMENT:'✦',ATTACK:'⚠',DEFEND:'◈',TRANSFER:'↔',PROMISE:'∞',CLAIM:'⌁',REPRODUCE:'◌'};

export function worldMinute(state,nowMs=Date.now()){
  if(!state?.clock)return 0;
  const rawEpoch=state.clock.realEpochMs;
  const epoch=Number(rawEpoch);
  const canonical=Number(state.clock.worldMinute)||0;
  if(rawEpoch===null||rawEpoch===undefined||!Number.isFinite(epoch))return canonical;
  return Math.max(canonical,(Number(nowMs)-epoch)/1000);
}
export function citizenPosition(c,state,nowMs=Date.now()){
  const a=c?.currentAction;
  if(!a||a.type!=='MOVE'||!a.targetPosition||!a.fromPosition)return {...c.position};
  const now=worldMinute(state,nowMs),span=Math.max(.001,Number(a.endsWorldMinute)-Number(a.startedWorldMinute)),t=clamp((now-Number(a.startedWorldMinute))/span,0,1),path=Array.isArray(a.path)&&a.path.length>=2?a.path:[a.fromPosition,a.targetPosition];let total=0;const lengths=[];for(let i=0;i<path.length-1;i++){const d=Math.hypot(path[i+1].x-path[i].x,path[i+1].y-path[i].y);lengths.push(d);total+=d;}if(total<=0)return {...a.targetPosition};let remaining=t*total;for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]||i===lengths.length-1){const u=lengths[i]?clamp(remaining/lengths[i],0,1):1;return{x:lerp(Number(path[i].x),Number(path[i+1].x),u),y:lerp(Number(path[i].y),Number(path[i+1].y),u)};}remaining-=lengths[i];}return {...a.targetPosition};
}
function hashUnit(...parts){let h=2166136261>>>0;const s=parts.join('|');for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return(h>>>0)/4294967295;}
function relationStrength(r){return Math.max(Math.abs(Number(r?.trust||0)),Math.abs(Number(r?.affection||0)),Math.abs(Number(r?.fear||0)),Math.abs(Number(r?.obligation||0)),Math.abs(Number(r?.familiarity||0)));}
function dayLight(minute){const phase=((minute%1440)+1440)%1440/1440,sun=Math.sin((phase-.25)*TAU),night=clamp((-sun-.08)/.72,0,1),dawn=clamp(1-Math.abs(sun)*3.2,0,1)*(1-night);return{phase,sun,night,dawn};}

export class SovereignRenderer{
  constructor(canvas,mini){
    this.canvas=canvas;this.canvasFallback=canvas;this.gpuCanvas=null;this.art=new MedievalArt();this.gpu=new PixiObserverLayer(this.canvasFallback,this.art);this.artEntries=[];this.artKey='';this.mini=mini;this.state=null;this.selected=null;this.follow=null;this.ownedCitizen=null;this.overlay=null;this.hits=[];this.drag=null;this.lastFrame=performance.now?.()||0;
    this.camera={x:50,y:50,zoom:1.55,targetX:50,targetY:50,targetZoom:1.55,width:1000,height:700};
    this.terrainCache=null;this.terrainCacheKey='';this.wire();
  }
  setState(state){const oldId=this.state?.worldId;this.state=state;this.gpu?.setState(state);this.gpuCanvas=this.gpu?.app?.canvas||null;if(state?.worldId!==oldId){this.terrainCache=null;this.terrainCacheKey='';}}
  setSelected(id){this.selected=id;}
  setFollow(id){this.follow=id||null;}
  setOwnedCitizen(id){this.ownedCitizen=id||null;this.gpu?.setOwnedCitizen?.(this.ownedCitizen);}
  locateCitizen(id,{follow=false}={}){
    const c=this.state?.citizens?.find(x=>x.id===id);
    if(!c||!c.alive)return false;
    const pos=citizenPosition(c,this.state,Date.now());
    this.camera.targetX=clamp(pos.x,2,98);this.camera.targetY=clamp(pos.y,2,98);
    this.camera.targetZoom=Math.max(this.camera.targetZoom,1.8);
    this.follow=follow?id:null;
    return true;
  }
  center(){this.camera.targetX=50;this.camera.targetY=50;this.camera.targetZoom=1.55;this.follow=null;}
  fitPopulation(){
    const alive=(this.state?.citizens||[]).filter(c=>c.alive);
    if(!alive.length)return false;
    const positions=alive.map(c=>citizenPosition(c,this.state));
    const projected=positions.map(pos=>{const t=terrainAtPublic(this.state,pos.x,pos.y);return isoPoint(pos.x,pos.y,t.elevation);});
    const xs=positions.map(p=>p.x),ys=positions.map(p=>p.y),px=projected.map(p=>p.x),py=projected.map(p=>p.y);
    this.camera.targetX=clamp((Math.min(...xs)+Math.max(...xs))/2,2,98);
    this.camera.targetY=clamp((Math.min(...ys)+Math.max(...ys))/2,2,98);
    const spanX=Math.max(20,Math.max(...px)-Math.min(...px)),spanY=Math.max(20,Math.max(...py)-Math.min(...py));
    const usableW=Math.max(240,this.camera.width-220),usableH=Math.max(180,this.camera.height-200);
    this.camera.targetZoom=clamp(Math.min(usableW/spanX,usableH/spanY),.6,2.2);
    this.follow=null;return true;
  }
  populationVisibility(){
    const alive=(this.state?.citizens||[]).filter(c=>c.alive);let visible=0;
    const margin=28*Math.max(.7,this.camera.zoom);
    for(const c of alive){
      const pos=citizenPosition(c,this.state),t=terrainAtPublic(this.state,pos.x,pos.y),p=this.project(pos.x,pos.y,t.elevation);
      if(p.x>=-margin&&p.x<=this.camera.width+margin&&p.y>=-margin*2&&p.y<=this.camera.height+margin)visible++;
    }
    return {visible,total:alive.length};
  }
  panBy(dx,dy){this.follow=null;const delta=isoInverse(dx/this.camera.zoom,dy/this.camera.zoom);this.camera.targetX=clamp(this.camera.targetX-delta.x,2,98);this.camera.targetY=clamp(this.camera.targetY-delta.y,2,98);}
  zoomBy(factor){this.camera.targetZoom=clamp(this.camera.targetZoom*factor,.6,3.1);}
  toggleOverlay(name){this.overlay=this.overlay===name?null:name;}
  wire(){
    const c=this.canvas;
    c.addEventListener('wheel',e=>{e.preventDefault();this.zoomBy(e.deltaY>0?.9:1.11);},{passive:false});
    c.addEventListener('pointerdown',e=>{this.drag={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};c.setPointerCapture?.(e.pointerId);});
    c.addEventListener('pointermove',e=>{if(!this.drag)return;const dx=e.clientX-this.drag.lastX,dy=e.clientY-this.drag.lastY;if(Math.hypot(e.clientX-this.drag.x,e.clientY-this.drag.y)>4)this.drag.moved=true;if(this.drag.moved)this.panBy(dx,dy);this.drag.lastX=e.clientX;this.drag.lastY=e.clientY;});
    c.addEventListener('pointerup',e=>{if(this.drag&&!this.drag.moved){const r=c.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;const hit=[...this.hits].reverse().find(h=>this.art.hitTest(h,x,y));if(hit)c.dispatchEvent(new CustomEvent('worldselect',{detail:{id:hit.id,kind:hit.kind}}));}this.drag=null;});
    c.addEventListener('pointercancel',()=>this.drag=null);
  }
  resize(ctx){const r=this.canvas.getBoundingClientRect(),d=Math.min(globalThis.devicePixelRatio||1,2);const w=Math.max(1,Math.round(r.width*d)),h=Math.max(1,Math.round(r.height*d));if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}ctx.setTransform(d,0,0,d,0,0);this.camera.width=r.width;this.camera.height=r.height;return r;}
  project(x,y,elevation=0){const c=this.camera,p=isoPoint(x,y,elevation),origin=isoPoint(c.x,c.y);return{x:c.width/2+(p.x-origin.x)*c.zoom,y:c.height/2+(p.y-origin.y)*c.zoom};}
  unproject(px,py){const c=this.camera,origin=isoPoint(c.x,c.y);return isoInverse((px-c.width/2)/c.zoom+origin.x,(py-c.height/2)/c.zoom+origin.y);}
  easeCamera(now){const dt=Math.min(.05,Math.max(.001,(now-this.lastFrame)/1000));this.lastFrame=now;const k=1-Math.pow(.001,dt);if(this.follow&&this.state){const c=this.state.citizens?.find(x=>x.id===this.follow&&x.alive);if(c){const p=citizenPosition(c,this.state,Date.now());this.camera.targetX=p.x;this.camera.targetY=p.y;}}this.camera.x=lerp(this.camera.x,this.camera.targetX,k);this.camera.y=lerp(this.camera.y,this.camera.targetY,k);this.camera.zoom=lerp(this.camera.zoom,this.camera.targetZoom,k);}
  draw(){if(!this.state)return;const nowPerf=performance.now?.()||Date.now();this.easeCamera(nowPerf);const ctx=this.canvas.getContext('2d'),r=this.resize(ctx),minute=worldMinute(this.state),light=dayLight(minute);ctx.clearRect(0,0,r.width,r.height);const gpuActive=this.gpu?.render(this.state,this.camera,minute,{selected:this.selected,follow:this.follow,overlay:this.overlay});this.gpuCanvas=this.gpu?.app?.canvas||null;if(gpuActive){if(this.overlay==='knowledge')this.drawKnowledgeOverlay(ctx);this.hits=[...(this.gpu.hits||[])];if(this.overlay==='relations')this.drawRelations(ctx,minute);this.drawGpuSelectionOverlay(ctx,minute);this.drawAtmosphere(ctx,r,light,minute);}else{this.drawSky(ctx,r,light);this.drawTerrain(ctx,r,light,minute);this.drawWorldObjects(ctx,r,light,minute);this.drawAtmosphere(ctx,r,light,minute);}this.drawMini(minute);}
  drawSky(ctx,r,light){const g=ctx.createLinearGradient(0,0,0,r.height);if(light.night>.55){g.addColorStop(0,'#101a22');g.addColorStop(1,'#07110d');}else{g.addColorStop(0,light.dawn>.35?'#745b43':'#35584a');g.addColorStop(1,'#17281f');}ctx.fillStyle=g;ctx.fillRect(0,0,r.width,r.height);}
  terrainCacheFor(light){const key=`${this.state.worldId}|${Math.round(this.camera.zoom*8)}`;if(this.terrainCache&&this.terrainCacheKey===key)return this.terrainCache;const canvas=document.createElement('canvas');canvas.width=1100;canvas.height=820;const ctx=canvas.getContext('2d');const fake={...this.camera,width:1100,height:820,x:50,y:50};const old=this.camera;this.camera=fake;for(let y=0;y<100;y+=2)for(let x=0;x<100;x+=2){const t=terrainAtPublic(this.state,x+1,y+1),p=this.project(x,y,t.elevation),p2=this.project(x+2,y+2,t.elevation);const w=Math.abs(p2.x-p.x)+2,h=Math.abs(p2.y-p.y)+2;ctx.fillStyle=terrainPalette(t.kind,0);ctx.fillRect(p.x-1,p.y-1,w,h);}this.camera=old;this.terrainCache=canvas;this.terrainCacheKey=key;return canvas;}
  drawTerrain(ctx,r,light,minute){
    const ground=this.art.groundFor(this.state),origin=this.project(0,0),z=this.camera.zoom;
    ctx.fillStyle='#68784d';ctx.fillRect(0,0,r.width,r.height);
    ctx.drawImage(ground,origin.x-1600*z,origin.y,3200*z,1600*z);
  }
  drawRiverHighlight(ctx,minY,maxY,light,minute){ctx.save();ctx.beginPath();for(let y=minY;y<=maxY;y+=1){const x=riverCenterXPublic(this.state,y),p=this.project(x,y,terrainAtPublic(this.state,x,y).elevation);if(y===minY)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}ctx.strokeStyle=`rgba(98,163,177,${.36*(1-light.night)+.2})`;ctx.lineWidth=Math.max(2,8*this.camera.zoom);ctx.stroke();ctx.strokeStyle=`rgba(207,230,211,${.12+.05*Math.sin(minute*.2)})`;ctx.lineWidth=Math.max(1,1.4*this.camera.zoom);ctx.stroke();ctx.restore();}
  drawGroundVegetation(ctx,x,y,t,light){const d=terrainDecoration(this.state,x,y);if(d.density<.42)return;const p=this.project(x+(d.density-.5)*1.1,y+(hashUnit(x,y,8)-.5)*1.1,t.elevation),s=(2.8+hashUnit(x,y,9)*3.5)*this.camera.zoom;ctx.save();ctx.fillStyle=`rgba(13,25,14,${.34+.2*light.night})`;ctx.beginPath();ctx.ellipse(p.x+2,p.y+3,s*1.25,s*.55,0,0,TAU);ctx.fill();ctx.strokeStyle='#5b4d34';ctx.lineWidth=Math.max(.5,.9*this.camera.zoom);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x,p.y-s*1.8);ctx.stroke();ctx.fillStyle=light.night>.5?'#24412d':'#315d39';for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(p.x+(i-1)*s*.35,p.y-s*(1.7+i*.18),s*(.7-i*.07),0,TAU);ctx.fill();}ctx.restore();}
  drawGroundRock(ctx,x,y,light,d){const t=terrainAtPublic(this.state,x,y),p=this.project(x,y,t.elevation),s=(2.2+d*2.2)*this.camera.zoom;ctx.fillStyle=light.night>.5?'#565b57':'#8c8a76';ctx.beginPath();ctx.moveTo(p.x-s,p.y+s*.3);ctx.lineTo(p.x-s*.25,p.y-s);ctx.lineTo(p.x+s,p.y);ctx.lineTo(p.x+s*.35,p.y+s*.65);ctx.closePath();ctx.fill();}
  drawReed(ctx,x,y,light,d){const t=terrainAtPublic(this.state,x,y),p=this.project(x,y,t.elevation);ctx.strokeStyle=light.night>.5?'#52604a':'#829260';ctx.lineWidth=.8;for(let i=0;i<4;i++){const dx=(i-1.5)*1.5;ctx.beginPath();ctx.moveTo(p.x+dx,p.y+2);ctx.lineTo(p.x+dx+(i%2?1:-1),p.y-(4+d*5)*this.camera.zoom);ctx.stroke();}}
  drawCampCircle(ctx,light){const p=this.project(50,50,terrainAtPublic(this.state,50,50).elevation);ctx.strokeStyle=`rgba(222,190,111,${.24*(1-light.night)+.16})`;ctx.setLineDash([5,7]);ctx.beginPath();ctx.ellipse(p.x,p.y,70*this.camera.zoom,50*this.camera.zoom,0,0,TAU);ctx.stroke();ctx.setLineDash([]);}
  drawWorldObjects(ctx,r,light,minute){
    if(this.overlay==='relations')this.drawRelations(ctx,minute);
    const key=staticSceneKey(this.state);if(key!==this.artKey){this.artEntries=sceneEntries(this.state);this.artKey=key;}
    const entries=[...this.artEntries];
    for(const c of this.state.citizens||[])if(c.alive)entries.push({kind:'citizen',id:c.id,position:citizenPosition(c,this.state),data:c,frame:citizenFrame(c),size:19});
    entries.sort((a,b)=>(a.position.x+a.position.y)-(b.position.x+b.position.y));this.hits=[];
    for(const e of entries){
      const t=terrainAtPublic(this.state,e.position.x,e.position.y),p=this.project(e.position.x,e.position.y,t.elevation),z=this.camera.zoom;
      const f=this.art.frames[e.frame],bounds=f?spriteBounds(f,e.size*z,p.x,p.y):{x:p.x-50*z,y:p.y-100*z,width:100*z,height:120*z};if(bounds.x+bounds.width<0||bounds.x>r.width||bounds.y+bounds.height<0||bounds.y>r.height)continue;
      const active=e.id&&(e.id===this.selected||e.id===this.follow);
      if(active){ctx.strokeStyle='#f8df91';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(p.x,p.y,e.size*.58*z,Math.min(15,e.size*.2)*z,0,0,TAU);ctx.stroke();}
      const action=e.data?.currentAction,moving=action?.type==='MOVE'&&minute<Number(action.endsWorldMinute),bob=moving?Math.sin(performance.now()/125+artHash(e.id)*TAU)*z:0;
      if(e.frame===-1){ctx.strokeStyle='rgba(191,233,219,.6)';ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(p.x,p.y,15*z,7*z,0,0,TAU);ctx.stroke();}
      else if(!this.art.drawSprite(ctx,e.frame,p.x,p.y+bob,e.size*z,moving&&action.targetPosition.x-action.targetPosition.y<action.fromPosition.x-action.fromPosition.y)){
        if(e.kind==='citizen')this.drawCitizen(ctx,e,p,light,minute);
        else if(e.kind!=='scenery'){ctx.fillStyle='#c4a66a';ctx.fillRect(p.x-4*z,p.y-8*z,8*z,8*z);}
      }
      if(e.kind==='project'){ctx.fillStyle='#2b3024';ctx.fillRect(p.x-22*z,p.y+7*z,44*z,3*z);ctx.fillStyle='#d8bd76';ctx.fillRect(p.x-22*z,p.y+7*z,44*z*e.progress,3*z);}
      if(e.kind==='citizen'&&action&&(active||z>2)){ctx.font='11px Georgia';ctx.textAlign='center';ctx.fillStyle='#f7e5b8';ctx.fillText(ACTION_ICON[action.type]||'·',p.x,p.y-40*z);}
      if(e.kind==='citizen'&&this.overlay==='knowledge')this.drawKnowledgeHalo(ctx,e.data,p,light);
      if(e.id)this.hits.push(this.art.hitRecord(e,{x:p.x,y:p.y+bob},z,moving&&action.targetPosition.x-action.targetPosition.y<action.fromPosition.x-action.fromPosition.y));
    }
  }
  drawKnowledgeHalo(ctx,c,p){const z=this.camera.zoom,count=Array.isArray(c.knowledge)?c.knowledge.length:Number(c.knowledge?.count||0);ctx.save();ctx.font=`${Math.max(8,Math.round(8*z))}px system-ui`;ctx.textAlign='center';ctx.fillStyle='rgba(20,35,25,.85)';ctx.fillRect(p.x-14*z,p.y-46*z,28*z,12*z);ctx.fillStyle='#d9edcd';ctx.fillText(`K ${count}`,p.x,p.y-37*z);ctx.restore();}
  drawKnowledgeOverlay(ctx){for(const c of this.state.citizens||[])if(c.alive){const p=citizenPosition(c,this.state),t=terrainAtPublic(this.state,p.x,p.y);this.drawKnowledgeHalo(ctx,c,this.project(p.x,p.y,t.elevation));}}
  drawGpuSelectionOverlay(ctx,minute){if(!this.selected)return;const c=this.state.citizens?.find(x=>x.id===this.selected&&x.alive);if(c){const pos=citizenPosition(c,this.state),t=terrainAtPublic(this.state,pos.x,pos.y),p=this.project(pos.x,pos.y,t.elevation);ctx.save();ctx.strokeStyle='#ffe39b';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(p.x,p.y+3,12*Math.max(.7,this.camera.zoom),6*Math.max(.7,this.camera.zoom),0,0,TAU);ctx.stroke();ctx.restore();return;}const b=this.state.buildings?.find(x=>x.id===this.selected),pr=this.state.projects?.find(x=>x.id===this.selected),d=this.state.resourceDeposits?.find(x=>x.id===this.selected);const e=b?.position||pr?.site||d?.position;if(!e)return;const t=terrainAtPublic(this.state,e.x,e.y),p=this.project(e.x,e.y,t.elevation);ctx.save();ctx.strokeStyle='#ffe39b';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,16*Math.max(.7,this.camera.zoom),0,TAU);ctx.stroke();ctx.restore();}
  drawShadow(ctx,p,rx,ry,alpha=.32){ctx.fillStyle=`rgba(0,0,0,${alpha})`;ctx.beginPath();ctx.ellipse(p.x+2,p.y+3,rx,ry,0,0,TAU);ctx.fill();}
  drawResource(ctx,e,p,light,minute){const d=e.data,s=clamp(this.camera.zoom,.7,2.1);this.drawShadow(ctx,p,9*s,4*s,.23);ctx.save();ctx.translate(p.x,p.y);if(d.type==='water'){ctx.fillStyle='#4f98aa';ctx.beginPath();ctx.ellipse(0,1,10*s,5*s,0,0,TAU);ctx.fill();ctx.strokeStyle=`rgba(205,234,231,${.32+.15*Math.sin(minute*.17)})`;ctx.stroke();}else if(d.type==='timber'){for(let i=0;i<4;i++){ctx.fillStyle=i%2?'#335c34':'#466c3e';ctx.beginPath();ctx.arc((i-1.5)*4*s,-5*s-(i%2)*3*s,5*s,0,TAU);ctx.fill();ctx.strokeStyle='#5f4b2f';ctx.beginPath();ctx.moveTo((i-1.5)*4*s,0);ctx.lineTo((i-1.5)*4*s,-5*s);ctx.stroke();}}else if(d.type==='food'){ctx.fillStyle='#5f7f38';for(let i=0;i<5;i++){ctx.beginPath();ctx.arc((i-2)*3*s,-2*s-Math.abs(i-2)*s,3*s,0,TAU);ctx.fill();}ctx.fillStyle='#b34f47';for(let i=0;i<6;i++){ctx.beginPath();ctx.arc((i%3-1)*4*s,-5*s-Math.floor(i/3)*3*s,1.1*s,0,TAU);ctx.fill();}}else{const color=d.type==='stone'?'#8f8d7c':d.type==='ore'?'#6b7278':'#8b6b4f';ctx.fillStyle=color;for(let i=0;i<4;i++){ctx.beginPath();ctx.moveTo((i-2)*4*s,1*s);ctx.lineTo((i-1.5)*4*s,-5*s-(i%2)*2*s);ctx.lineTo((i-.7)*4*s,0);ctx.closePath();ctx.fill();}}if(this.camera.zoom>1.25){ctx.font=`${Math.round(8*s)}px Georgia`;ctx.textAlign='center';ctx.fillStyle='#f1e7be';ctx.strokeStyle='#1b241b';ctx.lineWidth=2;ctx.strokeText(String(d.type).toUpperCase(),0,14*s);ctx.fillText(String(d.type).toUpperCase(),0,14*s);}ctx.restore();this.hits.push({id:e.id,kind:'resource',x:p.x,y:p.y,r:14*s});}
  drawShelter(ctx,e,p,light){const s=clamp(this.camera.zoom,.7,2.1);this.drawShadow(ctx,p,12*s,5*s,.3);ctx.save();ctx.translate(p.x,p.y);ctx.fillStyle=light.night>.55?'#7a6848':'#b09562';ctx.strokeStyle='#d2bd82';ctx.lineWidth=Math.max(1,s);ctx.beginPath();ctx.moveTo(-11*s,2*s);ctx.lineTo(0,-12*s);ctx.lineTo(11*s,2*s);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle='#4b3525';ctx.beginPath();ctx.moveTo(-2*s,2*s);ctx.lineTo(0,-5*s);ctx.lineTo(3*s,2*s);ctx.closePath();ctx.fill();ctx.restore();this.hits.push({id:e.id,kind:'shelter',x:p.x,y:p.y-4*s,r:15*s});}
  drawProject(ctx,e,p,light){const pr=e.data,s=clamp(this.camera.zoom,.7,2.2),progress=pr.workRequiredMinutes?clamp(pr.workDoneMinutes/pr.workRequiredMinutes,0,1):.2;this.drawShadow(ctx,p,15*s,6*s,.28);ctx.save();ctx.translate(p.x,p.y);ctx.strokeStyle='#c7a768';ctx.lineWidth=2*s;for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(i*9*s,4*s);ctx.lineTo(i*9*s,-(6+14*progress)*s);ctx.stroke();}ctx.beginPath();ctx.moveTo(-12*s,-8*s);ctx.lineTo(12*s,-8*s);ctx.stroke();ctx.fillStyle='#9c8257';ctx.fillRect(-10*s,0,20*s,4*s);ctx.restore();this.hits.push({id:e.id,kind:'project',x:p.x,y:p.y-8*s,r:18*s});}
  drawBuilding(ctx,e,p,light){const b=e.data,s=clamp(this.camera.zoom,.72,2.2),active=this.selected===b.id;this.drawShadow(ctx,p,20*s,8*s,.34);ctx.save();ctx.translate(p.x,p.y);ctx.fillStyle=light.night>.55?'#706c5b':'#9a9578';ctx.strokeStyle=active?'#ffe4a2':'#d3c59e';ctx.lineWidth=active?2.4:1.2;ctx.fillRect(-15*s,-20*s,30*s,21*s);ctx.strokeRect(-15*s,-20*s,30*s,21*s);ctx.fillStyle='#6d5136';ctx.beginPath();ctx.moveTo(-19*s,-20*s);ctx.lineTo(0,-34*s);ctx.lineTo(19*s,-20*s);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle='#3b2b20';ctx.fillRect(-3*s,-8*s,6*s,9*s);ctx.restore();this.hits.push({id:e.id,kind:'building',x:p.x,y:p.y-12*s,r:22*s});}
  drawCitizen(ctx,e,p,light,minute){const c=e.data,a=c.currentAction,s=clamp(this.camera.zoom,.68,2.3),owned=c.id===this.ownedCitizen,active=this.selected===c.id||this.follow===c.id,moving=a?.type==='MOVE'&&worldMinute(this.state)<Number(a.endsWorldMinute),phase=(performance.now?.()||Date.now())/125+hashUnit(c.id)*TAU,step=moving?Math.sin(phase):0;let facing=0;if(moving&&a?.targetPosition&&a?.fromPosition)facing=Math.atan2(a.targetPosition.y-a.fromPosition.y,a.targetPosition.x-a.fromPosition.x);this.drawShadow(ctx,{x:p.x,y:p.y+2*s},6*s,2.8*s,.32);ctx.save();ctx.translate(p.x,p.y+step*1.2*s);if(active){ctx.strokeStyle='#ffe39b';ctx.lineWidth=1.5*s;ctx.beginPath();ctx.ellipse(0,3*s,10*s,5*s,0,0,TAU);ctx.stroke();}if(owned){ctx.strokeStyle='#8fd7ff';ctx.lineWidth=1.8*s;ctx.beginPath();ctx.ellipse(0,3*s,13*s,6.5*s,0,0,TAU);ctx.stroke();ctx.font=`bold ${Math.max(8,Math.round(8*s))}px system-ui`;ctx.textAlign='center';ctx.fillStyle='#bfe8ff';ctx.strokeStyle='#17251f';ctx.lineWidth=2;ctx.strokeText('YOU',0,-27*s);ctx.fillText('YOU',0,-27*s);}ctx.rotate(facing*.08);const human=c.kind==='HUMAN_LINKED';ctx.strokeStyle=human?'#9fd4ff':'#d2c9a5';ctx.lineWidth=1*s;ctx.fillStyle=human?'#315b76':'#4f7258';ctx.beginPath();ctx.roundRect?.(-4*s,-11*s,8*s,10*s,2*s);if(ctx.roundRect)ctx.fill();else ctx.fillRect(-4*s,-11*s,8*s,10*s);ctx.fillStyle='#d7bd95';ctx.beginPath();ctx.arc(0,-14*s,3.4*s,0,TAU);ctx.fill();if(moving){ctx.strokeStyle='#342b22';ctx.lineWidth=1.3*s;ctx.beginPath();ctx.moveTo(-1*s,-1*s);ctx.lineTo((-2-step*2)*s,4*s);ctx.moveTo(1*s,-1*s);ctx.lineTo((2+step*2)*s,4*s);ctx.stroke();}this.drawCitizenAction(ctx,a,phase,s);if(a&&this.camera.zoom>.82){ctx.font=`bold ${Math.round(8*s)}px system-ui`;ctx.textAlign='center';ctx.fillStyle='#f4e1a2';ctx.strokeStyle='#203024';ctx.lineWidth=2;const icon=ACTION_ICON[a.type]||'·';ctx.strokeText(icon,0,-23*s);ctx.fillText(icon,0,-23*s);}ctx.restore();this.hits.push({id:c.id,kind:'citizen',x:p.x,y:p.y-8*s,r:12*s});if(this.overlay==='knowledge'){const count=Array.isArray(c.knowledge)?c.knowledge.length:Number(c.knowledge?.count||0);ctx.fillStyle='rgba(14,25,18,.88)';ctx.fillRect(p.x-15*s,p.y-33*s,30*s,10*s);ctx.fillStyle='#b7dcc3';ctx.font=`${Math.max(7,Math.round(7*s))}px system-ui`;ctx.textAlign='center';ctx.fillText(`K ${count}`,p.x,p.y-25*s);}}
  drawCitizenAction(ctx,a,phase,s){if(!a)return;const w=Math.sin(phase);if(['CUT','DIG','BUILD','GATHER'].includes(a.type)){ctx.strokeStyle='#dec27c';ctx.lineWidth=1.4*s;ctx.beginPath();ctx.moveTo(3*s,-7*s);ctx.lineTo((8+w*3)*s,(-12-w*3)*s);ctx.stroke();}else if(a.type==='CARRY'){ctx.fillStyle='#9a754a';ctx.fillRect(-8*s,-10*s,4*s,6*s);}else if(a.type==='COMMUNICATE'||a.type==='TEACH'){ctx.strokeStyle='#b8e0c4';ctx.beginPath();ctx.arc(7*s,-17*s,(3+Math.abs(w)*2)*s,Math.PI*.7,Math.PI*1.7);ctx.stroke();}else if(a.type==='SLEEP'){ctx.fillStyle='#b9d3df';ctx.font=`${Math.round(9*s)}px Georgia`;ctx.fillText('z',6*s,-17*s);}else if(a.type==='EXPERIMENT'){ctx.fillStyle='#eadb82';ctx.globalAlpha=.5+.4*Math.abs(w);ctx.beginPath();ctx.arc(8*s,-15*s,2.4*s,0,TAU);ctx.fill();ctx.globalAlpha=1;}else if(['ATTACK','DEFEND'].includes(a.type)){ctx.strokeStyle='#e99578';ctx.lineWidth=1.5*s;ctx.beginPath();ctx.moveTo(4*s,-7*s);ctx.lineTo(10*s,(-10-w*3)*s);ctx.stroke();}}
  drawRelations(ctx,minute){const by=new Map((this.state.citizens||[]).filter(c=>c.alive).map(c=>[c.id,c])),seen=new Set();ctx.save();for(const a of by.values())for(const [id,rel] of Object.entries(a.relationships||{})){const b=by.get(id);if(!b)continue;const key=[a.id,b.id].sort().join('|');if(seen.has(key))continue;seen.add(key);const strength=Math.max(relationStrength(rel),relationStrength(b.relationships?.[a.id]));if(strength<.12)continue;const ap=citizenPosition(a,this.state),bp=citizenPosition(b,this.state),ta=terrainAtPublic(this.state,ap.x,ap.y),tb=terrainAtPublic(this.state,bp.x,bp.y),pa=this.project(ap.x,ap.y,ta.elevation),pb=this.project(bp.x,bp.y,tb.elevation);ctx.strokeStyle=this.selected===a.id||this.selected===b.id?'rgba(255,225,153,.78)':`rgba(146,211,172,${.12+strength*.34})`;ctx.lineWidth=.5+strength*1.4;ctx.beginPath();ctx.moveTo(pa.x,pa.y-8);ctx.lineTo(pb.x,pb.y-8);ctx.stroke();}ctx.restore();}
  drawAtmosphere(ctx,r,light,minute){const rain=Number(this.state.environment?.precipitation||0);if(rain>.06){ctx.save();ctx.strokeStyle=`rgba(202,222,218,${.12+rain*.34})`;ctx.lineWidth=1;const count=Math.min(150,Math.floor(35+rain*180));for(let i=0;i<count;i++){const x=(hashUnit(i,Math.floor(minute/2),1)*r.width+minute*7)%r.width,y=(hashUnit(i,11,2)*r.height+minute*15+i*13)%r.height;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-4,y+10);ctx.stroke();}ctx.restore();}if(light.night>.05){ctx.fillStyle=`rgba(4,11,18,${light.night*.16})`;ctx.fillRect(0,0,r.width,r.height);}if(light.dawn>.08){ctx.fillStyle=`rgba(225,145,84,${light.dawn*.08})`;ctx.fillRect(0,0,r.width,r.height);}const vignette=ctx.createRadialGradient(r.width/2,r.height/2,Math.min(r.width,r.height)*.28,r.width/2,r.height/2,Math.max(r.width,r.height)*.68);vignette.addColorStop(0,'rgba(0,0,0,0)');vignette.addColorStop(1,'rgba(3,8,6,.16)');ctx.fillStyle=vignette;ctx.fillRect(0,0,r.width,r.height);}
  drawMini(minute){if(!this.mini||!this.state)return;const ctx=this.mini.getContext('2d'),w=this.mini.width,h=this.mini.height;ctx.clearRect(0,0,w,h);for(let y=0;y<100;y+=4)for(let x=0;x<100;x+=4){const t=terrainAtPublic(this.state,x+2,y+2);ctx.fillStyle=terrainPalette(t.kind,.12);ctx.fillRect(x/100*w,y/100*h,4/100*w+1,4/100*h+1);}for(const b of this.state.buildings||[])if(b.massKg>0&&b.condition>0){ctx.fillStyle='#e3ca8b';ctx.fillRect(b.position.x/100*w-1,b.position.y/100*h-1,3,3);}for(const p of this.state.projects||[])if(p.status==='construction'){ctx.fillStyle='#c78c56';ctx.fillRect(p.site.x/100*w-1,p.site.y/100*h-1,3,3);}for(const c of this.state.citizens||[])if(c.alive){const p=citizenPosition(c,this.state);ctx.fillStyle=c.id===this.ownedCitizen?'#ffffff':c.id===this.selected?'#ffe09a':c.kind==='HUMAN_LINKED'?'#8fcfff':'#d7e5bd';const size=c.id===this.ownedCitizen?3:2;ctx.fillRect(p.x/100*w-size/2,p.y/100*h-size/2,size,size);}ctx.strokeStyle='#f3dda0';ctx.lineWidth=1;ctx.beginPath();for(const [i,xy] of [[0,[0,0]],[1,[this.camera.width,0]],[2,[this.camera.width,this.camera.height]],[3,[0,this.camera.height]]]){const p=this.unproject(...xy);if(i===0)ctx.moveTo(p.x/100*w,p.y/100*h);else ctx.lineTo(p.x/100*w,p.y/100*h);}ctx.closePath();ctx.stroke();}
}
