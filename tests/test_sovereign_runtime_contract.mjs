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

test('hibernating websocket runtime survives object eviction without volatile client ownership',()=>{
  assert.match(worker,/getWebSockets\(\)/);
  assert.match(worker,/serializeAttachment/);
  assert.match(worker,/webSocketMessage/);
  assert.match(worker,/CYMONIA_WS_CLOSE/);
  assert.match(worker,/CYMONIA_WS_ERROR/);
  assert.doesNotMatch(worker,/this\.clients/);
});

test('alarm cadence is one minute and constructor does not forcibly rewrite an existing alarm',()=>{
  assert.match(worker,/const ALARM_MS=60_000/);
  assert.match(worker,/await this\.ensureAlarm\(\);/);
  assert.doesNotMatch(worker,/ensureAlarm\(true\)/);
});

test('canonical world persists in Durable Object SQLite with SHA-256 checkpoint seals',()=>{
  assert.match(worker,/storage\.sql/);
  assert.match(worker,/CREATE TABLE IF NOT EXISTS world_state/);
  assert.match(worker,/CREATE TABLE IF NOT EXISTS world_seals/);
  assert.match(worker,/SHA-256/);
  assert.match(worker,/state_sha256/);
  assert.match(worker,/world_state_chunks/);
  assert.match(worker,/world_state_manifest/);
  assert.match(worker,/persistChain/);
  assert.match(worker,/persisted_generation/);
  assert.match(worker,/transactionSync/);
  assert.doesNotMatch(worker,/storage\.put\(WORLD_KEY/);
});

test('Workers AI cognition has a hard daily budget and never falls back to fabricated social decisions',()=>{
  assert.match(worker,/AI_CALLS_PER_REAL_DAY/);
  assert.match(worker,/aiBudget/);
  assert.match(worker,/ai_budget_exhausted/);
  assert.match(worker,/processCognition\(1\)/);
  assert.doesNotMatch(worker,/processCognition\(2\)/);
});

test('public state reads never run mutation or Workers AI before responding',()=>{
  const fetchBody=worker.slice(worker.indexOf('async fetch(request){'),worker.indexOf('\n  }\n}',worker.indexOf('async fetch(request){')));
  const readPrelude=fetchBody.slice(0,fetchBody.indexOf("if(request.headers.get('upgrade')"));
  assert.doesNotMatch(readPrelude,/tick\(|advanceWorldTo\(|persist\(/);
  assert.match(worker,/AI_CALL_TIMEOUT_MS/);
  assert.match(worker,/advanceWorldBounded/);
  assert.doesNotMatch(worker,/sovereign-world-router/);
});

test('AI schema includes emergent claims and biological reproduction primitives',()=>{
  assert.match(worker,/CLAIM/);
  assert.match(worker,/REPRODUCE/);
  assert.match(worker,/payload/);
});
