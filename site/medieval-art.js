import {terrainAtPublic, riverCenterXPublic, seedOfWorld} from './terrain-model.js';
import {animationForCitizen,CITIZEN_SPRITE_STATES,citizenAnimationFrame} from './citizen-animation.js';
import {CITIZEN_SPRITE_ATLASES} from './citizen-sprite-frames.js';
import {ANIMATION_ATLAS} from './citizen-animation-atlas.js';

// Shared by WebGL and Canvas: all art uses the same ground plane and anchors.
export const ISO_X=16, ISO_Y=8;
export const isoPoint=(x,y,elevation=0)=>({x:(x-y)*ISO_X,y:(x+y)*ISO_Y-elevation*2.8});
export const isoInverse=(x,y)=>({x:(x/ISO_X+y/ISO_Y)/2,y:(y/ISO_Y-x/ISO_X)/2});
export function spriteBounds(frame,size,x,y){const height=size*frame.h/frame.w;return{x:x-size/2,y:y-height*.94,width:size,height};}
export const ATLAS_URL=new URL('./assets/medieval-atlas.png',import.meta.url).href;
export const SLEEP_ATLAS_URL=new URL('./assets/medieval-sleep-atlas.png',import.meta.url).href;
export const CITIZEN_ATLAS_URLS=['blue','rust','green','linked'].map(name=>new URL(`./assets/citizen-${name}-states.png`,import.meta.url).href);
export const ANIMATED_CITIZEN_ATLAS_URLS=['blue','rust','green','linked'].map(name=>new URL(`./assets/citizen-${name}-animated.png`,import.meta.url).href);
const GRASS_URL=new URL('./assets/meadow-texture.png',import.meta.url).href;
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function artHash(value){let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0)/4294967296;}
export const citizenFrame=c=>c.kind==='HUMAN_LINKED'?15:12+Math.floor(artHash(c.id)*3);
const SLEEP_FRAME_VARIANTS=[0,1,2];
export const citizenSleepFrame=c=>c.kind==='HUMAN_LINKED'?3:SLEEP_FRAME_VARIANTS[Math.min(2,Math.floor(artHash(c.id)*3))];
export function citizenSprite(c){
  const state=animationForCitizen(c);
  if(state==='sleep')return {atlas:'sleep',frame:citizenSleepFrame(c),sleep:true};
  return {atlas:`citizen:${citizenFrame(c)-12}`,frame:Math.max(0,CITIZEN_SPRITE_STATES.indexOf(state)),sleep:false};
}

export function staticSceneKey(w){
  return JSON.stringify([w?.worldId,w?.seed,(w?.resourceDeposits||[]).map(d=>[d.id,d.quantity>0,d.position,d.type]),(w?.objects||[]).map(o=>[o.id,o.quantity,o.condition,o.position,o.holderId,o.kind,o.material,o.temperatureC??o.temperature,o.burning]),(w?.projects||[]).map(p=>[p.id,p.status,p.site,p.workDoneMinutes,p.workRequiredMinutes]),(w?.buildings||[]).map(b=>[b.id,b.position,b.condition,b.massKg,b.designId])]);
}
export function sceneEntries(w,{decorations=true}={}){
  const entries=[],seed=seedOfWorld(w);
  const add=(kind,id,position,frame,size,extra={})=>{if(position)entries.push({kind,id,position,frame,size,...extra});};
  if(decorations){
    // Seeded scenery is a visual expression of terrain, never a new resource.
    for(let y=2;y<99;y+=2.4)for(let x=2;x<99;x+=2.4){
      const n=artHash(`${seed}|${x.toFixed(1)}|${y.toFixed(1)}`),px=x+(n-.5)*1.8,py=y+(artHash(`${n}y`)-.5)*1.8,t=terrainAtPublic(w,px,py);
      const camp=Math.hypot(px-50,py-50)<14;
      const nearStructure=[...(w.buildings||[]).filter(b=>b.massKg>0&&b.condition>0),...(w.objects||[]).filter(o=>o.kind==='temporary_shelter'&&o.quantity>0)].some(b=>b.position&&Math.hypot(b.position.x-px,b.position.y-py)<2);
      if(nearStructure)continue;
      if((t.kind==='forest'&&n>.17)||(t.kind==='meadow'&&!camp&&n>.84))add('scenery',null,{x:px,y:py},n>.76?2:n>.47?1:0,53+n*38);
      else if(t.kind==='rocky'&&n>.66)add('scenery',null,{x:px,y:py},3,28+n*28);
      else if(t.kind==='wetland'&&n>.76)add('scenery',null,{x:px,y:py},11,22+n*14);
    }
  }
  for(const d of w.resourceDeposits||[])if(d.quantity>0){const frames={timber:0,food:8,stone:3,ore:10,clay:11,water:-1};add('resource',d.id,d.position,frames[d.type]??3,d.type==='timber'?85:d.type==='water'?30:52);}
  for(const o of w.objects||[])if(o.quantity>0&&!o.holderId){
    if(o.kind==='temporary_shelter'&&o.condition!==0)add('shelter',o.id,o.position,4,54,{condition:o.condition});
    else if(o.kind!=='temporary_shelter'){
      const debris=/debris|fragment|salvage/.test(o.kind||''),frames={timber:9,wood:9,stone:3,ore:10,clay:11,food:8,water:-1};
      const mass=Math.max(.01,Number(o.massKg)||Number(o.massPerUnitKg)*Number(o.quantity)||1);
      add(debris?'debris':'object',o.id,o.position,frames[o.material]??3,clamp(7+Math.sqrt(mass)*3,8,debris?23:35),{condition:o.condition??1,material:o.material,temperatureC:o.temperatureC??o.temperature,burning:Boolean(o.burning)});
    }
  }
  for(const p of w.projects||[])if(p.status==='construction'){const progress=clamp(p.workDoneMinutes/Math.max(1,p.workRequiredMinutes),0,1),phase=p.phase||(progress<.08?'site':progress<.25?'foundation':progress<.55?'frame':progress<.8?'roof':'enclosed'),size=phase==='site'?42:phase==='foundation'?55:phase==='frame'?70:phase==='roof'?82:90;add('project',p.id,p.site,7,size,{progress,phase});}
  for(const b of w.buildings||[])if(b.massKg>0&&b.condition>0)add('building',b.id,b.position,/hall|communal|large/i.test(b.designId||'')?6:5,108,{condition:b.condition});
  return entries.sort((a,b)=>(a.position.x+a.position.y)-(b.position.x+b.position.y));
}

