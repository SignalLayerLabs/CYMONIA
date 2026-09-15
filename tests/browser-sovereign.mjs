import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
const url=process.env.CYMONIA_URL||'http://127.0.0.1:8765';
const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(url+'/');
  await page.waitForSelector('#worldCanvas');
  await page.waitForFunction(()=>document.querySelector('#populationValue')?.textContent!=='—');
  assert.equal(await page.locator('.hud,.world-grid,.analysis-grid,.agents-panel,.ledger-panel,#researchView,#participateView,#protocolView').count(),0);
  assert.ok(await page.locator('#worldCanvas').isVisible());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight+2),false);
  await page.locator('#historyOpen').click();
  assert.ok(await page.locator('#societyHistory').isVisible());
  assert.ok(await page.locator('#worldCanvas').isVisible());
  await page.locator('#historyClose').click();
  assert.equal(await page.locator('#societyHistory').isVisible(),false);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: game-only world shell, in-game history, no legacy dashboard, mobile containment; zero page errors.');
}finally{await browser.close();}
