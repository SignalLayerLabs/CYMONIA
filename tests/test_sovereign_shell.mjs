import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('production shell is game-only and contains no legacy dashboard',()=>{
  const html=fs.readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
  assert.match(html,/id="worldCanvas"/);
  assert.match(html,/id="societyHistory"/);
  assert.match(html,/sovereign-world\.js/);
  for(const legacy of ['class="hud"','world-grid','analysis-grid','agents-panel','ledger-panel','researchView','participateView','protocolView']) assert.equal(html.includes(legacy),false,legacy);
});


test('Society History exposes emergent culture and era labels inside the game shell',()=>{
  const html=fs.readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
  const js=fs.readFileSync(new URL('../site/sovereign-world.js',import.meta.url),'utf8');
  assert.match(html,/<option value="culture">Culture<\/option>/);
  assert.match(js,/e\.era/);
  assert.match(js,/observerOnly|observer:/);
});