function loadImage(url){return new Promise(resolve=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>resolve(null);im.src=url;});}
export class MedievalArt{
  constructor(){
    this.atlas=null;this.sleepAtlas=null;this.grass=null;this.revision=0;
    this.ground=null;this.groundKey='';this.frames=[];this.sleepFrames=[];this.citizenAtlases=[];this.animatedCitizenAtlases=[];
    this.ready=Promise.all([ATLAS_URL,SLEEP_ATLAS_URL,GRASS_URL,...CITIZEN_ATLAS_URLS,...ANIMATED_CITIZEN_ATLAS_URLS].map(loadImage)).then(([atlas,sleepAtlas,grass,...citizens])=>{
      this.atlas=atlas;this.sleepAtlas=sleepAtlas;this.grass=grass;
      if(atlas)this.measureFrames(atlas,'base');
      if(sleepAtlas)this.measureFrames(sleepAtlas,'sleep');
      citizens.slice(0,4).forEach((image,i)=>{if(image)this.measureFrames(image,`citizen:${i}`);});
      citizens.slice(4).forEach((image,i)=>{if(image)this.measureFrames(image,`animated:${i}`);});
      this.revision++;return this;
    });
  }
  measureFrames(atlas=this.atlas,kind='base'){
    // Base atlas is 4x4; sleep atlas is 2x2.
    const canvas=document.createElement('canvas');canvas.width=atlas.width;canvas.height=atlas.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(atlas,0,0);
    const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);

    if(kind.startsWith('animated:')){
      const variant=Number(kind.split(':')[1]),layout=ANIMATION_ATLAS;
      if(atlas.width!==layout.variants[variant]?.width||atlas.height!==layout.variants[variant]?.height)return;
      const frames=Array.from({length:layout.states.length*layout.framesPerState},(_,i)=>({x:(i%layout.columns)*layout.cellWidth,y:Math.floor(i/layout.columns)*layout.cellHeight,w:layout.cellWidth,h:layout.cellHeight}));
      this.animatedCitizenAtlases[variant]={image:atlas,frames,pixels:data,referenceWidth:layout.variants[variant].referenceWidth};
      return;
    }

    if(kind.startsWith('citizen:')){
      const variant=Number(kind.split(':')[1]),layout=CITIZEN_SPRITE_ATLASES[variant];
      // Generated poses have slightly uneven spacing: explicit bounds avoid clipped tools.
      if(atlas.width===layout.width&&atlas.height===layout.height)this.citizenAtlases[variant]={image:atlas,frames:layout.frames,pixels:data};
      return;
    }

