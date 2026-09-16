import {terrainAtPublic, riverCenterXPublic, seedOfWorld} from './terrain-model.js';

// Shared by WebGL and Canvas: all art uses the same ground plane and anchors.
export const ISO_X=16, ISO_Y=8;
export const isoPoint=(x,y,elevation=0)=>({x:(x-y)*ISO_X,y:(x+y)*ISO_Y-elevation*2.8});
export const isoInverse=(x,y)=>({x:(x/ISO_X+y/ISO_Y)/2,y:(y/ISO_Y-x/ISO_X)/2});
export function spriteBounds(frame,size,x,y){const height=size*frame.h/frame.w;return{x:x-size/2,y:y-height*.94,width:size,height};}
export const ATLAS_URL=new URL('./assets/medieval-atlas.png',import.meta.url).href;
const GRASS_URL=new URL('./assets/meadow-texture.png',import.meta.url).href;
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function artHash(value){let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0)/4294967296;}
export const citizenFrame=c=>c.kind==='HUMAN_LINKED'?15:12+Math.floor(artHash(c.id)*3);

export function staticSceneKey(w){
  return JSON.stringify([w?.worldId,w?.seed,(w?.resourceDeposits||[]).map(d=>[d.id,d.quantity>0,d.position,d.type]),(w?.objects||[]).filter(o=>o.kind==='temporary_shelter').map(o=>[o.id,o.quantity,o.condition,o.position]),(w?.projects||[]).map(p=>[p.id,p.status,p.site,p.workDoneMinutes,p.workRequiredMinutes]),(w?.buildings||[]).map(b=>[b.id,b.position,b.condition,b.massKg,b.designId])]);
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
  for(const o of w.objects||[])if(o.kind==='temporary_shelter'&&o.quantity>0&&o.condition!==0)add('shelter',o.id,o.position,4,54);
  for(const p of w.projects||[])if(p.status==='construction')add('project',p.id,p.site,7,90,{progress:clamp(p.workDoneMinutes/Math.max(1,p.workRequiredMinutes),0,1)});
  for(const b of w.buildings||[])if(b.massKg>0&&b.condition>0)add('building',b.id,b.position,/hall|communal|large/i.test(b.designId||'')?6:5,108,{condition:b.condition});
  return entries.sort((a,b)=>(a.position.x+a.position.y)-(b.position.x+b.position.y));
}

function loadImage(url){return new Promise(resolve=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>resolve(null);im.src=url;});}
export class MedievalArt{
  constructor(){this.atlas=null;this.grass=null;this.revision=0;this.ground=null;this.groundKey='';this.frames=[];this.ready=Promise.all([loadImage(ATLAS_URL),loadImage(GRASS_URL)]).then(([atlas,grass])=>{this.atlas=atlas;this.grass=grass;if(atlas)this.measureFrames();this.revision++;return this;});}
  measureFrames(){
    // Trim transparent margins per cell so every asset has a consistent foot anchor.
    const canvas=document.createElement('canvas');canvas.width=this.atlas.width;canvas.height=this.atlas.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(this.atlas,0,0);
    const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);this.pixelData=data;const cw=canvas.width/4,ch=canvas.height/4;
    for(let i=0;i<16;i++){const ox=Math.floor(i%4*cw),oy=Math.floor(Math.floor(i/4)*ch);let l=cw,t=ch,r=0,b=0;
      for(let y=0;y<ch;y++)for(let x=0;x<cw;x++)if(data[((oy+y)*canvas.width+ox+x)*4+3]>24){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
      this.frames[i]={x:ox+l,y:oy+t,w:Math.max(1,r-l+1),h:Math.max(1,b-t+1)};
    }
  }
  hitRecord(e,p,zoom,flip=false){const size=e.size*zoom,f=this.frames[e.frame];return{id:e.id,kind:e.kind,frame:e.frame,flip,x:p.x,y:p.y,r:size*.5,...(f?{bounds:spriteBounds(f,size,p.x,p.y)}:{})};}
  hitTest(hit,x,y){
    if(!hit.bounds)return Math.hypot(x-hit.x,y-hit.y)<=hit.r;
    const b=hit.bounds,u=(x-b.x)/b.width,v=(y-b.y)/b.height;if(u<0||u>=1||v<0||v>=1)return false;
    const f=this.frames[hit.frame],px=f.x+Math.min(f.w-1,Math.floor((hit.flip?1-u:u)*f.w)),py=f.y+Math.floor(v*f.h);
    return this.pixelData[(py*this.atlas.width+px)*4+3]>32;
  }
  drawSprite(ctx,frame,x,y,size,flip=false){
    if(!this.atlas||!this.frames[frame])return false;
    const f=this.frames[frame],h=size*f.h/f.w;
    ctx.save();ctx.translate(x,y);if(flip)ctx.scale(-1,1);ctx.drawImage(this.atlas,f.x,f.y,f.w,f.h,-size/2,-h*.94,size,h);ctx.restore();return true;
  }
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
