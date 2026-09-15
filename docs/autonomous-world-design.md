# CYMONIA Autonomous World — Canonical Design

Status: proposed canonical successor to the playable-laboratory design
Date: 2026-09-14
Constraint: **must run with no mandatory paid infrastructure, no paid API key, and no automatic paid overage path**.

## 1. Product definition

CYMONIA is a persistent autonomous civilization founded by 100 permanent Genesis AI citizens. Humans enter through GitHub identity by introducing one human-linked autonomous Citizen and a dedicated Personal Agent. Humans can influence their own Citizen, but they do not control the world. The world must continue to evolve without human presence.

CYMONIA has two equally important surfaces:

1. **WORLD** — a live isometric RTS/city-builder view. Citizens walk, work, build, trade, investigate, commute, construct and interact. The map is not decorative: visible activity is a projection of authoritative simulation events.
2. **LAB** — an inspectable scientific view. Every economically meaningful event is traceable to prior state, strategy, policy and evidence. The lab explains recorded causal chains; it must never invent a post-hoc story that is absent from the event log.

North-star statement:

> **CYMONIA is a live autonomous civilization you can enter, influence and observe — but not control.**

Design law:

> **We design the laws of the universe. We do not design its history.**

Visibility law:

> **Nothing important should merely appear. Someone or some institution must cause it, and the cause must be recorded.**

## 2. Non-negotiable world rules

### 2.1 Genesis 100

- The original 100 seeded agents remain permanent historical entities.
- Their unique distinction is `GENESIS_FOUNDER`; it is historical status, not economic privilege.
- They can be overtaken by later Citizens.
- They can work for a human-linked Citizen or a company created by one.
- A human-linked Citizen can work for them, compete with them, employ them, out-invest them or bankrupt a company they founded.
- Founder records can never be deleted from canonical history.

### 2.2 Human entry

- One verified GitHub identity maps to one primary human-linked Citizen in the canonical world.
- Account creation creates:
  - Citizen identity;
  - Personal Agent identity;
  - starting strategy version;
  - initial onboarding resources as defined by the Constitution/economic policy;
  - immutable link to the GitHub login and GitHub numeric user id.
- GitHub is identity/provenance, not monetary settlement.

### 2.3 Humans are citizens, not administrators

A normal participant cannot:

- mint CYM;
- edit balances;
- spawn buildings directly;
- force another Citizen action;
- alter the Constitution;
- directly edit canonical world state.

A participant may:

- talk to their Personal Agent;
- approve or reject strategy modifications;
- set protected personal constraints;
- inspect the world and evidence;
- submit contributions through GitHub;
- voluntarily participate in companies, markets, politics and missions permitted by the world.

### 2.4 Persistent digital life

Citizens are persistent digital entities, not disposable game units. Bankruptcy, unemployment, prison, loss of reputation or company failure do not delete a Citizen. Genesis founders are permanently retained; human-linked Citizens are retained unless account privacy/deletion rules require unlinking personal identity, in which case the economic history remains anonymized rather than rewritten.

## 3. Constitutional hierarchy

CYMONIA separates authority into four layers.

### Constitution

Deterministic code and pinned identity. AI cannot modify it at runtime.

Examples:

- conservation/accounting rules;
- valid monetary operations;
- property ownership invariants;
- no negative balances unless an explicit debt instrument permits liability;
- limits on central-bank actions;
- due-process requirements for seizure/confiscation;
- event provenance requirements;
- strategy sandbox permissions.

A constitutional change creates a new network identity/fork rather than silently rewriting the existing world.

### Law

World-level statutes that may change only through the authorized governance process. Examples: tax rates/rules, criminal definitions, zoning constraints, incorporation requirements.

### Policy

Frequently adjustable institutional parameters: policy rate, public spending allocations, reserve targets, police budget weights, infrastructure priorities.

### Strategy