    const cols=kind==='sleep'?2:4;
    const rows=kind==='sleep'?2:4;
    const frameCount=cols*rows;
    const cw=canvas.width/cols;
    const ch=canvas.height/rows;

    const frames=[];

    for(let i=0;i<frameCount;i++){
      const ox=Math.floor((i%cols)*cw);
      const oy=Math.floor(Math.floor(i/cols)*ch);

      let l=cw,t=ch,r=0,b=0,found=false;

      for(let y=0;y<ch;y++){
        for(let x=0;x<cw;x++){
          if(data[((oy+y)*canvas.width+ox+x)*4+3]>24){
            found=true;
            l=Math.min(l,x);
            r=Math.max(r,x);
            t=Math.min(t,y);
            b=Math.max(b,y);
          }
        }
      }

      frames[i]=found
        ? {x:ox+l,y:oy+t,w:r-l+1,h:b-t+1}
        : {x:ox,y:oy,w:1,h:1};
    }

    if(kind==='sleep'){
      this.sleepFrames=frames;
      this.sleepPixelData=data;
    }else{
      this.frames=frames;
      this.pixelData=data;
    }
  }
  atlasFor(e){
    if(e.atlas?.startsWith('animated:'))return this.animatedCitizenAtlases?.[Number(e.atlas.split(':')[1])]||{frames:[]};
    if(e.atlas?.startsWith('citizen:'))return this.citizenAtlases?.[Number(e.atlas.split(':')[1])]||{frames:[]};
    return e.atlas==='sleep'||e.sleep
      ? {image:this.sleepAtlas,frames:this.sleepFrames,pixels:this.sleepPixelData}
      : {image:this.atlas,frames:this.frames,pixels:this.pixelData};
  }
  citizenSprite(c,standSize=19,sleepSize=32){
    const sprite=citizenSprite(c),asset=this.atlasFor(sprite),frame=asset.frames[sprite.frame];
    if(!asset.image||!frame)return {atlas:'base',frame:citizenFrame(c),sleep:false,size:standSize};
    // The idle cell fixes the scale; wide tools must not shrink the person.
    const size=sprite.sleep?sleepSize:standSize*frame.w/asset.frames[0].w;
    return {...sprite,size};
  }
  animatedCitizenSprite(c,nowMs=0,standSize=10.5,sleepSize=15){
    const variant=citizenFrame(c)-12,asset=this.animatedCitizenAtlases?.[variant],frame=citizenAnimationFrame(c,nowMs);
    if(!asset?.image||!asset.frames[frame.frame])return this.citizenSprite(c,standSize,sleepSize);
    return {...frame,atlas:`animated:${variant}`,sleep:frame.animation==='sleep',anchorY:104/112,size:standSize*ANIMATION_ATLAS.cellWidth/asset.referenceWidth};
  }
  hitRecord(e,p,zoom,flip=false,{anchorY=e.anchorY??.94,scaleY=1,rotation=0}={}){
    const width=e.size*zoom,f=this.atlasFor(e).frames[e.frame];
    const hit={id:e.id,kind:e.kind,atlas:e.atlas,frame:e.frame,sleep:Boolean(e.sleep),flip,x:p.x,y:p.y,r:width*.5};
    if(!f)return hit;
    const height=width*f.h/f.w*scaleY,c=Math.cos(rotation),s=Math.sin(rotation);
    const corners=[[-width/2,-height*anchorY],[width/2,-height*anchorY],[-width/2,height*(1-anchorY)],[width/2,height*(1-anchorY)]].map(([x,y])=>({x:p.x+x*c-y*s,y:p.y+x*s+y*c}));
    const xs=corners.map(q=>q.x),ys=corners.map(q=>q.y),x=Math.min(...xs),y=Math.min(...ys);
    return {...hit,width,height,anchorY,rotation,bounds:{x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y}};
  }
  hitTest(hit,x,y){
    if(!hit.bounds)return Math.hypot(x-hit.x,y-hit.y)<=hit.r;
    const dx=x-hit.x,dy=y-hit.y,c=Math.cos(hit.rotation),s=Math.sin(hit.rotation);
    const u=(dx*c+dy*s)/hit.width+.5,v=(-dx*s+dy*c)/hit.height+hit.anchorY;
    if(u<0||u>=1||v<0||v>=1)return false;
    const {image,frames,pixels}=this.atlasFor(hit),f=frames[hit.frame];
    if(!image||!f)return false;
    const px=f.x+Math.min(f.w-1,Math.floor((hit.flip?1-u:u)*f.w)),py=f.y+Math.floor(v*f.h);
    return pixels?.[(py*image.width+px)*4+3]>32;
  }
  drawFromAtlas(ctx,atlas,frames,frame,x,y,size,flip=false,anchorY=.94){
    if(!atlas||!frames[frame])return false;
    const f=frames[frame],h=size*f.h/f.w;
    ctx.save();ctx.translate(x,y);if(flip)ctx.scale(-1,1);ctx.drawImage(atlas,f.x,f.y,f.w,f.h,-size/2,-h*anchorY,size,h);ctx.restore();return true;
  }
  drawSprite(ctx,frame,x,y,size,flip=false){return this.drawFromAtlas(ctx,this.atlas,this.frames,frame,x,y,size,flip);}
  drawSleepSprite(ctx,frame,x,y,size,flip=false){return this.drawFromAtlas(ctx,this.sleepAtlas,this.sleepFrames,frame,x,y,size,flip);}
  drawEntry(ctx,e,x,y,zoom=1,flip=false){const {image,frames}=this.atlasFor(e);return this.drawFromAtlas(ctx,image,frames,e.frame,x,y,e.size*zoom,flip,e.anchorY??.94);}
  groundFor(w){
    const key=`${seedOfWorld(w)}|${this.revision}`;if(this.ground&&this.groundKey===key)return this.ground;
    // A continuous top-down material map is projected once, not thousands of tile objects per frame.
    const n=768,flat=document.createElement('canvas');flat.width=flat.height=n;
    const ctx=flat.getContext('2d'),img=ctx.createImageData(n,n),seed=seedOfWorld(w),samples=129,field=[];
    for(let y=0;y<samples;y++)for(let x=0;x<samples;x++)field.push(terrainAtPublic(w,x/128*100,y/128*100));
    let rng=seed>>>0;const noise=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
    for(let y=0;y<n;y++){const wy=y/(n-1)*100,river=riverCenterXPublic(w,wy);for(let x=0;x<n;x++){
      const wx=x/(n-1)*100,fx=wx/100*128,fy=wy/100*128,ix=Math.min(127,Math.floor(fx)),iy=Math.min(127,Math.floor(fy)),a=field[iy*samples+ix],b=field[iy*samples+ix+1],c=field[(iy+1)*samples+ix],d=field[(iy+1)*samples+ix+1],u=fx-ix,v=fy-iy;
      const mix=k=>(a[k]*(1-u)+b[k]*u)*(1-v)+(c[k]*(1-u)+d[k]*u)*v;
      const elevation=mix('elevation'),moisture=mix('moisture'),grain=(noise()-.5)*17,patch=Math.sin(wx*.34+Math.sin(wy*.2))*Math.cos(wy*.43)*4;
      let color=[117+elevation*15-moisture*17,132+elevation*7-moisture*14,72+elevation*5];
      const dist=Math.abs(wx-river),shore=clamp((2.35-dist)/1.3,0,1);
      color=color.map((c,i)=>c*(1-shore)+[161,151,110][i]*shore);
      const water=clamp((1.18-dist)*8,0,1),deep=clamp(1-dist/1.18,0,1);
      color=color.map((c,i)=>c*(1-water)+([82,133,132][i]-deep*[43,32,21][i])*water);
      const idx=(y*n+x)*4;for(let k=0;k<3;k++)img.data[idx+k]=clamp(color[k]+grain+patch,0,255);img.data[idx+3]=255;
    }}
    ctx.putImageData(img,0,0);
    if(this.grass){ctx.globalCompositeOperation='soft-light';ctx.globalAlpha=.8;const pattern=ctx.createPattern(this.grass,'repeat');pattern.setTransform(new DOMMatrix().scale(.34));ctx.fillStyle=pattern;ctx.fillRect(0,0,n,n);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;}
    // Fine stones, grass blades and shore glints remain baked into the terrain cache.
    for(let i=0;i<15000;i++){const x=noise()*n,y=noise()*n,wx=x/n*100,wy=y/n*100,dist=Math.abs(wx-riverCenterXPublic(w,wy));ctx.fillStyle=dist<1?'#b9dad140':i%4?'#d2cc9140':'#30482338';ctx.fillRect(x,y,dist<1?3:1,.6+noise());}
    const ground=document.createElement('canvas');ground.width=3200;ground.height=1600;
    const g=ground.getContext('2d');g.setTransform(1600/n,800/n,-1600/n,800/n,1600,0);g.drawImage(flat,0,0);
    this.ground=ground;this.groundKey=key;return ground;
  }
}
