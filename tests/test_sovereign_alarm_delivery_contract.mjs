import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync(new URL('../worker/src/index.js',import.meta.url),'utf8');
const ci=fs.readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');

test('HTTP polling preserves due alarms until a durable stale-recovery threshold',()=>{
  const start=worker.indexOf('async ensureAlarm(){');
  const end=worker.indexOf('\n  persist(',start);
  assert.ok(start>=0&&end>start);
  const block=worker.slice(start,end);

  assert.match(block,/if\(current===null\)/);
  assert.match(block,/setAlarm\(current\)/);
  assert.doesNotMatch(block,/current<now-2\*ALARM_MS/);
  assert.match(block,/STALE_ALARM_MS/);
  assert.match(block,/ALARM_REARM_COOLDOWN_MS/);
  assert.match(block,/cymonia:alarm_rearm_ms/);
  assert.match(block,/overdue_alarm_preserved/);
});

test('production CI gives alarms quiet delivery windows instead of 2-second polling pressure',()=>{
  assert.doesNotMatch(ci,/for i in \$\(seq 1 75\)/);
  assert.doesNotMatch(ci,/for i in \$\(seq 1 45\)/);
  assert.ok((ci.match(/sleep 75/g)||[]).length>=2);
  assert.match(ci,/sleep 75/);
  assert.match(ci,/canonical world minute did not advance/);
  assert.match(ci,/canonical snapshot was not persisted within checkpoint window/);
});
