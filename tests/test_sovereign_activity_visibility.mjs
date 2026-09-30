import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui=fs.readFileSync(new URL('../site/sovereign-world.js',import.meta.url),'utf8');

test('observer activity rail keeps live canonical actions visible beside history',()=>{
  const start=ui.indexOf('function renderActivity(){');
  const end=ui.indexOf('\\nconst clamp=',start);
  const body=ui.slice(start,end);
  assert.match(body,/currentAction/);
  assert.match(body,/action-progress-fill/);
  assert.match(body,/significantHistory/);
  assert.doesNotMatch(body,/if\\(history\\.length\\).*return/);
});
