import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createWorld,advanceWorld,publicWorld} from '../functions/_lib/world-engine.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
const output=process.env.CYMONIA_SCREENSHOTS||'test-results/world';
await mkdir(output,{recursive:true});
const url=process.env.CYMONIA_URL||'http://127.0.0.1:8765';
const page=await browser.newPage({viewport:{width:1600,height:1100}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const state=()=>page.evaluate(()=>window.getLiveWorldState());
try{
 await page.goto(url+'/#world');await page.waitForFunction(()=>window.getLiveWorldState?.().tick!==null);
 await page.waitForFunction(()=>Object.values(window.getLiveWorldState().assets).every(Boolean));
 assert.equal((await state()).entities,121);assert.equal((await state()).visible.length,121);
 for(const [key,title] of [['central_bank','Central Bank'],['government','Government'],['justice','Justice'],['police','Police']]){
  await page.locator(`[data-world-entity="institution:${key}"]`).click();assert.equal((await state()).selected,`institution:${key}`);assert.match(await page.locator('#liveInspector').innerText(),new RegExp(title));
 }
 await page.locator('#liveLeaders [data-world-citizen]').first().click();const citizen=(await state()).selected;
 await page.locator('[data-follow]').click();await page.waitForFunction(()=>window.getLiveWorldState().follow!==null);assert.equal((await state()).follow,citizen);
 await page.locator('#worldCenter').click();assert.equal((await state()).follow,null);assert.equal((await state()).camera.panX,0);
 const before=(await state()).camera.zoom;await page.locator('#worldZoomIn').click();assert.ok((await state()).camera.zoom>before);
 await page.locator('#worldPause').click();const paused=await state();await page.evaluate(()=>window.advanceLiveWorldTime(5000));assert.equal((await state()).time,paused.time);
 await page.locator('#worldZoomOut').click();assert.ok((await state()).camera.zoom<paused.camera.zoom);
 await page.locator('#liveCanvas').focus();await page.keyboard.press('ArrowRight');assert.equal((await state()).camera.panX,-40);
 await page.keyboard.press('Home');assert.equal((await state()).camera.panX,0);
 await page.locator('#worldLabels').click();assert.equal((await state()).labels,true);
 await page.locator('#worldFullscreen').click();await page.waitForFunction(()=>document.fullscreenElement!==null);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.fullscreenElement===null);
 await page.locator('#liveCanvas').scrollIntoViewIfNeeded();const rect=await page.locator('#liveCanvas').boundingBox();
 const chosen=await page.evaluate(async()=>{const {pickEntity}=await import('./world-scene.js');const hits=window.getLiveWorldState().visible;return hits.filter(h=>h.kind==='building').map(h=>({id:h.id,x:h.x,y:h.y-h.height*.6})).find(p=>pickEntity(hits,p.x,p.y)?.id===p.id);});
 assert.ok(chosen);await page.mouse.click(rect.x+chosen.x,rect.y+chosen.y);assert.equal((await state()).selected,chosen.id);
 await page.locator('#liveInspector [data-world-entity]').click();assert.match(await page.locator('#liveInspector').innerText(),/AUTONOMOUS COMPANY/);
 await page.locator('#liveNews [data-world-event]').first().click();assert.match(await page.locator('#whyBox').innerText(),/Recorded at tick/);
 await page.locator('#agentOpen').click();assert.equal(await page.locator('#agentProposalForm').isVisible(),false);assert.ok(await page.locator('#agentBody a').isVisible());await page.locator('#agentPanel [aria-label="Close"]').click();
 await page.locator('#worldLabels').click();await page.locator('#worldCenter').click();await page.locator('#liveCanvas').screenshot({path:output+'/world-desktop.png'});
 for(const width of [390,768]){await page.setViewportSize({width,height:844});await page.locator('#worldCenter').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.locator('#liveCanvas').screenshot({path:output+`/world-${width}.png`});}
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal((await state()).paused,true);
 // Real engine snapshots exercise live updates and zero-progress construction.
 const fixture=publicWorld(advanceWorld(createWorld(),8));fixture.buildings[0].progress=0;fixture.buildings[0].status='construction';fixture.buildings[0].stage='survey';
 await page.route('**/api/world',r=>r.fulfill({json:fixture}));await page.locator('#worldRetry').click();await page.waitForFunction(()=>window.getLiveWorldState().mode==='live');assert.equal((await state()).tick,8);
 await page.locator('#liveCanvas').screenshot({path:output+'/world-construction.png'});
 await page.unroute('**/api/world');
 const recovery=await browser.newPage();let blocked=true;await recovery.route('**/data/world.json',r=>blocked?r.fulfill({status:503,body:'unavailable'}):r.continue());await recovery.goto(url+'/#world');await recovery.waitForFunction(()=>document.getElementById('liveStatus').textContent.includes('UNAVAILABLE'));blocked=false;await recovery.locator('#worldRetry').click();await recovery.waitForFunction(()=>window.getLiveWorldState().tick===72);await recovery.close();
 assert.deepEqual(errors,[]);console.log('PASS: world assets, 121 visible entities, 4 institutions, Citizen follow, zoom/pan/reset, pause, keyboard, fullscreen, building/company picking, WHY, agent login, mobile/tablet, live snapshot and error recovery; zero page errors.');
}finally{await browser.close();}
