import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui=fs.readFileSync(new URL('../site/sovereign-world.js',import.meta.url),'utf8');
const ci=fs.readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');

test('production Observer uses canonical REST polling and does not require WebSocket transport',()=>{
  const boot=ui.slice(ui.indexOf('state.connection=new ObserverConnection'),ui.indexOf('await state.connection.start()')+40);
  assert.match(boot,/createSocket:null/);
  assert.match(boot,/pollMs:10000/);
  assert.match(boot,/fetchState:async/);
  assert.match(boot,/\/api\/v2\/state/);
});

test('production CI validates Observer polling instead of gating deploy on WebSocket stability',()=>{
  assert.match(ci,/Verify production Observer polling continuity/);
  assert.doesNotMatch(ci,/Verify production WebSocket stability/);
  assert.doesNotMatch(ci,/new WebSocket\(/);
});
