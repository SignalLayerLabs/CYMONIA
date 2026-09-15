# CYMONIA v2 Sovereign World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard-centric scripted prototype with a persistent game-only artificial world whose inhabitants, not developer-authored social rules, determine society.

**Architecture:** A pure JavaScript sovereign-world kernel owns physics-like constraints, biology, knowledge provenance, language, generic social primitives, artifacts and canonical actions. A Cloudflare Durable Object is the single writer and schedules continuous catch-up and Workers AI cognition. Pages becomes an Observer-only game shell using action timestamps for continuous animation; the old GitHub scheduled economy is archived as a non-authoritative v1 path.

**Tech Stack:** JavaScript ES modules, Node 22 built-in test runner, Cloudflare Workers/Durable Objects/Workers AI, Pages Functions, Canvas 2D, WebSocket, existing GitHub OAuth/D1 identity layer.

**Spec:** `docs/superpowers/specs/2026-09-15-sovereign-world-v2-design.md`

## Global Constraints

- Canonical time: 1 real minute = 1 CYMONIA hour; therefore 1 real second = 1 CYMONIA minute.
- Genesis has 100 Citizens and no pre-created company, government, police, court, bank, religion, currency, city or human language.
- No persistent entity may appear without causal provenance.
- Material resources are closed after Genesis except modeled natural energy flows and the pre-reserved Observer Embodiment Reserve.
- LLM output is advisory and must pass epistemic and physical validation.
- No developer-authored fallback may manufacture major social outcomes when AI is unavailable.
- Production UX is one full-viewport world; all inspection/history is in-game.
- v1 remains identifiable as historical prototype but is not the v2 heartbeat.
- Runtime dependencies stay minimal; core tests use only Node standard library.

---

### Task 1: World kernel, clock, ledger and Genesis

**Files:**
- Create: `world/constants.js`
- Create: `world/rng.js`
- Create: `world/ledger.js`
- Create: `world/clock.js`
- Create: `world/genesis.js`
- Test: `tests/test_sovereign_genesis.mjs`

**Interfaces:**
- Produces: `createSovereignGenesis({seed, realEpochMs})`, `worldMinuteAt(world, nowMs)`, `appendEvent(world, type, actorId, payload, causes)`.

- [ ] Write Genesis tests asserting 100 Citizens, zero social institutions, finite endowment, primitive signaling only, and 1:60 real/world time.
- [ ] Run `node --test tests/test_sovereign_genesis.mjs` and verify failure before implementation.
- [ ] Implement deterministic Genesis, canonical clock and hash-chained ledger.
- [ ] Re-run the test and verify pass.

### Task 2: Matter, environment, biology and mortality

**Files:**
- Create: `world/materials.js`
- Create: `world/environment.js`
- Create: `world/biology.js`
- Test: `tests/test_sovereign_biology.mjs`
- Test: `tests/test_sovereign_conservation.mjs`

**Interfaces:**
- Produces: `advanceEnvironment`, `advanceBody`, `killCitizen`, `totalTrackedMass`.

- [ ] Write tests for hydration/hunger/sleep progression, aging, death permanence and mass conservation.
- [ ] Verify tests fail.
- [ ] Implement material accounting, environmental resource regeneration/depletion and biological progression.
- [ ] Verify tests pass.

### Task 3: Knowledge, memory and epistemic compiler

**Files:**
- Create: `world/memory.js`
- Create: `world/epistemics.js`
- Test: `tests/test_sovereign_epistemics.mjs`

**Interfaces:**
- Produces: `learn`, `knows`, `recordMemory`, `forget`, `validateProposalKnowledge`.

- [ ] Test that unknown Earth concepts are rejected, provenance-backed concepts are accepted, rumors may be false and knowledge can die with holders.
- [ ] Verify failure.
- [ ] Implement first-class memories and provenance graph.
- [ ] Verify pass.

### Task 4: Actions, scheduling and continuous movement

**Files:**
- Create: `world/actions.js`
- Create: `world/scheduler.js`
- Test: `tests/test_sovereign_actions.mjs`

**Interfaces:**
- Produces: `startAction`, `completeDueActions`, `positionAt`, `scheduleReflexes`.

- [ ] Test canonical timestamped movement, no action by dead Citizens, resource reservation and interruption.
- [ ] Verify failure.
- [ ] Implement general action queue and completion handlers.
- [ ] Verify pass.

### Task 5: Artifacts, experiments, invention and construction

**Files:**
- Create: `world/artifacts.js`
- Test: `tests/test_sovereign_artifacts.mjs`

**Interfaces:**
- Produces: `runExperiment`, `registerDesign`, `beginConstruction`, `applyConstructionWork`.

- [ ] Test no building can appear without design, site, materials, work and elapsed time; test failed investment remains possible.
- [ ] Verify failure.
- [ ] Implement generic property-based artifact/design/construction system without tech tree.
- [ ] Verify pass.

### Task 6: Language, relationships and emergent society primitives

