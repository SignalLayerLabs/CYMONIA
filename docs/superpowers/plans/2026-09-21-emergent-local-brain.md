# Emergent Local Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CYMONIA citizens autonomously develop evidence-backed multi-day behavior while Workers AI supplies rare persistent strategies under a fair neuron budget.

**Architecture:** Add a deterministic affordance planner and bounded local learning state behind the existing cognition boundary, then change Workers AI output from action lists to validated persistent strategies. Add a mergeable novelty queue, cognition-debt scheduler, and pure Neuron Governor whose token accounting wraps the existing AI binding without weakening physical or epistemic validation.

**Tech Stack:** JavaScript ES modules, Node.js built-in test runner, Cloudflare Durable Objects, Durable Object SQLite, Workers AI binding.

**Spec:** `docs/superpowers/specs/2026-09-21-emergent-local-brain-design.md`

## Global Constraints

- Preserve deterministic replay for identical world state, seed, and target time.
- Preserve epistemic validation: citizens may use only known concepts and entities.
- Preserve physical conservation, provenance, action validation, and the single-writer Durable Object.
- Add no runtime dependency or paid service.
- Workers AI model remains `@cf/zai-org/glm-4.7-flash` by default.
- Use `max_completion_tokens: 200`; do not use deprecated `max_tokens` for cognition.
- Normal/priority/human neuron ceilings are 8,000/9,000/9,500 per UTC day, leaving 500 neurons unallocated.
- Missing usage is charged conservatively, never as zero.
- Existing snapshots must migrate lazily without rewriting canonical history.
- AI absence must leave Tiers 0–2 fully operational.

## File structure

- Create `world/cognition-state.js`: bounded per-citizen local outcome learning, cooldowns, cognition debt, and lazy migration.
- Create `world/affordances.js`: pure affordance enumeration, scoring, stable tie-breaking, and short local proposal selection.
- Create `world/strategy.js`: AI strategy sanitization, validation, lifecycle, and legacy-goal compatibility.
- Create `world/cognition-queue.js`: novelty classification, queue merging, debt-aware ranking, and candidate consumption.
- Create `worker/src/neuron-governor.js`: model rate table, reservation, reconciliation, reset, and reserve-tier rules.
- Modify `world/cognition.js`: delegate local deliberation to affordances and expose strategy-aware context.
- Modify `world/engine.js`: record action outcomes, generate material novelty signals, age debt, and use mergeable queue entries.
- Modify `world/genesis.js` and `world/reproduction.js`: initialize new citizens with compatible cognition state and queue records.
- Modify `world/index.js`: export the new strategy and scheduler interfaces to the Worker.
- Modify `worker/src/index.js`: compact strategy prompt, usage extraction, fair queue selection, governor enforcement, and health reporting.
- Modify `tests/test_sovereign_engine_patch_upgrade.mjs` and `tests/test_sovereign_pixi_matter_upgrade.mjs`: portable file-URL conversion for worktrees whose paths contain spaces.
- Create focused `tests/test_sovereign_*.mjs` suites for each new boundary and update runtime contract assertions.
- Modify `README.md` and `docs/deployment-sovereign-world.md`: document autonomous cognition and budget configuration.

## Review Focus

- Old snapshots with no cognition-local state or old `activeGoal.actionTypes` must keep running and gain fields lazily; covered in Task 1 and Task 3 migration tests.
- A citizen with no valid affordance must fall back to OBSERVE/REST without throwing or inventing knowledge; covered in Task 2.
- Missing, nested, fractional, or malformed Workers AI usage must never undercharge the governor; covered in Task 5.
- Queue growth from repeated encounters/discoveries must remain bounded and no citizen may monopolize eligible AI slots; covered in Task 4.
- A strategy that references unknown concepts/partners or has expired must never influence local action; covered in Task 3.

---

### Task 1: Portable baseline and bounded cognition state

