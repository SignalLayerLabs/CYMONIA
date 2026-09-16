import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({headless:true});
const url = process.env.CYMONIA_URL || 'http://127.0.0.1:8765';

const page = await browser.newPage({
  viewport:{width:1440,height:900}
});

const pageErrors=[];
page.on('pageerror',e=>pageErrors.push(e.message));

await page.route('https://cdn.jsdelivr.net/**',async route=>{
  await route.fulfill({
    status:200,
    contentType:'application/javascript',
    body:''
  });
});

await page.route('**/api/v2/state',async route=>{
  await route.fulfill({
    status:500,
    contentType:'application/json',
    body:JSON.stringify({
      ok:false,
      error:'backend_unavailable'
    })
  });
});

try{
  await page.goto(`${url}/`,{
    waitUntil:'domcontentloaded',
    timeout:15000
  });

  await page.waitForFunction(
    ()=>document.querySelector('#populationValue')?.textContent==='100',
    null,
    {timeout:10000}
  );

  await page.waitForTimeout(1500);

  const result=await page.evaluate(()=>{
    const rendered=
      typeof window.render_game_to_text==='function'
        ? JSON.parse(window.render_game_to_text())
        : null;

    const canvas=document.querySelector('#miniMap');
    const ctx=canvas?.getContext('2d');

    let painted=false;

    if(canvas&&ctx){
      const pixels=ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      ).data;

      for(let i=3;i<pixels.length;i+=4){
        if(pixels[i]>0){
          painted=true;
          break;
        }
      }
    }

    return {
      population:document.querySelector('#populationValue')?.textContent,
      mode:document.querySelector('.truth-badge')?.dataset.mode,
      loader:document.querySelector('#worldLoader')?.className,
      rendered,
      painted
    };
  });

  assert.equal(result.population,'100');
  assert.equal(result.mode,'REPLAY');
  assert.equal(result.rendered.mode,'REPLAY');
  assert.equal(result.rendered.worldMinute,0);
  assert.equal(result.rendered.citizens.length,100);
  assert.ok(result.loader.includes('ready'));
  assert.equal(result.painted,true);
  assert.deepEqual(pageErrors,[]);

  console.log(
    'PASS: API outage -> frozen REPLAY, retry alive, 100 Citizens and painted minimap.'
  );
}finally{
  await browser.close();
}
