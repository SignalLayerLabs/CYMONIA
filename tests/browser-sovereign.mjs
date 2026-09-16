import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
const url=process.env.CYMONIA_URL||'http://127.0.0.1:8765';
const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
let stateCalls=0;const epoch=Date.now()-10_200;
const liveWorld={version:2,worldId:'sovereign-20260915',clock:{worldMinute:10,realEpochMs:epoch},environment:{temperatureC:18,precipitation:.12,dayPhase:.4,seasonPhase:.2},citizens:[{id:'genesis:001',kind:'GENESIS',selfName:null,observerDisplayName:null,alive:true,position:{x:10,y:10},birthWorldMinute:-10000000,deathWorldMinute:null,body:{hydration:80,calories:80,sleepPressure:20,health:100,ageMinutes:12000000,diseases:0,injuries:0},psychology:{curiosity:.7,empathy:.6},knowledge:[],language:{primitiveSignals:['attention'],lexicon:{}},knownEntityIds:['genesis:001'],relationships:{},possessions:[],activeGoal:null,currentAction:{id:'act:test',type:'MOVE',purpose:'explore',startedWorldMinute:10,endsWorldMinute:14,fromPosition:{x:10,y:10},targetPosition:{x:18,y:10},targetId:null}}],objects:[],resourceDeposits:[{id:'water',type:'water',quantity:1000,position:{x:44,y:48}},{id:'wood',type:'timber',quantity:1000,position:{x:61,y:54}}],buildings:[],organizations:[],claims:[],projects:[],history:[],ledgerHead:'test'};
await page.route('**/api/v2/state',async route=>{stateCalls++;if(stateCalls===1)await route.fulfill({status:503,contentType:'application/json',body:'{"ok":false}'});else await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,world:liveWorld})});});
try{
  await page.goto(url+'/');await page.waitForSelector('#worldCanvas');await page.waitForFunction(()=>document.querySelector('#populationValue')?.textContent!=='—');
  assert.equal(await page.locator('.hud,.world-grid,.analysis-grid,.agents-panel,.ledger-panel,#researchView,#participateView,#protocolView').count(),0);
  assert.ok(await page.locator('#worldCanvas').isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight+2),false);
  await page.waitForFunction(()=>document.querySelector('.truth-badge')?.dataset.mode==='LIVE',{timeout:6000});assert.ok(stateCalls>=2,'client must retry canonical state without reload');
  const before=JSON.parse(await page.evaluate(()=>window.render_game_to_text())).citizens[0].x;await page.waitForTimeout(350);const after=JSON.parse(await page.evaluate(()=>window.render_game_to_text())).citizens[0].x;assert.ok(after>before,`expected fractional canonical motion: ${before} -> ${after}`);
  await page.locator('#historyOpen').click();assert.ok(await page.locator('#societyHistory').isVisible());assert.ok(await page.locator('#worldCanvas').isVisible());await page.locator('#historyClose').click();assert.equal(await page.locator('#societyHistory').isVisible(),false);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log('PASS: reconnect recovery, fractional canonical movement, game-only shell, in-game history, mobile containment; zero page errors.');
}finally{await browser.close();}
