import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ACTION_TYPES} from '../world/constants.js';
import {PHYSICAL_PRIMITIVES} from '../world/physical-operations.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.CYMONIA_URL||'http://127.0.0.1:8765';
const output=process.env.CYMONIA_ART_OUTPUT||'test-results/graphics2';
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  for(const mode of ['canvas','gpu']){
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/graphics2-harness',route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#26392f}#stage{width:1440px;height:1000px}canvas{position:absolute;inset:0;width:1440px;height:1000px}</style><div id="stage"><canvas id="worldCanvas" width="1440" height="1000"></canvas></div><canvas id="miniMap" hidden></canvas>'}));
    await page.goto(`${base}/graphics2-harness`);
    if(mode==='gpu')await page.addScriptTag({path:path.resolve('node_modules/pixi.js/dist/pixi.min.js')});
    await page.evaluate(async()=>{
      const {SovereignRenderer}=await import('/sovereign-renderer.js');
      window.renderer=new SovereignRenderer(document.querySelector('#worldCanvas'),document.querySelector('#miniMap'));
      await renderer.art.ready;
    });
    if(mode==='gpu')await page.waitForFunction(()=>renderer.gpu.ready||renderer.gpu.failed);
    const result=await page.evaluate(async({types,primitives,mode})=>{
      const {actionAnimation,actionVisualContext,actionContextShapes,ANIMATED_SPRITE_STATES}=await import('/action-animations.js');
      const check=(value,message)=>{if(!value)throw new Error(message);},r=renderer,art=r.art;
      check(art.animatedCitizenAtlases.filter(Boolean).length===4,'all four animated identities load');
      const citizens=types.map((type,i)=>({id:`graphics2:${i}`,kind:i%4===3?'HUMAN_LINKED':'GENESIS',alive:true,position:{x:43+(i%6)*3,y:43+Math.floor(i/6)*3},currentAction:{type,startedWorldMinute:0,endsWorldMinute:100}}));
      const objects=citizens.map((c,i)=>({id:`target:${i}`,kind:i%5===0?'debris':'resource',material:i%2?'timber':'stone',quantity:1,massPerUnitKg:2,condition:.6,holderId:null,position:{x:c.position.x-1,y:c.position.y}}));
      citizens.forEach((c,i)=>{c.currentAction.targetId=objects[i].id;});
      objects.push({id:'held',kind:'artifact',material:'ore',quantity:1,massPerUnitKg:.5,condition:1,holderId:citizens[7].id,position:{...citizens[7].position}});
      objects[11].temperatureC=420;objects[11].burning=true;
      const state={worldId:'graphics2',seed:20260915,clock:{worldMinute:0,realEpochMs:null},citizens,objects,resourceDeposits:[],projects:[],buildings:[]};
      r.setState(state);Object.assign(r.camera,{x:50,y:50,width:1440,height:1000,zoom:3});
      const ctx=r.canvas.getContext('2d');
      if(mode==='gpu')check(r.gpu.ready,'real Pixi WebGL initializes');
      const paint=nowMs=>{
        if(mode==='gpu'){r.gpu.render(state,r.camera,0,{nowMs});r.gpu.app.render();return r.gpu.hits.filter(h=>h.kind==='citizen');}
        ctx.clearRect(0,0,1440,1000);r.drawTerrain(ctx,{width:1440,height:1000},{night:0},0);r.drawWorldObjects(ctx,{width:1440,height:1000},{night:0},0,nowMs);return r.hits.filter(h=>h.kind==='citizen');
      };
      const before=JSON.stringify(state),hits=paint(1000);
      check(hits.length===types.length,'every canonical action rendered');
      for(const c of citizens){
        const visual=art.animatedCitizenSprite(c,1000),hit=hits.find(h=>h.id===c.id);
        check(hit.atlas===visual.atlas&&hit.frame===visual.frame,`${c.currentAction.type}: live atlas frame`);
        check(hit.flip,`${c.currentAction.type}: faces canonical target`);
        const asset=art.atlasFor(hit),f=asset.frames[hit.frame];let sample=null;
        for(let y=0;y<f.h&&!sample;y++)for(let x=0;x<f.w;x++)if(asset.pixels[((f.y+y)*asset.image.width+f.x+x)*4+3]>200){sample={x,y};break;}
        check(sample,`${c.currentAction.type}: opaque pixels`);
        const u=(sample.x+.5)/f.w,v=(sample.y+.5)/f.h,dx=((hit.flip?1-u:u)-.5)*hit.width,dy=(v-hit.anchorY)*hit.height;
        check(art.hitTest(hit,hit.x+dx*Math.cos(hit.rotation)-dy*Math.sin(hit.rotation),hit.y+dx*Math.sin(hit.rotation)+dy*Math.cos(hit.rotation)),`${c.currentAction.type}: animated selection mask`);
        if(mode==='gpu')check(r.gpu.citizenSprites.get(c.id).body.texture===r.gpu.citizenTextures.get(visual.atlas)[visual.frame],`${c.currentAction.type}: actual GPU texture`);
      }
      const next=paint(1440);check(next.some((h,i)=>h.frame!==hits[i].frame),'actual render frames advance');
      check(JSON.stringify(state)===before,'rendering never mutates canonical state');
      // Physical procedures use the same visible sheet and canonical target.
      for(const [i,primitive] of primitives.entries()){
        const c=citizens[i];c.currentAction={type:'EXPERIMENT',procedureId:'procedure:fixture',physicalOperation:{primitive,targetId:objects[i].id}};
        const selected=actionAnimation(c.currentAction);check(ANIMATED_SPRITE_STATES.includes(selected.state),`${primitive}: registered sheet`);
      }
      paint(2000);
      for(const [i,primitive] of primitives.entries())check(art.animatedCitizenSprite(citizens[i],2000).animation===actionAnimation(citizens[i].currentAction).state,`${primitive}: live operation state`);
      const cold={id:'cold',kind:'artifact',material:'ore',quantity:1,temperatureC:20};
      const coldContext=actionVisualContext({id:'none',currentAction:{type:'HEAT',targetId:'cold'}},{objects:[cold]});
      check(actionContextShapes(coldContext,1000).length===0,'HEAT cannot invent fire');
      // Restore action examples and render 100+ people while keeping the per-person
      // Graphics nodes stable. Timings are reported, not flaky machine thresholds.
      citizens.forEach((c,i)=>{c.currentAction={type:types[i],targetId:objects[i].id};});
      for(let i=citizens.length;i<110;i++)citizens.push({id:`crowd:${i}`,kind:'GENESIS',alive:true,position:{x:47+(i%10)*.3,y:47+Math.floor(i/10)*.3},currentAction:{type:'MOVE'}});
      r.setState(state);r.camera.zoom=2;r.camera.x=50;r.camera.y=50;
      paint(2500);
      const nodeCount=mode==='gpu'?r.gpu.citizenLayer.children.length:null,start=performance.now();
      for(let frame=0;frame<30;frame++)paint(2500+frame*50);
      const renderMs=(performance.now()-start)/30;
      if(mode==='gpu')check(r.gpu.citizenLayer.children.length===nodeCount,'transient/per-citizen graphics nodes are reused');
      // A contact sheet is a visual QA artifact, drawn through the real art API.
      const sheet=document.createElement('canvas');sheet.width=1440;sheet.height=1280;const g=sheet.getContext('2d');g.fillStyle='#26392f';g.fillRect(0,0,sheet.width,sheet.height);
      for(const [i,type] of types.entries()){
        const c=citizens[i],x=80+(i%6)*235,y=80+Math.floor(i/6)*240;
        g.fillStyle='#eee2bd';g.font='15px sans-serif';g.fillText(type,x-30,y-40);
        for(let frame=0;frame<4;frame++){const sprite=art.animatedCitizenSprite(c,frame*actionAnimation(c.currentAction).frameMs,24);art.drawEntry(g,sprite,x+frame*47,y+80);}
      }
      window.graphics2Sheet=sheet;
      return {actions:types.length,primitives:primitives.length,identities:4,crowd:citizens.length,renderMs:Number(renderMs.toFixed(2)),mode};
    },{types:[...ACTION_TYPES],primitives:PHYSICAL_PRIMITIVES,mode});
    assert.equal(result.actions,ACTION_TYPES.size);assert.equal(result.primitives,PHYSICAL_PRIMITIVES.length);assert.equal(result.crowd,110);
    const sheet=await page.evaluate(()=>graphics2Sheet.toDataURL().split(',')[1]);
    await fs.writeFile(`${output}/${mode}-all-actions.png`,Buffer.from(sheet,'base64'));
    await page.screenshot({path:`${output}/${mode}-world.png`});
    assert.deepEqual(errors,[]);
    console.log(`PASS: Graphics 2.0 ${JSON.stringify(result)}`);
    await page.close();
  }
}finally{await browser.close();}