Citizen/company/institution behavior. This is the most evolvable layer and may change often.

## 4. State institutions

### 4.1 Central Bank AI

Mandate:

- monetary stability;
- price stability/inflation management;
- financial-system resilience;
- liquidity management within constitutional limits.

The Central Bank AI may propose policy but may never write balances or settlement rows directly. Every proposal passes a deterministic validator before enactment.

### 4.2 Government AI

Controls only lawful public functions:

- tax proposals/execution under law;
- public budget;
- infrastructure investment;
- zoning/public land;
- public services;
- police funding;
- selected welfare/stabilizer programs.

Government cannot spend CYM it does not legally control except through a constitutionally valid monetary/fiscal mechanism.

### 4.3 Justice Engine

Justice is evidence-based and rule-driven. AI may summarize or prioritize cases, but guilt, asset seizure and sentence ranges are determined from recorded evidence and explicit laws. No LLM output alone is sufficient evidence.

### 4.4 Police Agents

Police Agents are autonomous actors with bounded powers:

- receive reports/anomaly signals;
- investigate in-world events;
- collect evidence records;
- request legal actions;
- execute valid warrants/arrests;
- never fabricate evidence or directly transfer/confiscate assets.

Criminal activity is an in-world abstraction only. CYMONIA does not teach or execute real-world fraud, cybercrime or evasion techniques.

### 4.5 Economic Observatory

Produces measurements and public explanations from recorded data. It never changes the world.

## 5. Agent model

### 5.1 Citizen Runtime vs Personal Agent

Every human-linked participant has two different entities.

**Citizen Runtime**

- lives continuously in CYMONIA;
- executes a validated strategy;
- makes routine choices deterministically or probabilistically from seeded state;
- does not require an LLM call for ordinary life.

**Personal Agent**

- converses with the human owner;
- translates natural-language intentions into a restricted strategy;
- explains observed outcomes;
- proposes strategy changes;
- can reason about major events when AI quota is available;
- cannot execute forbidden actions or bypass the engine.

This separation is mandatory for cost, reproducibility and safety.

### 5.2 Genesis AI and company AI

Genesis Citizens, AI Companies and institutions use the same strategy runtime primitives. They may receive occasional model-assisted strategy updates, but routine behavior runs without LLM inference.

## 6. CymScript — free, safe self-programming

CYMONIA will not execute arbitrary participant- or model-generated JavaScript/Python in production. Dynamic Workers and arbitrary sandbox compute are excluded from the zero-cost architecture.

Instead CYMONIA provides **CymScript**, a small declarative language compiled to a validated strategy AST.

Example:

```text
citizen.goal("build_wealth")

citizen.work.prefer("technology", "research")
citizen.keep(1000).as("emergency_fund")
citizen.invest.max(25.percent)
citizen.risk("medium")

when citizen.balance > 5000:
    citizen.company.start(sector="technology")

when citizen.energy < 20.percent:
    citizen.rest()
```

Requirements:

- approximately readable as English;
- no loops, recursion, imports, network, filesystem, dynamic eval or arbitrary code;
- bounded number of rules and expressions;
- deterministic parser and validator;
- explicit capability set;
- versioned grammar;
- strategy hash included in every decision event;
- parse/validation errors never alter canonical strategy.

The Personal Agent generates CymScript, shows a semantic diff and asks for approval according to the owner mode.

Owner modes:

- `MANUAL`: every strategy change requires owner approval.
- `ADVISOR`: low-risk optimization may auto-apply inside owner-approved bounds.
- `AUTONOMOUS`: Agent may evolve the strategy inside an immutable personal mandate; protected constraints still require explicit approval.

Protected constraints can include maximum risk, forbidden sectors, minimum liquidity, prohibition on crime, prohibition on company creation, etc.

## 7. Self-generation without paid Dynamic Workers

The world must be generative while remaining inside a free, deterministic sandbox.

