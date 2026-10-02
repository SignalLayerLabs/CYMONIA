import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync(new URL('../worker/src/index.js',import.meta.url),'utf8');
const governor=fs.readFileSync(new URL('../worker/src/neuron-governor.js',import.meta.url),'utf8');
const persistence=fs.readFileSync(new URL('../worker/src/persistence.js',import.meta.url),'utf8');
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

test('canonical world persists in Durable Object SQLite with SHA-256 checkpoint seals',()=>{
  assert.match(worker,/storage\.sql/);
  assert.match(worker,/CREATE TABLE IF NOT EXISTS world_state/);
  assert.match(worker,/CREATE TABLE IF NOT EXISTS world_seals/);
  assert.match(worker,/encodeWorldSnapshotParts\(this\.world/);
  assert.match(persistence,/SHA-256/);
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
  assert.match(worker,/programBlueprints/);
  assert.match(worker,/Programs never bypass the sovereign kernel/);
});

test('Workers AI emits compact persistent strategies instead of short action scripts',()=>{
  const askStart=worker.indexOf('async function askAI');
  const askEnd=worker.indexOf('async function withTimeout',askStart);
  const ask=worker.slice(askStart,askEnd);
  assert.match(worker,/const MAX_COMPLETION_TOKENS=200/);
  assert.match(ask,/max_completion_tokens:MAX_COMPLETION_TOKENS/);
  assert.match(worker,/"intent"/);
  assert.match(worker,/"actionBias"/);
  assert.match(ask,/usage/);
  assert.doesNotMatch(ask,/max_tokens/);
  assert.doesNotMatch(ask,/"actions"/);
});

test('neuron reservation includes the same static system prompt sent to Workers AI',()=>{
  const start=worker.indexOf('async processCognition');
  const end=worker.indexOf('websocketMeta',start);
  const process=worker.slice(start,end);
  assert.match(worker,/const AI_SYSTEM_PROMPT=/);
  assert.match(worker,/function serializeAIPrompt/);
  assert.match(worker,/serializeAIPrompt\(context\).*content:JSON\.stringify\(context\)/);
  assert.match(askAIBlock(),/content:AI_SYSTEM_PROMPT/);
  assert.match(process,/estimateReservation\(model,serializeAIPrompt\(context\)/);
});

function askAIBlock(){
  const start=worker.indexOf('async function askAI');
  const end=worker.indexOf('async function withTimeout',start);
  return worker.slice(start,end);
}


test('monotonic clock guard prevents loading older snapshots and exposes recovery state',()=>{
  assert.match(worker,/world_clock_guard/);assert.match(worker,/world_snapshot_slots/);
  assert.match(worker,/assertMonotonicSnapshot\(world,\{highWaterMark/);
  assert.match(worker,/sovereign_world_clock_regression/);assert.match(worker,/clock_high_water_mark/);assert.match(worker,/loaded_snapshot_minute/);
  assert.match(worker,/clock_regression_detected/);assert.match(worker,/snapshot_recovery_source/);
});


test('heartbeat broadcasts after cognition processing',()=>{
  const start=worker.indexOf('async tick(');
  const end=worker.indexOf('async alarm(',start);
  const tick=worker.slice(start,end);
  const cognition=tick.indexOf('processCognition(1)');
  const broadcast=tick.lastIndexOf("broadcastWorldSignal('world_signal')");
  assert.ok(cognition>=0);
  assert.ok(broadcast>cognition);
});

test('health exposes physical emergence diagnostics',()=>{
  const start=worker.indexOf("if(request.method==='GET'&&path==='/health')");
  const end=worker.indexOf("if(request.method==='GET'&&path==='/state')",start);
  const health=worker.slice(start,end);
  assert.match(health,/moving_citizens/);
  assert.match(health,/outside_center_20/);
  assert.match(health,/construction_projects/);
  assert.match(health,/active_actions/);
});

test('production memory model keeps one canonical graph and separates private checkpoint buffers from public projection',()=>{
  assert.match(worker,/memory_model:'single-canonical-streamed-checkpoint-lazy-public-v2'/);
  assert.match(worker,/loadCommittedWorldFromStorage/);
  assert.match(worker,/this\.committedWorld=null/);
  assert.match(worker,/this\.committedSnapshot=null/);
  assert.doesNotMatch(worker,/committedReader\(/);
  assert.match(worker,/committedStats/);
  assert.match(worker,/committedCausalReader/);
  assert.match(worker,/async writeCanonicalSnapshot/);
  assert.match(worker,/async refreshPublicSnapshot/);
  assert.match(worker,/CYMONIA_PUBLIC_SNAPSHOT_REFRESH_FAILED/);
});
