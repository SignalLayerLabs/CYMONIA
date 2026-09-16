import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
const base=process.env.CYMONIA_URL||'http://127.0.0.1:8768';
const out=process.env.CYMONIA_ART_OUTPUT||'test-results/art';
await fs.mkdir(out,{recursive:true});
const errors=[];
try{
  for(const mode of ['canvas','gpu']){
    const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
    page.on('pageerror',e=>errors.push(`${mode}: ${e.message}`));
    if(mode==='canvas')await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
    await page.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));
    await page.goto(base,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).mode==='REPLAY');
    await page.evaluate(async()=>{const images=[...document.images];await Promise.all(images.map(im=>im.decode().catch(()=>{})));});
    await page.waitForTimeout(1200);
    await page.screenshot({path:`${out}/${mode}-genesis.png`});
    if(mode==='gpu')assert.equal(await page.locator('#gpuCanvas').count(),1,'GPU context must initialize for this test');
    await page.locator('#overlayKnowledge').click();await page.waitForTimeout(150);await page.locator('#overlayKnowledge').click();
    await page.locator('#overlayRelations').click();await page.waitForTimeout(150);await page.locator('#overlayRelations').click();
    const target=await page.evaluate(async()=>{const w=JSON.parse(window.render_game_to_text()),c=w.citizens.reduce((a,b)=>a.x+a.y>b.x+b.y?a:b);const {isoPoint}=await import('/medieval-art.js');const {terrainAtPublic}=await import('/terrain-model.js');const t=terrainAtPublic({seed:20260915},c.x,c.y),p=isoPoint(c.x,c.y,t.elevation),o=isoPoint(50,50);return{x:innerWidth/2+(p.x-o.x)*1.55,y:innerHeight/2+(p.y-o.y)*1.55-22*1.55};});
    await page.mouse.click(target.x,target.y);await page.waitForTimeout(100);
    assert.ok(await page.locator('#inspector').isVisible(),`sprite selection opens inspector (${mode}, ${JSON.stringify(target)}, ${await page.evaluate(()=>window.render_game_to_text())})`);
    await page.locator('#followSelected').click();await page.waitForTimeout(100);await page.locator('#closeInspector').click();await page.locator('#centerWorld').click();
    await page.locator('#historyOpen').click();assert.ok(await page.locator('#societyHistory').isVisible());
    await page.locator('#historyClose').click();
    await page.locator('#agentOpen').click();assert.ok(await page.locator('#agentWindow').isVisible());
    await page.locator('#agentClose').click();
    await page.mouse.move(760,450);await page.mouse.wheel(0,-250);await page.waitForTimeout(400);
    await page.keyboard.press('d');await page.locator('#centerWorld').click();await page.waitForTimeout(400);
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`${out}/${mode}-mobile.png`});
    await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: art renders in Canvas and WebGL, replay, archive/avatar controls, zoom, recenter, mobile and no page errors.');
}finally{await browser.close();}