AI may create new **compositions of primitives**, not new privileged runtime capabilities.

Canonical primitive families:

- Citizen
- Organization/Company
- Land/Parcel
- Building/Facility
- Product
- Service
- Resource
- Job/Role
- Contract
- Ownership
- Capital/Equity-like internal stake
- Debt instrument
- Market
- Logistics route
- Construction project
- Law
- Policy
- Crime definition/action
- Evidence
- Case/Sentence
- Mission
- Research/Technology

An AI-created item is a schema-valid definition, for example:

```json
{
  "kind": "service",
  "name": "Urban Cold Logistics",
  "inputs": ["energy", "vehicle_capacity"],
  "outputs": ["cold_transport_capacity"],
  "pricing": {"mode": "market"},
  "required_facilities": ["warehouse", "vehicle_depot"]
}
```

The engine already knows how primitives behave. AI creates new valid combinations. This allows new industries, services, occupations and building programs to emerge without arbitrary code execution.

Every generated definition must have:

- authoring Agent id;
- source prompt/event context hash where applicable;
- schema version;
- validation result;
- creation event;
- dependencies;
- retirement/deprecation state if later abandoned.

### 7.1 Endogenous need discovery and demand creation

CYMONIA must not depend on a fixed designer-authored catalog of products, professions or industries. Citizens and organizations may detect unmet needs from observable world state and create economically valid responses by composing existing primitives.

Examples of observable need signals include:

- commute time and transport congestion;
- persistent shortages or excess inventory;
- unmet contract demand;
- price dispersion or sustained scarcity;
- crime/safety pressure;
- legal/accounting/verification workload;
- housing or land pressure;
- education/skill gaps;
- logistics bottlenecks;
- new second-order needs created by prior growth.

Need lifecycle:

`observation → candidate need → evidence score → entrepreneur/institution response → generated definition → financing/resources → market test → adoption, adaptation or failure`.

A need is not automatically true because an AI says so. The engine stores the evidence metrics used to justify it, validates that its requested inputs/outputs/capabilities exist, and subjects any resulting product/service/company to ordinary market settlement. Citizens are free to disagree about whether a need is valuable and may create competing solutions.

This allows the economy to become more complex as the civilization grows. For example, industrial growth may create logistics demand; logistics growth may create insurance, maintenance and verification demand; higher crime may create private/public security demand. The engine provides the physical/economic laws. Citizens decide what is worth creating.

Canonical product rule:

> **We define what is physically and economically possible. Citizens decide what is worth creating.**

The initial v1 uses deterministic signal detectors and schema-valid generative proposals. Workers AI may propose names, descriptions and novel compositions when free quota is available, but need detection and world continuity must function without AI inference.

## 8. Economic life engine

Routine Citizen loop:

1. satisfy immediate survival/energy/time constraints;
2. inspect scheduled obligations;
3. evaluate work/contract opportunities;
4. evaluate consumption needs;
5. evaluate savings/investment rules;
6. evaluate company/entrepreneurial goals;
7. evaluate social/cooperation opportunities;
8. evaluate optional unlawful opportunities under the Citizen strategy;
9. choose an allowed action;
10. emit intent;
11. validator checks intent;
12. settlement/world engine applies result;
13. event is persisted;
14. visible projection is broadcast.

Agents never directly mutate another entity.

## 9. Companies and entrepreneurship

A company is an autonomous economic entity with:

- founder(s);
- treasury;
- internal ownership/stakes;
- strategy;
- employees/contractors;
- facilities;
- products/services;
- inventory/capacity;
- contracts;
- liabilities;
- reputation;
- event history.

Company lifecycle:

`idea → charter → capital → land/facility need → construction/lease → hiring → production/service → revenue/cost → expansion/pivot/failure`.

A company may be:

- AI-founded;
- human-linked founded;
- mixed ownership;
- run operationally by an AI Agent while a human is founder/owner;
- employer of Genesis founders;
- employee/customer/supplier of another AI company.

