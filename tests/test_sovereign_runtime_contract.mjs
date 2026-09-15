import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync(new URL('../worker/src/index.js',import.meta.url),'utf8');
const cfg=fs.readFileSync(new URL('../wrangler.world.toml',import.meta.url),'utf8');

test('Durable Object runtime declares single writer, alarms, websocket and AI binding',()=>{
  assert.match(worker,/class SovereignWorld/);
  assert.match(worker,/setAlarm/);
  assert.match(worker,/acceptWebSocket|WebSocketPair/);
  assert.match(cfg,/new_sqlite_classes/);
  assert.match(cfg,/binding = "AI"/);
});

test('canonical world persists in Durable Object SQLite with SHA-256 checkpoint seals',()=>{
  assert.match(worker,/storage\.sql/);
  assert.match(worker,/CREATE TABLE IF NOT EXISTS world_state/);
  assert.match(worker,/CREATE TABLE IF NOT EXISTS world_seals/);
  assert.match(worker,/SHA-256/);
  assert.match(worker,/state_sha256/);
  assert.doesNotMatch(worker,/storage\.put\(WORLD_KEY/);
});

test('Workers AI cognition has a hard daily budget and never falls back to fabricated social decisions',()=>{
  assert.match(worker,/AI_CALLS_PER_REAL_DAY/);
  assert.match(worker,/aiBudget/);
  assert.match(worker,/ai_budget_exhausted/);
  assert.match(worker,/processCognition\(1\)/);
  assert.doesNotMatch(worker,/processCognition\(2\)/);
});

test('AI schema includes emergent claims and biological reproduction primitives',()=>{
  assert.match(worker,/CLAIM/);
  assert.match(worker,/REPRODUCE/);
  assert.match(worker,/payload/);
});
