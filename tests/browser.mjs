// Optional integration suite: install Playwright in a development environment.
// PLAYWRIGHT_MODULE can point to an external installation; no runtime dependency is added.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url=process.env.CYMONIA_URL || 'http://localhost:8765';
const output=process.env.CYMONIA_SCREENSHOTS || '/tmp/cymonia-browser/verified';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1100},permissions:['clipboard-read','clipboard-write']});
const page=await context.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
try {
 await page.goto(url);await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).snapshotEpoch!==null);
 await page.evaluate(()=>document.fonts.ready);
 const snapshotEpoch=(await state()).snapshotEpoch;
 assert.equal((await state()).selectedMarket,'compute');
 await page.locator('[data-market="research"]').click();assert.equal((await state()).selectedMarket,'research');assert.match(await page.locator('#districtTitle').innerText(),/research/i);
 await page.locator('#city').focus();await page.keyboard.press('ArrowRight');assert.equal((await state()).selectedMarket,'code');
 const hit=(await state()).districts.find(d=>d.id==='audit');await page.locator('#city').click({position:{x:hit.x,y:hit.y}});assert.equal((await state()).selectedMarket,'audit');
 await page.locator('#pauseCity').click();assert.equal((await state()).cityPaused,true);
 await page.locator('#pauseCity').click();assert.equal((await state()).cityPaused,false);
 await page.locator('#fullscreen').click();await page.waitForFunction(()=>document.fullscreenElement!==null);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.fullscreenElement===null);
 await page.locator('#districtAgents [data-agent]').first().click();assert.ok(await page.locator('#agentDialog').isVisible());assert.match(await page.locator('#agentDetail').innerText(),/Fixed-rule Genesis agent/);assert.ok((await state()).missions.includes('agent'));await page.screenshot({path:output+'/agent.png'});await page.keyboard.press('Escape');assert.equal(await page.locator('#agentDialog').isVisible(),false);
 await page.locator('#exploreAgents').click();assert.equal(await page.locator('#agentMarket').inputValue(),'audit');assert.equal(await page.locator('.agent-card').count(),10);
 await page.locator('#agentSearch').fill('nobody');assert.equal(await page.locator('.agent-card').count(),0);assert.match(await page.locator('#agentsGrid').innerText(),/No agents match/);
 await page.locator('#agentSearch').fill('');await page.locator('#agentMarket').selectOption('all');await page.locator('#moreAgents').click();assert.equal(await page.locator('.agent-card').count(),100);await page.locator('#moreAgents').click();assert.equal(await page.locator('.agent-card').count(),10);
 await page.locator('#inspectPolicy').click();assert.ok(await page.locator('#policyDialog').isVisible());assert.match(await page.locator('#policyDetail').innerText(),/Observed evidence/);await page.keyboard.press('Escape');
 await page.locator('#epochSlider').fill('0');assert.equal((await state()).macroEpoch,1);assert.equal((await state()).snapshotEpoch,snapshotEpoch);
 await page.locator('#macroMetric').selectOption('gini');assert.match(await page.locator('#macroValueHeader').textContent(),/Gini/);
 await page.locator('#playHistory').click();await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).macroEpoch>1);await page.locator('#playHistory').click();
 await page.getByRole('button',{name:'AI laboratory'}).click();await page.waitForSelector('#researchContent:not([hidden])');assert.equal((await state()).missions.length,3);
 for(const seed of ['11','29','47']){await page.locator('#studySeed').selectOption(seed);for(const metric of ['nominal_gdp','gini','money_supply','mean_reward']){await page.locator('#studyMetric').selectOption(metric);assert.ok(!(await page.locator('#studyComparison').innerText()).includes('NaN'));}}
 await page.locator('#traceAgent').selectOption('agent-0003');await page.locator('#traceEpoch').selectOption('1');assert.match(await page.locator('#decisionTrace').innerText(),/all 100 agents learn/);assert.ok(!(await page.locator('#decisionTrace').innerText()).includes('undefined'));
 await page.locator('#copyCommand').click();await page.waitForFunction(()=>document.getElementById('copyCommand').textContent==='Copied ✓');assert.equal(await page.locator('#copyCommand').innerText(),'Copied ✓');
 const downloaded=page.waitForEvent('download');await page.locator('a[download][href="data/experiments.json"]').click();assert.equal((await downloaded).suggestedFilename(),'experiments.json');
 await page.locator('#studySeed').selectOption('11');await page.locator('#studyMetric').selectOption('nominal_gdp');await page.locator('#traceEpoch').selectOption('60');await page.screenshot({path:output+'/research.png',fullPage:true});
 await page.getByRole('button',{name:'The protocol',exact:true}).click();assert.match(await page.locator('#integrityBadge').innerText(),/VERIFIED/);assert.match(await page.locator('#protocolView').innerText(),/do not directly affect demand/);
 await page.locator('[data-view="participate"]').click();await page.waitForFunction(()=>document.getElementById('participationStatus').textContent.includes('OFFLINE'));assert.match(await page.locator('#participateView').innerText(),/Can an economy learn/i);assert.match(await page.locator('#participateView').innerText(),/No Economic Purpose/i);
 await page.getByRole('button',{name:'Observatory',exact:true}).click();await page.locator('[data-market="compute"]').click();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:output+'/desktop.png',fullPage:true});
 for(const width of [390,768]){
  await page.setViewportSize({width,height:844});
  for(const name of ['Observatory','AI laboratory','The protocol']){
   await page.getByRole('button',{name,exact:name!=='AI laboratory'}).click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} overflow at ${width}`);
   await page.screenshot({path:`${output}/${name.split(' ')[0].toLowerCase()}-${width}.png`,fullPage:true});
  }
  await page.locator('[data-view="participate"]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Participate overflow at ${width}`);
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Observatory',exact:true}).click();assert.equal((await state()).cityPaused,true);
 assert.deepEqual(errors,[]);
 // Data failure must be visible and retry must actually recover.
 const failed=await context.newPage();let block=true;await failed.route('**/data/state.json',r=>block?r.fulfill({status:503,body:'unavailable'}):r.continue());await failed.goto(url);await failed.waitForSelector('#loadError:not([hidden])');block=false;await failed.locator('#retry').click();await failed.waitForFunction(()=>JSON.parse(window.render_game_to_text()).snapshotEpoch!==null);assert.equal(await failed.locator('#loadError').isVisible(),false);await failed.close();
 const missingStudy=await context.newPage();let badStudy=true;await missingStudy.route('**/data/experiments.json',r=>badStudy?r.fulfill({status:503,body:'unavailable'}):r.continue());await missingStudy.goto(url+'/#research');await missingStudy.waitForSelector('#researchError:not([hidden])');badStudy=false;await missingStudy.locator('#retryResearch').click();await missingStudy.waitForSelector('#researchContent:not([hidden])');await missingStudy.close();
 const malformed=await context.newPage();let malformedOnce=true;let studyRequests=0;
 await malformed.route('**/data/experiments.json',async r=>{studyRequests++;const response=await r.fetch();const data=await response.json();if(malformedOnce)delete data.runs.find(x=>x.arm==='adaptive').decisions;await r.fulfill({response,json:data});});
 await malformed.goto(url+'/#research');await malformed.waitForSelector('#researchError:not([hidden])');malformedOnce=false;await malformed.locator('#retryResearch').click();await malformed.waitForSelector('#researchContent:not([hidden])');assert.equal(studyRequests,2);assert.equal(await malformed.locator('#researchError').isVisible(),false);await malformed.close();
 console.log('PASS: city, keyboard, fullscreen, agents, search, missions, policy, macro replay, research, trace, download, mobile/tablet, reduced motion, data-error recovery; zero page errors.');
} finally {await browser.close();}
