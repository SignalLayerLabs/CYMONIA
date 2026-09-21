import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync(new URL('../worker/src/index.js',import.meta.url),'utf8');
const governor=fs.readFileSync(new URL('../worker/src/neuron-governor.js',import.meta.url),'utf8');
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

test('constructor never postpones a due alarm and alarm handler keeps the schedule alive',()=>{
  assert.match(worker,/const ALARM_MS=60_000/);

  const ensureStart=worker.indexOf('async ensureAlarm(){');
  const ensureEnd=worker.indexOf('persist(options={})',ensureStart);
  const ensure=worker.slice(ensureStart,ensureEnd);

  assert.match(ensure,/getAlarm\(\)/);
  assert.match(ensure,/current===null/);
  assert.match(ensure,/setAlarm\(Date\.now\(\)\+ALARM_MS\)/);
  assert.doesNotMatch(ensure,/current\s*<\s*Date\.now\(\)/);

  const tickStart=worker.indexOf('async tick(){');
  const tickEnd=worker.indexOf('async alarm(){',tickStart);
  const tick=worker.slice(tickStart,tickEnd);

  assert.doesNotMatch(tick,/ensureAlarm/);
  assert.doesNotMatch(tick,/setAlarm/);

  const alarmStart=worker.indexOf('async alarm(){');
  const alarmEnd=worker.indexOf('async processCognition',alarmStart);
  const alarm=worker.slice(alarmStart,alarmEnd);

  assert.match(alarm,/await this\.tick\(\)/);
  assert.match(alarm,/finally/);
  assert.match(alarm,/setAlarm\(Date\.now\(\)\+ALARM_MS\)/);
});
test('runtime recovery is persisted immediately before hibernation can discard the rebase',()=>{
  const tickStart=worker.indexOf('async tick(){');
  const tickEnd=worker.indexOf('async alarm(){',tickStart);
  const tick=worker.slice(tickStart,tickEnd);

  assert.match(tick,/progress\.recovered/);
  assert.match(tick,/persist\(\{forceSeal:true\}\)/);

  const recoveryIndex=tick.indexOf('progress.recovered');
  const checkpointIndex=tick.indexOf('checkpointDue',recoveryIndex);

  assert.ok(recoveryIndex>=0);
  assert.ok(checkpointIndex>recoveryIndex);
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

test('Workers AI cognition is governed by measured neurons, not call count',()=>{
  assert.doesNotMatch(worker,/AI_CALLS_PER_REAL_DAY/);
  assert.match(worker,/ensureNeuronBudget/);
  assert.match(worker,/reserveNeurons/);
  assert.match(worker,/reconcileNeurons/);
  assert.match(worker,/neuron_budget_exhausted/);
  assert.match(worker,/processCognition\(1\)/);
  assert.doesNotMatch(worker,/processCognition\(2\)/);
});

test('health exposes safe neuron accounting without prompts or strategy text',()=>{
  const start=worker.indexOf("if(request.method==='GET'&&path==='/health')");
  const end=worker.indexOf("if(request.method==='GET'&&path==='/state')",start);
  const health=worker.slice(start,end);
  assert.match(health,/used_neurons/);
  assert.match(health,/prompt_tokens/);
  assert.match(health,/completion_tokens/);
  assert.match(health,/soft_limit/);
  assert.match(health,/high_priority_limit/);
  assert.match(health,/hard_limit/);
  assert.match(health,/model_rate_id/);
  assert.match(governor,/AI_NEURON_SOFT_LIMIT/);
  assert.match(governor,/AI_INPUT_NEURONS_PER_MILLION/);
  assert.doesNotMatch(health,/dailyLimit|prompt:|context:|strategy:/);
});

test('Workers AI selects cognition through the fair novelty scheduler',()=>{
  const start=worker.indexOf('async processCognition');
  const end=worker.indexOf('websocketMeta',start);
  const process=worker.slice(start,end);
  assert.match(process,/takeCognitionCandidate/);
  assert.match(process,/queueCognition/);
  assert.doesNotMatch(process,/\.sort\(\(a,b\)=>b\.priority-a\.priority\)/);
});

test('public state reads never run mutation or Workers AI before responding',()=>{
  const fetchBody=worker.slice(worker.indexOf('async fetch(request){'),worker.indexOf('\n  }\n}',worker.indexOf('async fetch(request){')));
  const readPrelude=fetchBody.slice(0,fetchBody.indexOf("if(request.headers.get('upgrade')"));
  assert.doesNotMatch(readPrelude,/tick\(|advanceWorldTo\(|persist\(/);
  assert.match(worker,/AI_CALL_TIMEOUT_MS/);
  assert.match(worker,/advanceWorldBounded/);
  assert.doesNotMatch(worker,/sovereign-world-router/);
});

test('AI schema supplies strategic intent while local cognition owns concrete primitives',()=>{
  assert.match(worker,/explore\|understand\|share\|cooperate\|care\|construct\|adapt/);
  assert.match(worker,/actionBias/);
  assert.match(worker,/horizonMinutes/);
});

test('Workers AI emits compact persistent strategies instead of short action scripts',()=>{
  const askStart=worker.indexOf('async function askAI');
  const askEnd=worker.indexOf('async function withTimeout',askStart);
  const ask=worker.slice(askStart,askEnd);
  assert.match(worker,/const MAX_COMPLETION_TOKENS=200/);
  assert.match(ask,/max_completion_tokens:MAX_COMPLETION_TOKENS/);
  assert.match(ask,/"intent"/);
  assert.match(ask,/"actionBias"/);
  assert.match(ask,/usage/);
  assert.doesNotMatch(ask,/max_tokens/);
  assert.doesNotMatch(ask,/"actions"/);
});
