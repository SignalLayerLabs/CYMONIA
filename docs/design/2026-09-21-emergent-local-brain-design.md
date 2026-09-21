# CYMONIA Emergent Local Brain and Neuron Governor

Date: 2026-09-21

Status: design approved in conversation; written specification pending user review

## Intent

CYMONIA must produce more genuine emergence per unit of compute. Citizens should develop
multi-day chains of discovery, experiment, communication, cooperation, transformation, and
construction without asking an LLM what to do every few simulated minutes. Workers AI should
be reserved for novelty: generating a durable strategic direction when deterministic cognition
cannot reinterpret a new situation from existing experience.

The implementation must preserve the existing epistemic boundary: a citizen may only act on
entities and concepts it knows, and neither the Local Brain nor Workers AI may introduce Earth
knowledge or privileged world state.

## Success criteria

1. A citizen without an AI strategy can autonomously choose among exploration, gathering,
   experimentation, transformation, communication, teaching, care, transfer, cooperation,
   building, rest, and survival when those actions are afforded by its known state.
2. Deterministic simulations can demonstrate a causal chain containing resource discovery,
   gathering, property discovery through experimentation, repeated signal exposure, concept
   transfer, behavioral adaptation, cooperation, and construction without Workers AI.
3. A single accepted Workers AI cognition stores a persistent strategy that can drive many local
   actions over multiple CYMONIA days. It does not install a short action script.
4. AI scheduling is fair across the population and prioritizes novelty, danger, important social
   change, plan failure, successful experimentation, care/reproduction events, and completed
   construction.
5. Daily Workers AI consumption is governed in neurons rather than by a fixed call count, using
   the token usage returned by Workers AI.
6. The existing deterministic physics, conservation, provenance, constitution, persistence, and
   observer contracts continue to pass.

## Selected architecture

The selected approach is an incremental deterministic utility planner around the existing action
kernel. It retains the current action validation and resolution paths, adds explicit affordance
generation and scoring, and changes Workers AI from action author to strategy author.

Two alternatives were rejected for this iteration:

- A general rule DSL would be extensible but would add a second programming model before the
  required behaviors are understood.
- A local reinforcement-learning policy would be more adaptive but less auditable and harder to
  keep reproducible across runtime upgrades.

The resulting cognition stack has four tiers:

1. **Tier 0 — Reflex:** immediate biological and environmental survival.
2. **Tier 1 — Local Brain:** deterministic affordance generation and utility scoring.
3. **Tier 2 — Adaptive planning:** persistent strategy, action outcome memory, habituation,
   novelty decay, and retry/alternative selection.
4. **Tier 3 — AI cognition:** compact strategic reinterpretation for sufficiently novel or urgent
   queued events, subject to fairness and neuron budgets.

## Component boundaries

### Affordance planner

`world/cognition.js` will expose a pure affordance-planning boundary. Given a world, citizen, and
world minute, it generates only valid candidates based on locally available evidence. Candidate
families include:

- survival and rest;
- explore and observe;
- gather a known available deposit;
- experiment on held objects or known deposits with properties not yet learned;
- transform held materials when the citizen has relevant observations;
- communicate or teach a concept to a nearby known citizen who lacks it;
- care for a nearby known citizen with a material need;
- transfer an object where relationship and need support sharing;
- cooperate on an existing known construction project;
- initiate or continue empirical construction only when the citizen holds suitable material and
  has learned evidence-backed material properties.

Each candidate has a normalized score composed from need urgency, active strategy alignment,
curiosity/novelty, risk tolerance, social drive/empathy, relationship state, distance and effort,
inventory fit, knowledge gap, recency/cooldown, and prior outcomes. Stable seeded tie-breaking
keeps simulation replay deterministic. The planner returns one short executable plan, not a
global social narrative.

The engine retains `validateCognitiveProposal()` and `applyAcceptedPlan()` as the mandatory
execution boundary. No new planner path bypasses epistemic or physical validation.

### Adaptive local state

Citizen cognition receives a backward-compatible local state object initialized lazily for old
snapshots:

```json
{
  "lastLocalChoiceMinute": 0,
  "lastOutcomeMinute": 0,
  "outcomes": {},
  "cooldowns": {},
  "cognitionDebt": 0,
  "lastAICognitionMinute": null,
  "aiCognitionCount": 0
}
```

`outcomes` stores bounded aggregate statistics by affordance family: attempts, successes,
failures, last result, and exponentially decayed utility adjustment. It never stores unbounded
action history. Action resolution reports success or failure into this state. Failure reduces
immediate repetition and raises novelty priority; success reinforces a behavior without making it
permanent.

