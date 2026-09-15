import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
const url=process.env.CYMONIA_URL||'http://127.0.0.1:8765';
const page=await browser.newPage({viewport:{width:1600,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(url+'/#world');
  await page.waitForFunction(()=>window.getLiveWorldState?.().tick!==null);
  await page.waitForSelector('#rtsHud[data-ready="true"]');
  assert.ok(await page.locator('#rtsHud').isVisible());
  assert.match(await page.locator('#rtsLiveState').innerText(),/LIVE|REPLAY/);
  assert.ok(await page.locator('#rtsActivity .rts-agent-row').count()>0);
  assert.ok(await page.locator('#rtsDecisionStrip .rts-decision-chip').count()>0);
  assert.ok(await page.locator('#rtsTelemetry').isVisible());
  assert.ok(Number(await page.locator('#rtsMetricPopulation').innerText())>=100);
  await page.locator('.rts-mode[data-mode="logistics"]').click();
  assert.equal(await page.locator('.rts-mode[data-mode="logistics"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.evaluate(()=>document.body.dataset.rtsMode),'logistics');
  await page.locator('.rts-mode[data-mode="security"]').click();
  assert.equal(await page.evaluate(()=>document.body.dataset.rtsMode),'security');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.ok(await page.locator('#rtsModeDeck').isVisible());
  assert.deepEqual(errors,[]);
  console.log('PASS: game-first RTS HUD, canonical activity roster, telemetry modes, mobile layout; zero page errors.');
}finally{await browser.close();}