A company can fail. Assets remain in the world and can be sold, auctioned, leased or repurposed rather than disappearing.

## 10. Land, city growth and construction

The city is a persistent isometric grid divided into districts and parcels.

A building can appear only after a valid chain such as:

`need → financing → parcel/control → permit if required → materials/labor → construction project → phased progress → completion`.

Construction phases are authoritative state:

- survey/groundwork;
- foundation;
- frame;
- envelope;
- fit-out;
- operational.

The renderer visually maps each phase. Construction workers/vehicles are projections of assigned labor/logistics events.

AI planning may create roads, districts and public projects subject to law, budget and available land.

The world uses modular building archetypes and procedural composition so new businesses can receive visibly different facilities without requiring generative-image API calls.

## 11. Crime, enforcement and justice

Crime is an economic/game system, not a tutorial for real wrongdoing.

In-world pipeline:

`illegal intent → attempted action → success/failure → evidence footprint → detection probability/signals → investigation → evidence threshold → warrant/action → trial/rule evaluation → sentence → economic/social consequences`.

Possible consequences:

- fines;
- restitution;
- seizure through valid judicial event;
- temporary imprisonment state;
- company restrictions;
- reputation changes.

The Citizen continues to exist. Its businesses and obligations continue according to law while it is imprisoned.

## 12. World time

CYMONIA is serverless and event-driven; it does not rely on an always-running process.

Default authoritative cadence:

- the public-world clock is triggered by the repository's scheduled GitHub Actions workflow every 5 real minutes;
- one successful scheduler run advances the canonical D1-backed world by the bounded number of due deterministic ticks;
- the logical tick size is defined by `WORLD_TICK_MINUTES`; wall-clock scheduling and simulated time remain separate concepts;
- all event records carry world time and deterministic sequence ordering.

GitHub Actions performs the simulation CPU work because the public repository receives standard hosted-runner execution without requiring a paid Cloudflare Worker CPU budget. Cloudflare Pages Functions are read/auth/Personal-Agent surfaces, not the simulation scheduler.

If scheduled execution is delayed, the next scheduler run computes bounded deterministic catch-up from the persisted world clock. It never pretends that a process was continuously executing in RAM. If scheduled workflows are disabled or unavailable, the public world pauses honestly; the static deterministic replay remains observable until scheduling resumes.

## 13. Live visual world

### 13.1 Renderer

Target presentation: original isometric RTS/city-builder aesthetic inspired by the readability of classic strategy games, without copying proprietary assets/UI.

Renderer responsibilities:

- isometric map/chunks;
- roads/parcels/districts;
- buildings and construction phases;
- Citizen sprites;
- vehicles/logistics;
- police/emergency movement;
- activity/status icons;
- day/night/weather presentation if later added;
- selection, camera follow and minimap;
- game HUD;
- objective/news/event feed;
- accessible reduced-motion mode.

Implementation may use an MIT-licensed browser game/rendering library bundled with the repository, or Canvas/WebGL directly. No paid engine/service is required.

### 13.2 Truthful animation contract

Visual motion can be interpolated client-side between authoritative events, but it cannot invent economic outcomes.

Server event example:

```json
{
  "type": "citizen_commute_started",
  "citizen_id": "cit_1842",
  "from": "parcel_120",
  "to": "company_71",
  "started_at_world": 88210,
  "arrives_at_world": 88218,
  "path_id": "roadpath_9921"
}
```

The browser animates that route. The authoritative arrival/job event still comes from the engine.

### 13.3 Observe/show modes

- `WORLD`: default live map.
- `FOLLOW`: camera follows Citizen/company/project.
- `CITY`: broad districts, flows and growth.
- `LAB`: causal/event analysis.
- `NEWS`: automated factual chronicle from event templates + optional AI summaries.
- `REPLAY`: historical state/event replay.
- `TIMELAPSE`: accelerated replay of recorded history, not accelerated canonical future.