**Files:**
- Create: `world/language.js`
- Create: `world/society.js`
- Test: `tests/test_sovereign_language.mjs`
- Test: `tests/test_sovereign_society.mjs`

**Interfaces:**
- Produces: `coinSignal`, `communicate`, `updateRelationship`, `makeClaim`, `makeCommitment`, `formOrganization`.

- [ ] Test primitive Genesis signaling, emergent token association, misunderstanding, conflicting claims and voluntary organization membership.
- [ ] Verify failure.
- [ ] Implement generic cultural/social substrate with no prebuilt state/religion/company semantics.
- [ ] Verify pass.

### Task 7: Cognition and AI boundary

**Files:**
- Create: `world/cognition.js`
- Create: `world/observer.js`
- Test: `tests/test_sovereign_cognition.mjs`
- Test: `tests/test_sovereign_history.mjs`

**Interfaces:**
- Produces: `buildCognitiveContext`, `validateCognitiveProposal`, `applyAcceptedPlan`, `classifyHistory`.

- [ ] Test that context contains only known facts, forbidden concepts fail validation, and Observer labels do not mutate canonical state.
- [ ] Verify failure.
- [ ] Implement structured planning contract, survival-only non-LLM fallback and descriptive Observer classification.
- [ ] Verify pass.

### Task 8: Integrated engine and human avatar

**Files:**
- Create: `world/engine.js`
- Create: `world/index.js`
- Test: `tests/test_sovereign_engine.mjs`
- Test: `tests/test_sovereign_avatar.mjs`

**Interfaces:**
- Produces: `advanceWorldTo`, `publicWorld`, `createHumanAvatar`, `submitHumanIntent`.

- [ ] Test catch-up, real-time action continuity, embodiment-reserve consumption, no privileged avatar knowledge and permanent avatar death.
- [ ] Verify failure.
- [ ] Integrate kernel modules.
- [ ] Verify pass.

### Task 9: Durable Object single-writer runtime

**Files:**
- Create: `worker/src/index.js`
- Create: `wrangler.world.toml`
- Create: `wrangler.toml`
- Create: `functions/api/v2/[[path]].js`
- Test: `tests/test_sovereign_runtime_contract.mjs`

**Interfaces:**
- HTTP: `/state`, `/history`, `/why/:id`, `/avatar`, `/intent`, `/stream`, `/health`.

- [ ] Write static/runtime-contract tests for single-writer binding, alarm catch-up, WebSocket path and AI binding.
- [ ] Verify failure.
- [ ] Implement Durable Object persistence, alarm scheduling, streaming and Pages proxy.
- [ ] Verify pass.

### Task 10: Game-only Observer UI

**Files:**
- Replace: `site/index.html`
- Create: `site/sovereign-world.css`
- Create: `site/sovereign-world.js`
- Create: `site/sovereign-renderer.js`
- Create: `scripts/build_sovereign_genesis.mjs`
- Create: `tests/browser-sovereign.mjs`
- Test: `tests/test_sovereign_shell.mjs`

**Interfaces:**
- Consumes `/api/v2/state`, `/api/v2/history`, `/api/v2/why/:id`, `/api/v2/stream`.

- [ ] Test that no legacy dashboard markers remain, world owns viewport, Society History is an in-game window and movement derives from action timestamps.
- [ ] Verify failure against v1 shell.
- [ ] Implement full-screen game shell, canvas world, Citizen inspector, timeline/history, WHY and Personal Agent windows.
- [ ] Verify static test pass and run Playwright smoke where available.

### Task 11: CI, v1 archival and documentation alignment

**Files:**
- Replace: `.github/workflows/economy.yml`
- Replace: `.github/workflows/ci.yml`
- Replace: `README.md`
- Create: `archive/v1/README.md`
- Create: `RELEASE_SOVEREIGN_WORLD_V2.md`
- Create: `docs/architecture-v2.md`
- Create: `docs/deployment-sovereign-world.md`

**Interfaces:**
- CI must run all sovereign unit tests, generate replay Genesis and run `browser-sovereign.mjs`.

- [ ] Remove GitHub Actions as canonical five-minute world heartbeat.
- [ ] Make CI reject dashboard regression.
- [ ] Document Cloudflare worker-first deployment and v1 historical boundary.
- [ ] Run all source and test validation.

### Task 12: Package safety and reproducibility

**Files:**
- Create: `APPLY.sh`
- Create: `CHECK.sh`
- Create: `MANIFEST.sha256`

- [ ] Make installer require CYMONIA repo markers and refuse a dirty working tree unless `CYMONIA_ALLOW_DIRTY=1` is explicitly set.
- [ ] Archive the previous production `site/index.html` into `archive/v1/index-v1.html` during application before replacement.
- [ ] Disable v1 auth-side automatic world citizen creation by exact guarded textual patch while preserving OAuth.
- [ ] Run `CHECK.sh` against a synthetic target assembled from package files.
- [ ] Compute manifest and ZIP checksum.