**Files:**
- Create: `world/cognition-state.js`
- Modify: `world/genesis.js`
- Modify: `world/reproduction.js`
- Modify: `tests/test_sovereign_engine_patch_upgrade.mjs`
- Modify: `tests/test_sovereign_pixi_matter_upgrade.mjs`
- Create: `tests/test_sovereign_cognition_state.mjs`

**Interfaces:**
- Produces: `ensureCognitionState(citizen, at) -> state`
- Produces: `recordAffordanceOutcome(citizen, family, result, at) -> state`
- Produces: `outcomeModifier(citizen, family, at) -> number`
- Produces: `ageCognitionDebt(citizen, deltaMinutes) -> number`
- Produces: `markAICognition(citizen, at) -> state`

- [ ] **Step 1: Make file URL tests portable**

Replace every `new URL(...).pathname` used as a filesystem path in the two failing suites with:

```js
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../scripts/patch_current_v2.mjs',import.meta.url));
```

Use the same conversion for the repository root in the Pixi/Matter suite.

- [ ] **Step 2: Verify the unmodified product baseline is green**

Run: `node --test tests/test_sovereign_*.mjs`

Expected: 108 tests pass, 0 fail. The Node module-type warning may remain because the repository intentionally has no package dependency manifest.

- [ ] **Step 3: Write failing cognition-state tests**

```js
test('legacy citizen state migrates lazily and debt is bounded',()=>{
  const w=createSovereignGenesis({seed:17,realEpochMs:0});
  const c=w.citizens[0];
  delete c.cognition.local;
  const state=ensureCognitionState(c,0);
  assert.equal(state.cognitionDebt,0);
  ageCognitionDebt(c,100_000);
  assert.equal(c.cognition.local.cognitionDebt,1);
});

test('recent failed affordance is penalized and later decays',()=>{
  const c=createSovereignGenesis({seed:17,realEpochMs:0}).citizens[0];
  recordAffordanceOutcome(c,'experiment',{ok:false,reason:'redundant'},100);
  assert.ok(outcomeModifier(c,'experiment',101)<0);
  assert.ok(outcomeModifier(c,'experiment',20_000)>outcomeModifier(c,'experiment',101));
});
```

Run: `node --test tests/test_sovereign_cognition_state.mjs`

Expected: FAIL because `world/cognition-state.js` does not exist.

- [ ] **Step 4: Implement bounded cognition state**

Use a lazy initializer with this stable shape:

```js
const clamp01=value=>Math.max(0,Math.min(1,Number(value)||0));

export function ensureCognitionState(citizen,at=0){
  citizen.cognition??={lastReflectionMinute:null,pending:true,reason:'migration'};
  citizen.cognition.local??={
    lastLocalChoiceMinute:null,lastOutcomeMinute:null,outcomes:{},cooldowns:{},
    cognitionDebt:0,lastAICognitionMinute:null,aiCognitionCount:0
  };
  return citizen.cognition.local;
}
```

Keep at most 24 outcome-family records and 48 cooldown keys. Aggregate attempts/successes/failures rather than appending history. Clamp debt to `[0,1]`; `markAICognition()` resets it and increments the accepted count.

- [ ] **Step 5: Initialize new citizens and run tests**

Use the same fields in Genesis, human avatars, and newborns while retaining lazy migration for persisted citizens.

Run: `node --test tests/test_sovereign_cognition_state.mjs tests/test_sovereign_genesis.mjs tests/test_sovereign_reproduction.mjs tests/test_sovereign_avatar.mjs`

Expected: all pass.

- [ ] **Step 6: Commit Task 1**

```bash
git add world/cognition-state.js world/genesis.js world/reproduction.js tests/test_sovereign_cognition_state.mjs tests/test_sovereign_engine_patch_upgrade.mjs tests/test_sovereign_pixi_matter_upgrade.mjs
git commit -m "feat: add bounded citizen cognition state"
```

### Task 2: Deterministic affordance planner