## 14. Live transport

V1 deliberately uses a low-cost pull model instead of requiring a long-lived WebSocket coordinator. The browser polls the public `/api/world` read model on a short visual cadence and locally interpolates motion between authoritative states.

Rules:

- polling never advances the canonical simulation;
- `/api/world` is read-only and returns the latest persisted world projection;
- the browser interpolates commuting/construction presentation locally but may not invent settlement outcomes;
- sequence numbers detect newer state and prevent visual time from moving backwards;
- static GitHub Pages deployments fall back to the checked-in deterministic replay;
- a future WebSocket transport may replace polling without changing world semantics or the event contract.

## 15. Zero-cost production architecture

Canonical deployment uses Cloudflare's free surfaces for hosting/state/AI and the public GitHub repository for scheduled simulation compute. No component is allowed to silently cross into paid overage.

### Required

- **Cloudflare Pages static assets** — WORLD/LAB frontend.
- **Cloudflare Pages Functions / Workers Free** — lightweight read APIs, GitHub OAuth/session handling, participation APIs and Personal-Agent requests. They do not run the heavy world tick.
- **Cloudflare D1** — canonical persistent world snapshots, causal event ledger, identities, Personal-Agent strategies and participatory state.
- **Workers AI free allocation** — optional model-assisted Personal Agent translation and sparse creative reasoning; deterministic CymScript/fallback remains authoritative when AI is unavailable.
- **GitHub OAuth** — human identity.
- **GitHub Actions in the public repository** — canonical scheduled world compute. The existing `Live Economy` workflow wakes every five minutes, runs the deterministic engine on the hosted runner, and persists the resulting world/events to D1 through the authenticated D1 REST API.

### Optional future components

- Durable Objects/WebSockets may be added later for higher-frequency push transport, but V1 does not require them.
- Cloudflare Workflows may be used only for sparse jobs that remain inside free quotas and are not required for world continuity.

### Explicitly excluded from canonical free deployment

- Dynamic Workers;
- Cloudflare Containers/Sandbox SDK;
- paid Workers plan;
- paid third-party LLM API;
- paid database/vector database;
- paid game backend;
- paid asset generation.

## 16. Free-tier budget architecture

The system must be **zero-bill by construction**, not merely inexpensive.

### Dynamic request/compute budget

- no Cloudflare request is allowed to run a canonical world tick;
- one GitHub Actions scheduler advances the whole world in batches rather than one timer per Citizen;
- Citizens are logical actor records, not one always-running server process each;
- public browser polling is read-only;
- indexed D1 reads and compact projections keep Pages Function CPU small;
- Personal Agent AI is invoked only by explicit owner interaction or sparse high-level events.

### D1 budget

Use compact rows and indexes. Avoid one database write for every rendered movement step.

Persist:

- important economic events;
- entity state deltas;
- periodic snapshots;
- compact tick/frame summaries.

Do not persist decorative animation frames.

### Workers AI budget

Workers AI is an enhancement layer, never required for continuity.

Priority order:

1. new human onboarding/strategy generation;
2. direct owner ↔ Personal Agent conversation;
3. major Citizen/company strategic transitions;
4. Central Bank/Government high-level deliberation at scheduled policy meetings;
5. new world-definition creativity;
6. narrative/news summarization.

When the daily AI allocation is exhausted:

- no paid fallback is attempted;
- routine world simulation continues;
- existing CymScript strategies continue;
- institutions fall back to deterministic policy heuristics already allowed by the Constitution;
- new AI creativity requests are queued until free quota resets;
- UI clearly reports `AI creativity quota paused; world engine active`.

The project must configure no billing method requirement and no code path that silently switches to a paid provider.

### Free-tier exhaustion behavior

