import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../site/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../site/sovereign-world.css',import.meta.url),'utf8');

test('production shell is game-only and exposes Society History as overlay',()=>{
  assert.match(html,/id="worldCanvas"/);
  assert.match(html,/id="societyHistory"[^>]*game-window/);
  for(const legacy of ['world-grid','analysis-grid','agents-panel','ledger-panel','class="hud"'])assert.ok(!html.includes(legacy),legacy);
});

test('premium shell is viewport-locked rather than dashboard scroll',()=>{
  assert.match(css,/#game\s*\{[^}]*position:\s*fixed/s);
  assert.match(css,/overflow:\s*hidden/);
});