**Files:**
- Create: `world/affordances.js`
- Modify: `world/cognition.js`
- Modify: `world/engine.js`
- Create: `tests/test_sovereign_affordance_planner.mjs`

**Interfaces:**
- Consumes: `ensureCognitionState`, `outcomeModifier`, `recordAffordanceOutcome`
- Produces: `enumerateAffordances(world, citizen, at) -> Candidate[]`
- Produces: `scoreAffordance(world, citizen, candidate, at) -> number`
- Produces: `chooseAffordance(world, citizen, at) -> proposal|null`
- Candidate: `{family, proposal, utility, cooldownKey, novelty, effort}`

- [ ] **Step 1: Write failing enumeration and scoring tests**

```js
test('curious citizen gathers then experiments on an untested material',()=>{
  const w=createSovereignGenesis({seed:31,realEpochMs:0});
  const c=w.citizens[0],deposit=w.resourceDeposits.find(d=>d.type==='timber');
  c.position={...deposit.position};
  c.knownEntityIds.push(deposit.id);
  learn(c,resourceConceptId(deposit),{kind:'observation',eventId:'seen'});
  c.psychology.curiosity=1;
  const first=chooseAffordance(w,c,0);
  assert.equal(first.actions.at(-1).type,'GATHER');
  // Resolve the gathered-object fixture, then choose again.
  const object={id:'held:timber',kind:'gathered_material',material:deposit.type,quantity:1,massPerUnitKg:1,properties:null,holderId:c.id,position:{...c.position},condition:1,provenance:{type:'GATHERED',depositId:deposit.id}};
  w.objects.push(object);c.possessions.push(object.id);
  const second=chooseAffordance(w,c,30);
  assert.equal(second.actions[0].type,'EXPERIMENT');
});

test('invalid target is excluded and empty choice falls back safely',()=>{
  const w=createSovereignGenesis({seed:31,realEpochMs:0});
  const c=w.citizens[0];
  c.knownEntityIds=[c.id];
  c.body.sleepPressure=10;c.body.hydration=80;c.body.calories=80;
  const proposal=chooseAffordance(w,c,0);
  assert.ok(['MOVE','OBSERVE','REST'].includes(proposal.actions[0].type));
});
```

Add separate assertions proving that high social drive raises communication utility, high risk lowers unsafe exploration, trust raises transfer/teaching utility, distance lowers a candidate, and a recent failure/cooldown lowers immediate repetition.

Run: `node --test tests/test_sovereign_affordance_planner.mjs`

Expected: FAIL because the planner module does not exist.

- [ ] **Step 2: Implement affordance enumeration**

Generate candidates only from known and currently accessible state. Use family-specific builders for `explore`, `gather`, `experiment`, `transform`, `communicate`, `teach`, `care`, `transfer`, `cooperate`, `build`, and `rest`. Cooperation produces concrete `TRANSFER`, `COMMUNICATE`, or `BUILD` actions; do not add a new kernel action type.

Use experiment cooldown keys such as `experiment:${targetId}:${method}` and communication cooldown keys such as `communicate:${receiverId}:${conceptId}`. Detect the receiver knowledge gap from canonical receiver state, but expose only the sender-known concept in the resulting proposal.

- [ ] **Step 3: Implement normalized scoring and deterministic choice**

```js
export function chooseAffordance(world,citizen,at=world.clock.worldMinute){
  const candidates=enumerateAffordances(world,citizen,at);
  if(!candidates.length)return safeOrientationProposal(world,citizen,at);
  return candidates
    .map(candidate=>({...candidate,score:scoreAffordance(world,citizen,candidate,at)}))
    .sort((a,b)=>b.score-a.score||stableCandidateOrder(world,citizen,a,b,at))[0].proposal;
}
```

Clamp each factor before weighting. Stable tie-breaking must depend on seed, citizen ID, candidate family/key, and a coarse deterministic decision window, never `Math.random()` or real time.

- [ ] **Step 4: Route local deliberation and outcomes through the planner**