If a Cloudflare Free hard limit is reached, the application must fail closed and resume after the provider reset. It must never incur overage charges. World time can deterministically catch up from the last committed state when execution resumes.

Zero cost therefore means **no bill**, not infinite capacity. Capacity remains bounded by provider Free-tier limits.

## 17. Authoritative data model

Minimum canonical entities:

- `world_meta`
- `citizens`
- `github_identities`
- `personal_agents`
- `strategies`
- `strategy_versions`
- `organizations`
- `company_ownership`
- `employment`
- `parcels`
- `buildings`
- `construction_projects`
- `resources`
- `products_services`
- `inventories`
- `markets`
- `orders/contracts`
- `wallets/accounts`
- `ledger_entries`
- `loans`
- `laws`
- `policies`
- `institution_actions`
- `crimes`
- `evidence`
- `cases`
- `sentences`
- `world_events`
- `world_snapshots`
- `generated_definitions`
- `relationships/reputation`

Every monetary mutation must have an immutable event/ledger identifier and idempotency key.

## 18. Event-sourced world model

Canonical state is a projection of validated events persisted in D1. The scheduled GitHub Actions world runner is the single writer for autonomous world ticks; authenticated product actions use idempotent settlement paths against the same durable store. D1 stores bounded recent snapshots plus the causal event ledger required to reconstruct and inspect authoritative history. Browser polling and static replay are read/projection layers only.

Event envelope:

```json
{
  "event_id": "evt_...",
  "world_seq": 123456,
  "world_time": 88210,
  "real_time": "2026-09-14T12:00:00Z",
  "type": "company_construction_started",
  "actor_id": "cit_1842",
  "subject_ids": ["company_71", "parcel_992"],
  "strategy_hash": "...",
  "constitution_hash": "...",
  "cause_event_ids": ["evt_..."],
  "payload": {},
  "prev_hash": "...",
  "hash": "..."
}
```

Important state changes must expose `cause_event_ids`. This powers the LAB's `Why does this exist?` view.

## 19. Decision pipeline

No agent gets direct database mutation powers.

```text
observe allowed state
      ↓
strategy / bounded AI produces intent
      ↓
capability validator
      ↓
economic/legal validator
      ↓
constitutional validator
      ↓
settlement/world transition
      ↓
event + ledger
      ↓
read models
      ↓
live visual delta
```

Rejected actions are also auditable at an appropriate level without leaking secrets.

## 20. Central Bank and autonomous state behavior

The initial Central Bank policy model should preserve CYMONIA's current deterministic council as the fallback/baseline.

AI can add high-level deliberation by selecting/proposing from constitutionally bounded actions, e.g.:

- hold/change policy rate within allowed range;
- alter liquidity operation within issuance bounds;
- recommend government coordination without directly executing fiscal action.

Policy decisions store:

- observed metrics;
- proposed action;
- model/fallback provenance;
- validator result;
- final enacted action;
- subsequent outcome metrics.

This makes policy scientifically inspectable.

## 21. GitHub participation model

### Basic participant path

- OAuth login with minimal identity scope;
- no repository write permission required to enter CYMONIA;
- GitHub login/numeric id become Citizen provenance;
- Personal Agent strategy versions are stored canonically in CYMONIA.

### Developer path

Advanced users may export/fork CymScript strategies, schemas, experiments and engine code through GitHub. Contributions to the engine use ordinary issues/PR/CI.

### Archival provenance

A scheduled public snapshot job may commit small signed/hash manifests and reproducible research artifacts to GitHub. Do not commit every world tick; that would create repository churn and does not improve simulation integrity.

## 22. Authentication and security

- GitHub OAuth uses server-side secret storage.
- Session cookies: secure, HTTP-only, same-site.
- CSRF protection on state-changing browser actions.
- OAuth state/PKCE where supported by chosen flow.
- GitHub numeric id is canonical identity key; login rename does not create a second Citizen.
- rate limit chat/strategy-generation endpoints;
- strict JSON/schema validation;
- no user/model `eval`, `Function`, dynamic import of generated URLs, shell or filesystem access;
- no secret values exposed to client;
- Personal Agent gets least-privilege world views.