### Persistent AI strategy

Workers AI will return a compact strategy object instead of an array of actions:

```json
{
  "focus": "opaque known concept id",
  "intent": "explore|understand|share|cooperate|care|construct|adapt",
  "actionBias": ["EXPERIMENT", "COMMUNICATE"],
  "partnerIds": ["known citizen id"],
  "successSignals": ["known concept id"],
  "horizonMinutes": 4320,
  "confidence": 0.7
}
```

All IDs must already be present in the citizen's cognitive context. The strategy validator rejects
unknown concepts, unknown partners, unsupported intent/action values, invalid horizons, and
non-finite values. Accepted strategies are stored as `activeGoal` with creation, expiry, source,
and progress metadata. The Local Brain interprets the strategy repeatedly and can select dozens
of concrete actions over its horizon. Completion, expiry, repeated failure, or a materially more
urgent strategy closes it.

For snapshot compatibility, existing action-oriented `activeGoal` values remain readable by the
Local Brain. New Workers AI responses create only the new strategy shape.

The prompt places stable instructions before the dynamic citizen context to support Workers AI
prefix caching. Generation uses `max_completion_tokens: 200` and strict JSON. The parser accepts
the documented response shapes and returns both the sanitized strategy and normalized usage.

### Experiment and language loops

Experiment candidates are favored when curiosity and novelty are high and an accessible target
has observable properties the citizen has not learned. Gathering becomes useful because held
objects enable tests and later transformations. A target/property pair receives a cooldown after
an inconclusive or redundant experiment so curiosity moves elsewhere.

Communication candidates require proximity, an existing encounter, a sender-known concept, and
a receiver knowledge gap. Score depends on social drive, familiarity, trust, concept salience,
strategy alignment, and encounter repetition. The existing three-exposure learning threshold and
grammar-pattern accumulation remain canonical. Teaching stays a higher-confidence path favored by
strong trust; ordinary communication remains the default language-emergence path.

Neither loop invents vocabulary or material semantics. Signals still come from `coinSignal()` and
properties still come from `runExperiment()` over canonical observable material properties.

### Cooperation and construction

Cooperation is represented through existing concrete actions rather than a fictional
`COOPERATE` kernel action. A citizen may transfer material to a trusted partner, communicate a
shared concept, or contribute `BUILD` work to a known active project. Construction initiation
requires held material, evidence-backed concepts, a valid site, and a locally generated empirical
design. No rule says to build a house or names a predetermined institution.

## Novelty queue and fair scheduler

Queue entries become mergeable per citizen and carry reason, base priority, first/last queued
world minute, occurrences, and optional event references. Repeated equivalent events increase
salience without growing the queue unboundedly.

Each living citizen accumulates `cognitionDebt` with simulated time since its last accepted AI
cognition. Selection score is:

```text
base event priority
+ bounded cognition debt
+ reason bonus
+ novelty bonus
- recent-AI penalty
- active-strategy adequacy penalty
```

Reason bonuses cover discovery, plan/action failure, danger, significant encounter, new concept,
successful experiment, conflict, pregnancy/birth/care, completed construction, relationship
threshold change, and explicit human direction. Ordinary plan completion does not by itself force
AI cognition. Debt guarantees eventual opportunity when budget exists, while urgency can still
move a citizen ahead temporarily.

Only Tier 3-worthy entries reach the Worker scheduler. Local-plan completion, routine encounters,
and ordinary resource observations are consumed by Tiers 1–2 unless novelty remains unresolved.

## Neuron Governor

The fixed `AI_CALLS_PER_REAL_DAY` gate is removed as the primary control. The runtime budget is
initialized and migrated lazily:

```json
{
  "day": "YYYY-MM-DD",
  "usedNeurons": 0,
  "reservedNeurons": 0,
  "calls": 0,
  "promptTokens": 0,
  "completionTokens": 0,
  "lastFailureRealMs": 0,
  "lastExhaustedDay": null
}
```

Defaults:

- normal soft budget: 8,000 neurons/day;
- high-priority reserve: 1,000 neurons/day;
- emergency/human reserve: 500 neurons/day;
- hard stop: 9,500 neurons/day;
- unallocated safety margin: 500 neurons/day.

For `@cf/zai-org/glm-4.7-flash`, observed usage is converted using the documented rates current on
2026-09-21: 5,500 neurons per million input tokens and 36,400 per million output tokens. Model
rates are explicit configuration data keyed by model ID; an unknown model fails closed for normal
cognition unless conservative override rates are configured.