Keep `survivalFallback()` first. Replace the current MOVE/OBSERVE-dominant body of `localDeliberation()` with `chooseAffordance()`. In action resolution, call `recordAffordanceOutcome()` on success and failure using the originating plan's stored family metadata. Preserve the existing validation boundary and safe OBSERVE fallback.

- [ ] **Step 5: Run planner and action tests**

Run: `node --test tests/test_sovereign_affordance_planner.mjs tests/test_sovereign_local_deliberation.mjs tests/test_sovereign_action_effects.mjs tests/test_sovereign_artifacts.mjs tests/test_sovereign_language.mjs tests/test_sovereign_relationship_effects.mjs`

Expected: all pass; local choices include non-MOVE affordances under their tested conditions.

- [ ] **Step 6: Commit Task 2**

```bash
git add world/affordances.js world/cognition.js world/engine.js tests/test_sovereign_affordance_planner.mjs
git commit -m "feat: make local cognition affordance driven"
```

### Task 3: Persistent strategy lifecycle and compact AI contract

**Files:**
- Create: `world/strategy.js`
- Modify: `world/cognition.js`
- Modify: `world/engine.js`
- Modify: `world/index.js`
- Modify: `worker/src/index.js`
- Create: `tests/test_sovereign_strategy.mjs`
- Modify: `tests/test_sovereign_cognition.mjs`
- Modify: `tests/test_sovereign_runtime_contract.mjs`

**Interfaces:**
- Produces: `sanitizeAIStrategy(raw) -> Strategy`
- Produces: `validateStrategy(world, citizen, strategy, at) -> {ok, reason?}`
- Produces: `acceptAIStrategy(world, citizenId, strategy, at) -> Strategy`
- Produces: `activeStrategy(citizen, at) -> Strategy|null`
- Changes Worker `askAI(env, context) -> {strategy, usage}`

- [ ] **Step 1: Write failing strategy tests**

```js
test('strategy persists for days and references only known state',()=>{
  const w=createSovereignGenesis({seed:7,realEpochMs:0});
  const c=w.citizens[0];
  learn(c,'known-concept',{kind:'observation',eventId:'e'});
  const strategy=sanitizeAIStrategy({focus:'known-concept',intent:'understand',actionBias:['EXPERIMENT'],partnerIds:[],successSignals:['known-concept'],horizonMinutes:4320,confidence:.7});
  assert.equal(validateStrategy(w,c,strategy,0).ok,true);
  acceptAIStrategy(w,c.id,strategy,0);
  assert.equal(activeStrategy(c,2879)?.intent,'understand');
});

test('unknown partner, unknown concept, and expired strategy are inert',()=>{
  const w=createSovereignGenesis({seed:7,realEpochMs:0});
  const c=w.citizens[0];
  const invalid=sanitizeAIStrategy({focus:'forbidden',intent:'share',partnerIds:['stranger'],horizonMinutes:60});
  assert.equal(validateStrategy(w,c,invalid,0).ok,false);
  c.activeGoal={kind:'strategy-v1',createdWorldMinute:0,expiresWorldMinute:10,intent:'explore',actionBias:['OBSERVE']};
  assert.equal(activeStrategy(c,11),null);
});
```

Include a legacy test proving `{concepts, actionTypes}` still biases the Local Brain after migration.

Run: `node --test tests/test_sovereign_strategy.mjs`

Expected: FAIL because the strategy module does not exist.

- [ ] **Step 2: Implement strategy sanitize/validate/lifecycle**

Allow only the seven specified intents, known `ACTION_TYPES`, known partner IDs, known concepts, a horizon from 60 to 10,080 world minutes, and confidence `[0,1]`. Store `createdWorldMinute`, `expiresWorldMinute`, `source:'workers-ai'`, `progress`, and `failureCount`. Expiry clears the goal and records a lifecycle event only once.

- [ ] **Step 3: Make cognitive context strategy-aware and compact**

