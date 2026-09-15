import {cameraScale,project,unproject,sceneEntities,SECTOR_COLORS} from './world-scene.js';

const TAU=Math.PI*2;
function polygon(ctx,points,fill,stroke){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function line(ctx,points,color,width=1){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
function seed(n){return ((Math.sin(n*127.1+311.7)*43758.5453)%1+1)%1;}
function imageAsset(url){const img=new Image();img.src=url;return img;}
function ready(img){return img.complete&&img.naturalWidth>0;}

export class WorldRenderer {
  constructor(canvas,mini){
    this.canvas=canvas;this.mini=mini;this.hits=[];this.entities=[];
    this.camera={width:1000,height:650,zoom:1.35,panX:0,panY:0};
    this.images={terrain:imageAsset('assets/world-terrain.png'),backdrop:imageAsset('assets/world-backdrop.png'),buildings:imageAsset('assets/world-buildings.png'),citizens:imageAsset('assets/world-citizens.png')};
    this.ground=this.makeGround();this.previous=new Map();this.changedAt=0;
  }
  setWorld(world,time=0){
    this.previous=new Map(this.entities.filter(e=>e.kind==='citizen').map(e=>[e.id,this.position(e,time)]));
    this.world=world;this.entities=sceneEntities(world);this.changedAt=time;
  }
  position(e,time){
    const old=this.previous.get(e.id);if(!old||e.kind!=='citizen')return {x:e.x,y:e.y,moving:false};
    const fraction=Math.min(1,Math.max(0,(time-this.changedAt)/1800));
    return {x:old.x+(e.x-old.x)*fraction,y:old.y+(e.y-old.y)*fraction,moving:fraction<1&&Math.hypot(e.x-old.x,e.y-old.y)>.05};
  }
  makeGround(){
    const c=document.createElement('canvas');c.width=1440;c.height=820;const ctx=c.getContext('2d');
    const iso=(x,y)=>[720+(x-y)*8,410+(x+y-100)*4];
    // A cartographic landscape; only the entities above it represent world records.
    polygon(ctx,[iso(5,5),iso(95,5),iso(95,95),iso(5,95)],'#303c38');
    for(let x=5;x<95;x+=5)for(let y=5;y<95;y+=5){const n=seed(x*97+y);polygon(ctx,[iso(x,y),iso(x+5,y),iso(x+5,y+5),iso(x,y+5)],`hsl(${83+n*10} 16% ${25+n*6}%)`);}
    for(let i=0;i<3200;i++){const x=6+seed(i)*88,y=6+seed(i+20000)*88,p=iso(x,y);ctx.fillStyle=i%3?'#d1c19312':'#092c2e22';ctx.fillRect(p[0],p[1],2+seed(i+9000)*4,1);}
    const roads=[[[10,50],[90,50]],[[50,10],[50,90]],[[25,20],[25,80]],[[75,20],[75,80]],[[20,25],[80,25]],[[20,75],[80,75]]];
    for(const road of roads){const p=road.map(v=>iso(...v));line(ctx,p,'#253230',19);line(ctx,p,'#8f8a73',15);line(ctx,p,'#aca38a',10);line(ctx,p,'#d4c9a333',1);}
    polygon(ctx,[iso(32,32),iso(68,32),iso(68,68),iso(32,68)],'#a29b82','#c9b994');
    for(let i=34;i<68;i+=3){line(ctx,[iso(i,32),iso(i,68)],'#6e70672a');line(ctx,[iso(32,i),iso(68,i)],'#6e70672a');}
    // Quiet perimeter vegetation keeps the active settlement readable.
    for(let i=0;i<95;i++){let x=8+seed(i+41)*84,y=8+seed(i+97)*84;if(x>21&&x<79&&y>21&&y<79)continue;if(Math.abs(x-50)<3||Math.abs(y-50)<3)continue;const [px,py]=iso(x,y),h=12+seed(i+123)*15;ctx.fillStyle='#15292466';ctx.beginPath();ctx.ellipse(px+5,py+2,10,4,0,0,TAU);ctx.fill();line(ctx,[[px,py],[px,py-h]],'#746146',2);for(let j=0;j<3;j++)polygon(ctx,[[px,py-h-5+j*6],[px+6-j,py-4+j*3],[px-6+j,py-4+j*3]],j===0?'#426447':'#365940');}
    polygon(ctx,[iso(5,5),iso(95,5),iso(95,95),iso(5,95)],'#00000000','#c1b99a66');
    return c;
  }
  draw(time,{selected,follow,hover,labels=false}={}){
    const canvas=this.canvas,r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;
    const d=Math.min(window.devicePixelRatio||1,2),ctx=canvas.getContext('2d');
    if(canvas.width!==Math.round(r.width*d)||canvas.height!==Math.round(r.height*d)){canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d);}
    Object.assign(this.camera,{width:r.width,height:r.height});const c=this.camera,s=cameraScale(c);
    if(follow){const e=this.entities.find(e=>e.id===follow);if(e){const pos=this.position(e,time),p=project(pos.x,pos.y,{...c,panX:0,panY:0});c.panX=c.width/2-p.x;c.panY=c.height*.51-p.y;}}
    ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,r.width,r.height);ctx.fillStyle='#182b30';ctx.fillRect(0,0,r.width,r.height);
    if(ready(this.images.backdrop)){const img=this.images.backdrop,f=Math.max(r.width/img.width,r.height/img.height);ctx.globalAlpha=.14;ctx.drawImage(img,(r.width-img.width*f)/2,(r.height-img.height*f)/2,img.width*f,img.height*f);ctx.globalAlpha=1;}
    const g=ctx.createRadialGradient(r.width*.5,r.height*.42,20,r.width*.5,r.height*.5,r.width*.75);g.addColorStop(0,'#122b2c00');g.addColorStop(1,'#07121ed9');ctx.fillStyle=g;ctx.fillRect(0,0,r.width,r.height);
    const center=project(50,50,c);ctx.drawImage(ready(this.images.terrain)?this.images.terrain:this.ground,center.x-720*s,center.y-410*s,1440*s,820*s);
    this.hits=[];const scene=this.entities.map(e=>({...e,position:this.position(e,time)})).sort((a,b)=>(a.position.x+a.position.y)-(b.position.x+b.position.y));
    for(const e of scene){const p=project(e.position.x,e.position.y,c),citizen=e.kind==='citizen',size=(citizen?31:e.kind==='institution'?135:108)*s;
      if(p.x+size<0||p.x-size>r.width||p.y+20<0||p.y-size>r.height)continue;
      const active=selected===e.id||follow===e.id||selected===e.company?.id,isHover=hover===e.id;
      if(active||isHover){ctx.beginPath();ctx.ellipse(p.x,p.y,Math.max(8,size*.4),Math.max(4,size*.19),0,0,TAU);ctx.strokeStyle=active?'#ffe0a0':'#e4efd5';ctx.fillStyle='#d7bb5220';ctx.fill();ctx.lineWidth=1.5;ctx.stroke();}
      if(citizen)this.drawCitizen(ctx,e,p,size,time);else this.drawBuilding(ctx,e,p,size,time);
      const hit={id:e.id,kind:e.kind,x:p.x,y:p.y,width:citizen?Math.max(12,size*.45):size*.78,height:citizen?Math.max(18,size*.9):size*.82};this.hits.push(hit);
      if((labels&&e.kind!=='citizen')||active||isHover){const label=e.name||e.company?.name||e.data.name||e.data.type;this.label(ctx,label,p.x,p.y-size*.93-7,active);}
    }
    this.drawMini();
  }
  drawBuilding(ctx,e,p,size,time){
    ctx.save();ctx.translate(p.x,p.y);const img=this.images.buildings;
    if(ready(img)){const cell=img.width/4;ctx.drawImage(img,(e.sprite%4)*cell,Math.floor(e.sprite/4)*cell,cell,cell,-size/2,-size*.91,size,size);}
    else{polygon(ctx,[[-size*.35,0],[0,size*.12],[size*.35,0],[0,-size*.14]],'#9c9982');polygon(ctx,[[-size*.35,0],[-size*.35,-size*.48],[0,-size*.6],[0,size*.12]],'#c8bea0');polygon(ctx,[[0,size*.12],[0,-size*.6],[size*.35,-size*.48],[size*.35,0]],'#8a9186');polygon(ctx,[[-size*.4,-size*.48],[0,-size*.72],[size*.4,-size*.48],[0,-size*.33]],'#627d8a');}
    if(e.data.status==='construction'){const progress=Math.max(0,Math.min(100,Number(e.data.progress??0)));ctx.fillStyle='#102526';ctx.fillRect(-size*.29,5,size*.58,4);ctx.fillStyle='#efc978';ctx.fillRect(-size*.29,5,size*.58*progress/100,4);
      if(progress>65){ctx.strokeStyle='#f3dda888';ctx.lineWidth=1;ctx.strokeRect(-size*.27,-size*.5,size*.54,size*.5);}
    }
    if(e.company){ctx.fillStyle=SECTOR_COLORS[e.company.sector]||'#c5c3af';ctx.beginPath();ctx.arc(0,1,2.5,0,TAU);ctx.fill();}
    ctx.restore();
  }
  drawCitizen(ctx,e,p,size,time){
    const c=e.data,img=this.images.citizens,moving=e.position.moving,frame=moving?Math.floor(time/180)%4:0;
    const row=c.kind==='HUMAN_LINKED'?1:c.sector==='research'?3:c.status==='working'&&['energy','logistics','housing','goods','food'].includes(c.sector)?2:0;
    ctx.save();ctx.translate(p.x,p.y);
    if(moving&&c.target_x<c.x)ctx.scale(-1,1);
    if(ready(img)){const cell=img.width/4;ctx.drawImage(img,frame*cell,row*cell,cell,cell,-size/2,-size*.92,size,size);}
    else{ctx.fillStyle=row===1?'#ecd196':'#9ed5c1';ctx.fillRect(-size*.1,-size*.55,size*.2,size*.4);ctx.beginPath();ctx.arc(0,-size*.66,size*.09,0,TAU);ctx.fill();}
    if(c.kind==='HUMAN_LINKED'){ctx.fillStyle='#ffdf85';ctx.beginPath();ctx.arc(0,-size,2.5,0,TAU);ctx.fill();}
    ctx.restore();
  }
  label(ctx,text,x,y,active){
    ctx.font='600 10px system-ui';ctx.textAlign='center';const w=ctx.measureText(text).width+18;
    ctx.fillStyle='#071b23ed';ctx.fillRect(x-w/2,y-13,w,21);ctx.strokeStyle=active?'#e0c484':'#617571';ctx.lineWidth=1;ctx.strokeRect(x-w/2,y-13,w,21);ctx.fillStyle=active?'#fbe0a2':'#e1e7d7';ctx.fillText(text,x,y+1);
  }
  drawMini(){
    const canvas=this.mini,r=canvas.getBoundingClientRect();if(!r.width)return;const d=Math.min(window.devicePixelRatio||1,2);
    if(canvas.width!==Math.round(r.width*d)||canvas.height!==Math.round(r.height*d)){canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d);}
    const ctx=canvas.getContext('2d');ctx.setTransform(d,0,0,d,0,0);ctx.fillStyle='#1c3435';ctx.fillRect(0,0,r.width,r.height);
    const point=(x,y)=>[8+x/100*(r.width-16),8+y/100*(r.height-16)];
    ctx.strokeStyle='#637761';ctx.strokeRect(8,8,r.width-16,r.height-16);
    for(const e of this.entities){const p=point(e.x,e.y);ctx.fillStyle=e.kind==='institution'?'#e1c582':e.kind==='citizen'?e.data.kind==='HUMAN_LINKED'?'#ffe292':'#b4d1bf':SECTOR_COLORS[e.company?.sector]||'#a4b7b0';ctx.fillRect(p[0]-1,p[1]-1,e.kind==='citizen'?1.5:3,e.kind==='citizen'?1.5:3);}
    const c=this.camera,points=[[0,0],[c.width,0],[c.width,c.height],[0,c.height]].map(([x,y])=>{const p=unproject(x,y,c);return point(p.x,p.y);});
    polygon(ctx,points,'#e6d09608','#e6d09688');
  }
  diagnostics(){return {camera:{...this.camera},assets:Object.fromEntries(Object.entries(this.images).map(([k,v])=>[k,ready(v)])),visible:this.hits.map(h=>({...h})),entities:this.entities.length};}
}
