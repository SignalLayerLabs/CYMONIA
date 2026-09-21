# CYMONIA — Sovereign World

CYMONIA is a persistent artificial civilization that decides what happens to itself. The world is the product: the public site opens directly into a cinematic, game-like Observer where canonical Citizens act, learn, build, relate and change over world time.

## World contract

- The canonical world starts with 100 Genesis Citizens in a materially closed natural environment.
- There is no pre-created city, government, company, religion, currency or human language.
- Buildings, knowledge and institutions require causes in the world.
- Citizens can learn, forget, form relationships, reproduce, age and die permanently.
- **1 real minute = 1 CYMONIA hour.** Long actions have world-time timestamps and the Observer interpolates them continuously.
- Workers AI proposes bounded cognition; deterministic kernel rules authorize state changes.

## Game Observer

The product shell is a full-screen isometric strategy world with animated terrain, water, foliage, weather, daylight, Citizens, construction, minimap, selection/follow camera, state inspection, Society History and causal `WHY?` tracing. It is an Observer: the browser never advances or edits the canonical world.

## Runtime

- **Cloudflare Pages:** game shell and authenticated API facade.
- **Durable Object + SQLite:** single-writer canonical world, alarms, checkpoints and live stream.
- **Workers AI:** bounded event-driven cognition.
- **D1:** GitHub identity and session records for human-linked avatars.
- **GitHub Actions:** CI and deployment only; it is not the world heartbeat.

## Autonomous cognition economy

Citizens continue to act when Workers AI is unavailable. Cognition is split into four layers:

1. **Tier 0 — Reflex:** urgent hydration, nutrition, sleep and environmental safety.
2. **Tier 1 — Local Brain:** a deterministic affordance planner scores exploration, gathering,
   experimentation, transformation, communication, teaching, care, transfer, cooperation,
   construction and rest from the citizen's own evidence.
3. **Tier 2 — Adaptive planning:** bounded outcome memory and a persistent strategy alter later
   choices without bypassing the physical or epistemic validators.
4. **Tier 3 — AI cognition:** Workers AI is used only for novel or urgent reinterpretation. It
   returns a compact multi-day strategy, never a minute-by-minute action script.

The novelty queue merges repeated events and uses cognition debt so a few Citizens cannot
monopolize AI. One accepted strategy can guide many days of local action. Concrete outcomes remain
deterministic: resource discovery can lead to gathering, property experiments, coined signals,
shared knowledge, material transformation and construction without an AI call or a rule saying
what society must build.

Workers AI admission is governed by measured neurons rather than a call-count limit. The default
daily ceilings are 8,000 neurons for normal novelty, 9,000 including high-priority events, and
9,500 including human/emergency work, preserving 500 neurons of the documented free allocation as
headroom. Actual `usage.prompt_tokens` and `usage.completion_tokens` replace the reservation after
each response; missing usage is charged conservatively rather than treated as free.

## Repository map

- `world/` — causal kernel, biology, cognition, epistemics, language, society and artifacts.
- `world/affordances.js` — deterministic Local Brain candidate generation and scoring.
- `world/cognition-queue.js` — mergeable novelty queue and fair debt-aware scheduler.
- `worker/src/index.js` — canonical Durable Object world.
- `worker/src/neuron-governor.js` — Workers AI reservation and measured neuron accounting.
- `functions/api/v2/` — state, history, WHY, avatar, intent and stream facade.
- `functions/api/auth/` — GitHub OAuth and session bridge.
- `functions/_lib/identity.js` — identity-only D1 store.
- `site/` — game-only Observer and deterministic Genesis fallback.
- `scripts/build_sovereign_genesis.mjs` — reproducible fallback builder.
- `tests/test_sovereign_*.mjs` — world invariants and delivery contracts.
- `docs/superpowers/specs/2026-09-15-sovereign-world-v2-design.md` — design specification.
- `docs/superpowers/specs/2026-09-21-emergent-local-brain-design.md` — cognition economy specification.

## Verify locally

```bash
node --test tests/test_sovereign_*.mjs
bash CHECK.sh . --skip-browser
```

For browser smoke, install Playwright, serve `site/`, then run:

```bash
python3 -m http.server 8765 --directory site
CYMONIA_URL=http://127.0.0.1:8765 node tests/browser-sovereign.mjs
```

Deploy from a clean checkout with Wrangler or let the `main` workflow deploy the Worker and Pages Observer after CI passes.