Replace full unbounded maps with stable bounded summaries: at most 32 active knowledge entries, 12 memories, 12 nearby entities, 12 possessions, 8 projects, 12 relationships, and 12 beliefs. Keep the static system instruction first and dynamic context second.

- [ ] **Step 4: Replace the Worker action prompt with strategy JSON**

Use a strict system contract matching:

```json
{"focus":"known-id","intent":"understand","actionBias":["EXPERIMENT"],"partnerIds":[],"successSignals":["known-id"],"horizonMinutes":4320,"confidence":0.7}
```

Call Workers AI with `max_completion_tokens:200`, `temperature:0.45`, and no deprecated `max_tokens`. Extract `usage` from `out.usage`, `out.result.usage`, or compatible nested response shapes. Return `{strategy,usage}` and keep parsing fenced JSON defensively.

- [ ] **Step 5: Use accepted strategies to bias repeated local decisions**

`scoreAffordance()` applies bounded boosts for intent, `actionBias`, focus concepts, partner IDs, and success signals. It must call `activeStrategy()` first so invalid or expired state contributes no score. Routine plan completion leaves the strategy active.

- [ ] **Step 6: Run cognition and Worker contract tests**

Run: `node --test tests/test_sovereign_strategy.mjs tests/test_sovereign_cognition.mjs tests/test_sovereign_runtime_contract.mjs tests/test_sovereign_local_deliberation.mjs`

Expected: all pass; runtime test asserts `max_completion_tokens:200`, absence of cognition `max_tokens`, and strategy rather than actions in the prompt.

- [ ] **Step 7: Commit Task 3**

```bash
git add world/strategy.js world/cognition.js world/engine.js world/index.js worker/src/index.js tests/test_sovereign_strategy.mjs tests/test_sovereign_cognition.mjs tests/test_sovereign_runtime_contract.mjs
git commit -m "feat: make AI cognition produce persistent strategies"
```

### Task 4: Mergeable novelty queue and fair scheduler

**Files:**
- Create: `world/cognition-queue.js`
- Modify: `world/engine.js`
- Modify: `world/genesis.js`
- Modify: `world/reproduction.js`
- Modify: `world/index.js`
- Modify: `worker/src/index.js`
- Create: `tests/test_sovereign_cognition_scheduler.mjs`

**Interfaces:**
- Produces: `queueCognition(world, citizen, reason, basePriority, at, eventId?) -> QueueEntry`
- Produces: `rankCognitionQueue(world, at) -> QueueEntry[]`
- Produces: `takeCognitionCandidate(world, at, allowedTier) -> QueueEntry|null`
- Produces: `classifyCognitionReason(reason) -> {tier, bonus, reserve}`

- [ ] **Step 1: Write failing bounded-queue and fairness tests**

```js
test('repeated discovery merges instead of growing the queue',()=>{
  const w=createSovereignGenesis({seed:9,realEpochMs:0});
  w.cognitionQueue=[];const c=w.citizens[0];
  queueCognition(w,c,'discovery',.6,10,'e1');
  queueCognition(w,c,'discovery',.6,20,'e2');
  assert.equal(w.cognitionQueue.length,1);
  assert.equal(w.cognitionQueue[0].occurrences,2);
});

test('debt eventually outranks a repeatedly served citizen',()=>{
  const w=createSovereignGenesis({seed:9,realEpochMs:0});
  const [old,frequent]=w.citizens;
  ensureCognitionState(old,0).cognitionDebt=.95;
  ensureCognitionState(frequent,0).cognitionDebt=.05;
  queueCognition(w,old,'novelty_unresolved',.5,100);
  queueCognition(w,frequent,'novelty_unresolved',.55,100);
  assert.equal(rankCognitionQueue(w,100)[0].citizenId,old.id);
});
```

Add tests for reason classes: routine/local-only, high priority, and human/emergency reserve.

Run: `node --test tests/test_sovereign_cognition_scheduler.mjs`

Expected: FAIL because the scheduler module does not exist.