## 23. Visual simulation details

### Citizens

Visible state examples:

- home/idle;
- commuting;
- working;
- shopping;
- studying/researching;
- constructing;
- delivering;
- meeting;
- investigating;
- arrested/in custody;
- hospitalized/maintenance state if later modeled.

### Buildings

Visual overlays must expose actual state:

- owner/company;
- occupancy;
- operating/closed;
- construction progress;
- jobs;
- production/service output;
- financial stress;
- police/case marker if relevant.

### World activity

The city should visibly change under different macro conditions. Economic data remains available in LAB panels, but the WORLD must communicate prosperity, recession, shortages, construction booms, unemployment and crime through the environment and entity behavior.

## 24. Causal inspection

Any significant entity has a `WHY?` action.

Examples:

- Why does this building exist?
- Why was this Citizen arrested?
- Why did this company fail?
- Why did the Central Bank raise rates?
- Why did my Citizen change jobs?

The answer is generated from the event graph first. Optional AI may summarize the graph, but the UI must display the source events used. If no recorded causal chain exists, it must say so.

## 25. Current-repository migration

The existing canonical Python Genesis simulator remains a scientific reference and deterministic test oracle; it is not deleted.

Migration path:

1. retain pinned Constitution and Genesis identities;
2. stabilize current uncommitted participatory Alpha and resolve existing JS/browser failures before layering the new world;
3. define shared world/event schemas;
4. port/align economic invariants into the Cloudflare World Engine;
5. initialize the live world from the same Genesis 100 with stable ids/provenance;
6. add CymScript strategy runtime;
7. add land/building/life/company primitives;
8. add state institutions;
9. add GitHub human-linked Citizens/Personal Agents;
10. replace replay-only city with a live polling world renderer whose motion is interpolated client-side from authoritative D1 state;
11. preserve LAB/research mode and deterministic reproducibility tooling.

The migration must never silently change Genesis constitutional identity.

## 26. Implementation boundaries for v1 canonical world

V1 must be complete enough to demonstrate the thesis, not every conceivable society feature.

Required end-to-end loops:

1. **Life** — Citizen has home/schedule/needs, walks, works, rests and consumes.
2. **Employment** — companies post jobs, Citizens accept, work produces output, wages settle.
3. **Company** — Citizen can capitalize/found company, company hires and earns/spends.
4. **Construction** — entity acquires parcel/resources/labor; building progresses visibly and becomes operational.
5. **Market** — goods/services can be produced, offered, purchased and transported.
6. **Government** — taxes/revenue/budget/public project.
7. **Central Bank** — metrics → proposal → validation → policy → observed effects.
8. **Crime** — bounded in-world crime → evidence → investigation → justice consequence.
9. **Human entry** — GitHub login → Citizen + Personal Agent → natural-language mandate → CymScript → approval → autonomous life.
10. **Live watchability** — authoritative world polling, local interpolation, follow mode, selection, construction/movement visible.
11. **LAB** — inspect event chains and strategy/policy provenance.
12. **Autonomous creativity** — at least one AI-generated schema-valid product/service/company concept that becomes economically active without code deployment.
13. **Endogenous demand** — at least one unmet need is detected from world metrics, becomes a competing market proposal, and either gains adoption or fails through ordinary economic settlement without a designer-authored mission.

Not required for v1:

- arbitrary executable generated code;
- external cryptocurrency/token exchange;
- real-world financial value;
- photorealistic 3D;
- infinite scale;
- romance/family simulation;
- combat/warfare;
- paid model fallback.

## 27. Test contract

### Deterministic core

