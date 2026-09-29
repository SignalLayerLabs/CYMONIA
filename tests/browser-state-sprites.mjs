import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const base=process.env.CYMONIA_URL||'http://127.0.0.1:8765';
const output=process.env.CYMONIA_ART_OUTPUT||'test-results/state-sprites';
const actions=['REST','MOVE','OBSERVE','EAT','DRINK','GATHER','CARRY','CUT','DIG','HEAT','BUILD','CARE','COMMUNICATE','EXPERIMENT','ATTACK','DEFEND','SLEEP'];
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  for(const mode of ['canvas','gpu']){
    const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/sprite-harness',route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#26392f}#stage{width:1200px;height:900px}canvas{position:absolute;inset:0;width:1200px;height:900px}</style><div id="stage"><canvas id="worldCanvas" width="1200" height="900"></canvas></div><canvas id="miniMap" hidden></canvas>'}));
    await page.goto(`${base}/sprite-harness`);
    if(mode==='gpu')await page.addScriptTag({path:path.resolve('node_modules/pixi.js/dist/pixi.min.js')});
    await page.evaluate(async()=>{
      const {SovereignRenderer}=await import('/sovereign-renderer.js');
      window.renderer=new SovereignRenderer(document.querySelector('#worldCanvas'),document.querySelector('#miniMap'));
      await renderer.art.ready;
    });
    if(mode==='gpu')await page.waitForFunction(()=>renderer.gpu.ready||renderer.gpu.failed);
    const result=await page.evaluate(({actions,mode})=>{
      const check=(value,message)=>{if(!value)throw new Error(message);};
      const r=window.renderer,art=r.art;
      check(art.citizenAtlases.filter(Boolean).length===4,'four action atlases load');
      // Every visible pixel belongs to exactly one complete pose; no clipped tools or cell bleed.
      for(const asset of art.citizenAtlases){
        const coverage=new Uint8Array(asset.image.width*asset.image.height);
        check(asset.frames.length===16,'sixteen poses per identity');
        for(const f of asset.frames){
          check(f.w>40&&f.h>80,'non-empty pose');
          for(let y=f.y;y<f.y+f.h;y++)for(let x=f.x;x<f.x+f.w;x++)coverage[y*asset.image.width+x]++;
        }
        for(let i=0;i<coverage.length;i++)if(asset.pixels[i*4+3]>24)check(coverage[i]===1,`pose clipped/overlapping at pixel ${i}`);
      }
      const citizens=[],ids=[];
      // Find one stable Genesis id for each of the three identities.
      for(let i=0;citizens.length<3;i++){
        const c={id:`sprite:${i}`,kind:'GENESIS',alive:true,position:{x:40+citizens.length*6,y:50}};
        const variant=Number(art.citizenSprite(c).atlas.split(':')[1]);
        if(!ids.includes(variant)){ids.push(variant);citizens.push(c);}
      }
      citizens.push({id:'human',kind:'HUMAN_LINKED',alive:true,position:{x:58,y:50}});ids.push(3);
      const state={worldId:'sprite-fixture',seed:20260915,worldMinute:0,citizens,resourceDeposits:[],objects:[],projects:[],buildings:[]};
      r.setState(state);Object.assign(r.camera,{x:50,y:50,width:1200,height:900,zoom:3});
      const ctx=r.canvas.getContext('2d');
      if(mode==='gpu')check(r.gpu.ready,'real Pixi WebGL initialized');
      for(const [index,type] of [...actions.entries(),[0,'REST']]){
        for(const c of citizens)c.currentAction={type,startedWorldMinute:0,endsWorldMinute:100,fromPosition:{...c.position},targetPosition:{x:c.position.x-10,y:c.position.y}};
        const before=JSON.stringify(state);
        if(mode==='gpu')r.gpu.render(state,r.camera,0);else r.drawWorldObjects(ctx,{width:1200,height:900},{},0);
        const hits=(mode==='gpu'?r.gpu.hits:r.hits).filter(h=>h.kind==='citizen');
        check(hits.length===4,`${mode} ${type}: all identities visible`);
        for(const [i,c] of citizens.entries()){
          const hit=hits.find(h=>h.id===c.id);
          check(hit.atlas===(type==='SLEEP'?'sleep':`citizen:${ids[i]}`),`${type}: atlas identity`);
          check(hit.frame===(type==='SLEEP'?ids[i]:index),`${type}: correct rendered pose`);
          const asset=art.atlasFor(hit),f=asset.frames[hit.frame];let sample;
          for(let y=0;y<f.h&&!sample;y++)for(let x=0;x<f.w;x++)if(asset.pixels[((f.y+y)*asset.image.width+f.x+x)*4+3]>200){sample={x,y};break;}
          check(sample,`${type}: opaque sprite pixels`);
          const u=(sample.x+.5)/f.w,v=(sample.y+.5)/f.h;
          const dx=((hit.flip?1-u:u)-.5)*hit.width,dy=(v-hit.anchorY)*hit.height;
          const x=hit.x+dx*Math.cos(hit.rotation)-dy*Math.sin(hit.rotation),y=hit.y+dx*Math.sin(hit.rotation)+dy*Math.cos(hit.rotation);
          check(art.hitTest(hit,x,y),`${mode} ${type}: transformed opaque pixel selectable`);
          check(!art.hitTest(hit,hit.bounds.x-10,hit.bounds.y-10),`${type}: outside sprite not selectable`);
          if(mode==='gpu'){
            const entry=r.gpu.citizenSprites.get(c.id);
            check(entry.body.texture===r.gpu.citizenTextures.get(hit.atlas)[hit.frame],`${type}: GPU texture switched`);
            if(type==='REST')check(entry.shadow.scale.y===1,'sleep shadow resets after waking');
          }
        }
        check(JSON.stringify(state)===before,`${mode} ${type}: canonical state unchanged`);
      }
      // Render a labeled contact sheet using the actual Canvas crop and scale implementation.
      const sheet=document.createElement('canvas');sheet.width=1200;sheet.height=1780;
      const g=sheet.getContext('2d');g.fillStyle='#26392f';g.fillRect(0,0,sheet.width,sheet.height);
      g.fillStyle='#eee2bd';g.font='bold 24px sans-serif';g.fillText('CYMONIA · 17 states / 4 identities',30,38);
      for(const [row,type] of actions.entries()){
        g.fillStyle='#eee2bd';g.font='15px sans-serif';g.fillText(type,25,94+row*99);
        for(const [col,c] of citizens.entries()){
          c.currentAction={type};const sprite=art.citizenSprite(c,29,80);
          art.drawEntry(g,sprite,300+col*245,148+row*99,1,false);
        }
      }
      window.spriteSheet=sheet;return {states:actions.length,identities:citizens.length,mode};
    },{actions,mode});
    assert.deepEqual(result,{states:17,identities:4,mode});
    if(mode==='canvas'){
      const data=await page.evaluate(()=>spriteSheet.toDataURL().split(',')[1]);
      await fs.writeFile(`${output}/all-states.png`,Buffer.from(data,'base64'));
    }
    await page.screenshot({path:`${output}/${mode}.png`});
    assert.deepEqual(errors,[]);
    await page.close();
    console.log(`PASS: ${mode} — 17 states, 4 identities, atlas bounds, transitions, hit masks, immutable world.`);
  }
}finally{await browser.close();}