- [ ] **Step 2: Implement queue merging and reason classification**

Merge on `citizenId + reason`, cap occurrences, retain first/last queued minute, and keep at most eight event IDs. Map routine plan completion and ordinary encounters to Tier 2/local-only. Map unresolved discovery, action failure, new concept, experiment success, relationship threshold change, conflict, care/reproduction, and construction completion to Tier 3 with bounded bonuses. Map `human_direction` and immediate danger to the final reserve.

- [ ] **Step 3: Implement debt-aware stable ranking**

Rank by base priority + debt + reason bonus + bounded occurrence novelty - recent-AI penalty - adequate-active-strategy penalty. Tie-break with first queued minute and citizen ID. Increase living citizens' debt from simulated elapsed minutes in `stepSegment()`; reset only after accepted AI cognition.

- [ ] **Step 4: Replace direct queue pushes everywhere**

Use `queueCognition()` in Genesis, newborn creation, encounters, discoveries, failures, plan completion, human direction, and material events. Ensure local-only entries are consumed locally or omitted from the AI queue. Keep old persisted entry shapes readable by normalizing them lazily.

- [ ] **Step 5: Route Worker cognition through the scheduler**

Replace in-place priority sort/shift with `takeCognitionCandidate()`. Requeue failures through the merge API with cooldown metadata. `processCognition(1)` remains the per-alarm concurrency bound; fairness changes who is selected, not the number of simultaneous inferences.

- [ ] **Step 6: Run scheduler and engine tests**

Run: `node --test tests/test_sovereign_cognition_scheduler.mjs tests/test_sovereign_engine.mjs tests/test_sovereign_reproduction.mjs tests/test_sovereign_runtime_contract.mjs`

Expected: all pass and a 100-citizen scheduling fixture serves every eligible citizen before repeat service when priorities are otherwise equal.

- [ ] **Step 7: Commit Task 4**

```bash
git add world/cognition-queue.js world/engine.js world/genesis.js world/reproduction.js world/index.js worker/src/index.js tests/test_sovereign_cognition_scheduler.mjs tests/test_sovereign_runtime_contract.mjs
git commit -m "feat: schedule novelty cognition fairly"
```

### Task 5: Neuron Governor and production accounting

**Files:**
- Create: `worker/src/neuron-governor.js`
- Modify: `worker/src/index.js`
- Create: `tests/test_sovereign_neuron_governor.mjs`
- Modify: `tests/test_sovereign_runtime_contract.mjs`

**Interfaces:**
- Produces: `MODEL_NEURON_RATES`
- Produces: `ensureNeuronBudget(world, nowMs) -> budget`
- Produces: `estimateReservation(model, context, maxCompletionTokens, rates?) -> number`
- Produces: `reserveNeurons(budget, amount, reserveClass) -> {ok, reason?, reservation?}`
- Produces: `reconcileNeurons(budget, reservation, usage, model, rates?) -> {charged, warning?}`
- Produces: `neuronCapacity(budget, reserveClass) -> number`

- [ ] **Step 1: Write failing governor tests**

```js
test('GLM token usage converts to documented neurons',()=>{
  const budget={day:'2026-09-21',usedNeurons:0,reservedNeurons:0,calls:0,promptTokens:0,completionTokens:0,lastFailureRealMs:0,lastExhaustedDay:null};
  const reservation=reserveNeurons(budget,20,'normal').reservation;
  const result=reconcileNeurons(budget,reservation,{prompt_tokens:1000,completion_tokens:200},'@cf/zai-org/glm-4.7-flash');
  assert.equal(result.charged,12.78); // 5.5 input + 7.28 output
});

test('normal work cannot consume priority or human reserves',()=>{
  const budget={day:'2026-09-21',usedNeurons:7999,reservedNeurons:0,calls:0,promptTokens:0,completionTokens:0,lastFailureRealMs:0,lastExhaustedDay:null};
  assert.equal(reserveNeurons(budget,2,'normal').ok,false);
  assert.equal(reserveNeurons(budget,2,'priority').ok,true);
});

test('missing usage charges reservation and unknown model fails closed',()=>{
  const budget={day:'2026-09-21',usedNeurons:0,reservedNeurons:0,calls:0,promptTokens:0,completionTokens:0,lastFailureRealMs:0,lastExhaustedDay:null};
  const held=reserveNeurons(budget,25,'normal').reservation;
  assert.equal(reconcileNeurons(budget,held,null,'@cf/zai-org/glm-4.7-flash').charged,25);
  assert.equal(estimateReservation('@cf/unknown/model','{}',200),Infinity);
});
```