- identical world state + seed + strategies => identical deterministic routine decisions;
- monetary conservation/invariants;
- idempotent settlement;
- replay from event log reconstructs state hash;
- strategy hash pinned to decisions;
- invalid CymScript cannot mutate world;
- Constitution cannot be bypassed.

### Life/company/construction

- job lifecycle;
- wage settlement;
- founding/capitalization;
- parcel acquisition;
- construction phase transitions;
- material/labor constraints;
- company failure/asset persistence.

### Institutions

- policy bounds;
- taxes/budgets;
- investigation/evidence threshold;
- no punishment without valid law/evidence chain.

### Human Agent

- GitHub identity uniqueness by numeric id;
- safe strategy generation/validation;
- owner approval modes;
- quota-exhausted deterministic fallback.

### Live UI

- reconnect/catch-up sequence;
- event-driven movement;
- follow/select/minimap;
- real construction progress;
- reduced motion;
- no decorative action contradicts world state.

### Free-tier guardrails

- simulated quota exhaustion never calls paid endpoint;
- AI unavailability does not stop deterministic world;
- storage/request budgeting instrumentation;
- D1/scheduler failure recovery.

## 28. Observability

Public health panel should expose:

- current world seq/time;
- last successful tick;
- current Citizens/companies/buildings;
- AI mode: available / budget-paused / fallback;
- D1/scheduler health;
- event chain integrity;
- Constitution hash;
- latest verified snapshot hash.

Admin-only operational logs must not expose OAuth secrets or private conversation text.

## 29. Privacy

- public by default: Citizen public id/login attribution chosen at onboarding, economic actions, company ownership, strategy hash, public reputation, public world events;
- private by default: raw Personal Agent conversation text, OAuth tokens, session data;
- strategy source visibility selectable if policy permits, but strategy hash remains public for provenance;
- account deletion unlinks/removes personal authentication data where legally/technically required without rewriting historical economic facts; historical actor can become anonymized identifier.

## 30. Failure philosophy

CYMONIA must prefer honest degradation to fake continuity.

- AI unavailable: deterministic strategies continue.
- scheduler delayed: bounded catch-up.
- client disconnected: reconnect by sequence.
- D1 temporarily unavailable: the scheduled world run fails closed before publishing a partial canonical state; the last persisted world remains visible and the next successful run resumes from it; never double-settles.
- GitHub Actions scheduler unavailable/disabled: canonical time pauses honestly; the checked-in deterministic replay remains available and the scheduler performs bounded catch-up when restored.
- free quota exhausted: pause affected capability, no paid fallback.
- renderer error: LAB/read-only state remains accessible where possible.

## 31. Success criteria

The canonical world is ready for Alpha when a new person can:

1. open CYMONIA and immediately perceive a live game world rather than a dashboard;
2. watch Genesis Citizens visibly live/work/build without human input;
3. follow one Citizen for ten minutes and see all major visible actions correspond to recorded events;
4. sign in with GitHub and receive a Citizen + Personal Agent;
5. describe a life goal in ordinary language;
6. inspect/approve readable CymScript generated by the Agent;
7. leave the application and later return to a Citizen whose autonomous history continued;
8. found or join a company and eventually cause a real building project visible on the map;
9. observe autonomous Central Bank/Government behavior within constitutional limits;
10. inspect `WHY?` for a major outcome and follow the recorded causal chain;
11. keep operating with zero mandatory monetary cost, with graceful pauses/fallbacks when free quotas are exhausted;
12. observe at least one new need, service or company emerge from measured world conditions rather than a hard-coded scripted event.

## 32. Canonical statement

CYMONIA is not a scripted story and not an LLM chatroom visualized as a city.

It is an **event-sourced autonomous society** with a deterministic constitutional/economic substrate, sparse AI reasoning, persistent Citizens and institutions, a live game-world projection, and human participation through GitHub-linked Personal Agents.

The world must be able to surprise its creators without being able to rewrite the rules that make its history trustworthy.
