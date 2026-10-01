import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui=fs.readFileSync(new URL('../site/sovereign-world.js',import.meta.url),'utf8');
const ci=fs.readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
const DIRECT='wss://cymonia-sovereign-world.signallayerlabs.workers.dev/stream';

test('Observer WebSocket bypasses Pages proxy and connects directly to sovereign Worker',()=>{
  assert.match(ui,/cymonia-sovereign-world\.signallayerlabs\.workers\.dev\/stream/);
  const socket=ui.slice(ui.indexOf('function createSocket'),ui.indexOf('function toast'));
  assert.ok(socket.includes(DIRECT));
  assert.ok(!socket.includes("new URL('/api/v2/stream'"));
});

test('production WebSocket CI validates the direct Worker transport',()=>{
  const start=ci.indexOf('Verify production WebSocket stability');
  assert.ok(start>=0);
  const section=ci.slice(start,start+5000);
  assert.ok(section.includes(DIRECT));
  assert.ok(!section.includes("new WebSocket('wss://cymonia.pages.dev/api/v2/stream')"));
});