Add UTC reset, malformed/fractional/negative/nested usage, hard-stop, over-reservation, and reconciliation-above-reservation tests.

Run: `node --test tests/test_sovereign_neuron_governor.mjs`

Expected: FAIL because the governor module does not exist.

- [ ] **Step 2: Implement pure governor functions**

Use rates `{inputPerMillion:5500, outputPerMillion:36400}` for GLM-4.7-Flash. Compute neurons as a floating-point value and round upward only for admission decisions; retain precise totals for observability. Estimate prompt tokens conservatively as `Math.ceil(serializedLength/3)` and completion at the full configured cap. Enforce 8,000/9,000/9,500 ceilings by reserve class.

- [ ] **Step 3: Migrate runtime budget and wrap every inference**

Replace `AI_CALLS_PER_REAL_DAY` admission with:

```js
const estimate=estimateReservation(model,JSON.stringify(context),MAX_COMPLETION_TOKENS);
const admission=reserveNeurons(budget,estimate,reserveClass);
if(!admission.ok)return deferForBudget(item,admission.reason);
try{
  const {strategy,usage}=await askAI(this.env,context);
  reconcileNeurons(budget,admission.reservation,usage,model);
  acceptAIStrategy(this.world,c.id,strategy,this.world.clock.worldMinute);
}catch(error){
  reconcileNeurons(budget,admission.reservation,null,model);
  throw error;
}
```

Avoid double reconciliation by tracking reservation state. Calls and token totals remain metrics, not admission limits. Keep retry cooldown and a once-per-day exhaustion ledger event.

- [ ] **Step 4: Expose safe health metrics**

Return day, used/reserved neurons, prompt/completion tokens, calls, soft/high/hard limits, available capacity per reserve class, model rate ID, and last accounting warning. Remove the call-limit field and do not return prompts, context, or private strategy text.

- [ ] **Step 5: Run governor and Worker tests**

Run: `node --test tests/test_sovereign_neuron_governor.mjs tests/test_sovereign_runtime_contract.mjs tests/test_sovereign_persistence.mjs tests/test_sovereign_persistence_budget.mjs`

Expected: all pass; runtime source has no `AI_CALLS_PER_REAL_DAY`, cognition `max_tokens`, or zero-charge missing-usage path.

- [ ] **Step 6: Commit Task 5**

```bash
git add worker/src/neuron-governor.js worker/src/index.js tests/test_sovereign_neuron_governor.mjs tests/test_sovereign_runtime_contract.mjs
git commit -m "feat: govern Workers AI by measured neurons"
```

### Task 6: End-to-end emergence, documentation, and release

**Files:**
- Create: `tests/test_sovereign_emergent_chain.mjs`
- Modify: `README.md`
- Modify: `docs/deployment-sovereign-world.md`
- Modify: `MANIFEST.sha256`

**Interfaces:**
- Consumes all prior task interfaces.
- Produces a reproducible acceptance scenario and release documentation.

- [ ] **Step 1: Write the deterministic no-AI emergence test**

Construct a small deterministic world fixture from Genesis, position two citizens near timber and
clay, give neither an AI strategy, and advance only through `advanceWorldTo()`. Assert material
events rather than exact minute-by-minute action order:

```js
assert.ok(types.has('RESOURCE_GATHERED'));
assert.ok(types.has('EXPERIMENT_COMPLETED'));
assert.ok(types.has('SIGNAL_COINED'));
assert.ok(types.has('COMMUNICATION'));
assert.ok(receiver.knowledge.some(k=>k.provenance.some(p=>p.kind==='communication')));
assert.ok(types.has('CONSTRUCTION_STARTED'));
assert.ok(types.has('BUILDING_COMPLETED'));
assert.equal(aiCalls,0);
```

The fixture may tune psychology, positions, resources, and elapsed time, but must not set an active
goal containing BUILD or name a house/design outcome.

Run: `node --test tests/test_sovereign_emergent_chain.mjs`

Expected: FAIL at the first missing causal event until integration is complete.

- [ ] **Step 2: Close only integration gaps exposed by the acceptance test**

Adjust only named planner constants and hooks, without hard-coding the expected sequence or a
structure type. Keep the tuning surface explicit:

```js
export const AFFORDANCE_WEIGHTS=Object.freeze({
  need:1, strategy:.55, curiosity:.45, social:.4, relationship:.3,
  inventoryFit:.35, knowledgeGap:.5, novelty:.4, effort:-.25,
  risk:-.3, cooldown:-.8, outcome:.35
});
```

Material action resolution must call `recordAffordanceOutcome()` and enqueue only material novelty
through `queueCognition()`. Re-run after each change until all causal event assertions pass for two
repeated runs with identical ledger heads.

- [ ] **Step 3: Document the shipped cognition economy**

README must explain the four tiers, persistent strategies, deterministic emergence, and that AI is
novelty-only. Deployment docs must list optional environment overrides for neuron limits/rates,
UTC reset behavior, missing-usage conservative charging, and `/health` fields. Cite the official
Cloudflare pricing/model/prompt-caching URLs from the spec and date numeric assumptions.

- [ ] **Step 4: Regenerate integrity manifest**

Regenerate the manifest from tracked and newly created non-ignored files, excluding the manifest
itself:

```bash
git ls-files -co --exclude-standard -z | LC_ALL=C sort -z | while IFS= read -r -d '' file; do
  if [[ "$file" != "MANIFEST.sha256" ]]; then shasum -a 256 "$file"; fi
done > MANIFEST.sha256
```

Then run `bash CHECK.sh . --skip-browser` to verify every listed digest.

- [ ] **Step 5: Run focused and full verification**

Run:

```bash
node --test tests/test_sovereign_affordance_planner.mjs tests/test_sovereign_cognition_state.mjs tests/test_sovereign_strategy.mjs tests/test_sovereign_cognition_scheduler.mjs tests/test_sovereign_neuron_governor.mjs tests/test_sovereign_emergent_chain.mjs
node --test tests/test_sovereign_*.mjs
bash CHECK.sh
git diff --check origin/main...HEAD
```

Expected: every command exits 0; full Node test summary has 0 failures; the acceptance run is deterministic.

- [ ] **Step 6: Commit documentation and acceptance coverage**

```bash
git add tests/test_sovereign_emergent_chain.mjs README.md docs/deployment-sovereign-world.md MANIFEST.sha256
git commit -m "docs: explain autonomous cognition economy"
```

- [ ] **Step 7: Review the whole branch**

Inspect `git diff --stat origin/main...HEAD`, `git diff --check`, runtime source for obsolete call-limit
symbols, and the full tests. Confirm no credentials, generated dependency trees, private prompts,
or unrelated observer changes are included.

- [ ] **Step 8: Publish and open the pull request**

```bash
git push -u origin codex/emergent-local-brain
gh pr create --base main --head codex/emergent-local-brain --title "feat: accelerate emergent local cognition" --body-file /tmp/cymonia-emergent-local-brain-pr.md
```

The PR body must summarize behavior, neuron accounting, compatibility, Cloudflare assumptions,
test evidence, and the pre-existing test-path portability fix. Attach the resulting PR to the
Codex task.