Before inference, the governor reserves a conservative estimate computed from serialized prompt
size and the 200-token completion cap. After inference it replaces the reservation with actual
`usage.prompt_tokens` and `usage.completion_tokens`. Missing or malformed usage consumes the full
reservation and emits an observable accounting-warning event; it never counts as zero.

Normal events may spend only the soft budget. High-priority events may use the high-priority
reserve. Explicit human direction and immediate survival emergencies may use the final reserve.
No request may cross the 9,500-neuron hard stop based on its reservation. Daily reset remains UTC,
matching Cloudflare's documented allocation reset.

The health endpoint reports neurons, token counts, calls, tier capacity, reservations, rate table,
and last accounting warning. It does not expose private prompts or citizen memories.

References:

- <https://developers.cloudflare.com/workers-ai/platform/pricing/>
- <https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/>
- <https://developers.cloudflare.com/workers-ai/features/prompt-caching/>

## Data flow

```text
world advances
  -> Tier 0 survival reflex if urgent
  -> perceive canonical local state
  -> record event/outcome and merge novelty signal
  -> Tier 1 generates and scores local affordances
  -> Tier 2 applies active strategy and learned outcome modifiers
  -> validated local plan enters existing action kernel
  -> only unresolved/urgent novelty enters fair AI scheduler
  -> Neuron Governor reserves capacity
  -> Workers AI returns one compact strategy plus usage
  -> governor accounts actual neurons
  -> validated strategy guides later local decisions for days
```

## Failure handling

- Invalid local candidates are discarded before scoring; validation remains the final guard.
- If all candidates are invalid, the citizen observes or rests rather than fabricating an action.
- Invalid AI JSON, unknown references, timeout, or rejected strategy records a deferred cognition
  event, releases/reconciles the reservation conservatively, and requeues the citizen with bounded
  backoff.
- A failed concrete action updates local outcome statistics and may enqueue a novelty event, but it
  does not immediately retry the same action indefinitely.
- Missing Workers AI leaves the world fully active through Tiers 0–2.
- Old persisted worlds acquire new fields lazily without changing their canonical history.

## Observability

Ledger and health data will distinguish:

- local affordance selection;
- experiment success or redundancy;
- strategy accepted, progressed, expired, completed, or abandoned;
- cognition queued, deferred, or accepted;
- neuron reservation, accounting, reserve tier, and exhaustion;
- scheduler fairness summaries without exposing private cognition.

High-frequency local decisions must not flood the canonical ledger. Detailed scores remain bounded
runtime/citizen state; only material outcomes and sampled/aggregated planner diagnostics are
published.

## Verification

Test-driven implementation will add focused suites for:

1. deterministic affordance generation and stable tie-breaking;
2. need, curiosity, risk, social, relationship, inventory, distance, cooldown, and outcome score
   effects;
3. autonomous gather -> experiment -> property learning;
4. repeated communication -> concept transfer -> grammar growth;
5. cooperation through transfer and shared construction work;
6. strategy validation, persistence, expiry, progress, and backward compatibility;
7. queue merging, cognition-debt aging, reason bonuses, and population fairness;
8. exact neuron conversion, reservation reconciliation, reserve isolation, UTC reset, unknown-model
   behavior, missing usage, and hard-stop enforcement;
9. compact Workers AI prompt/response contract and `max_completion_tokens <= 200`;
10. a deterministic multi-day, no-AI emergence scenario reaching a first completed structure
    without a hard-coded instruction to build a house;
11. complete existing invariant and delivery suites.

The current baseline has 104 passing tests and four failures caused by two tests converting file
URLs with `.pathname`, which leaves `%20` in this worktree path. A minimal test-only portability
fix using `fileURLToPath()` is included so final verification can be green locally and in CI.

## Delivery

Implementation will be committed on `codex/emergent-local-brain`, pushed to
`SignalLayerLabs/CYMONIA`, and proposed as a pull request against `main`. The PR will document the
new persisted fields, compatibility behavior, verified Cloudflare assumptions, tests executed,
and the fact that the implementation increases autonomous affordances without predetermining a
social outcome.

Cloudflare deployment is not part of this change unless separately requested. Publishing means
the tested branch and pull request are made available on GitHub.

## Non-goals

- Predetermining houses, governments, currencies, religions, or other social institutions.
- Giving citizens global world knowledge or Earth vocabulary.
- Replacing the deterministic action/physics kernel with LLM output.
- Adding a new paid service, database, queue, or model.
- Claiming consciousness, causal validity outside the simulation, or guaranteed social outcomes.
