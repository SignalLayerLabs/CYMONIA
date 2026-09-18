# CYMONIA v2 — Sovereign World
## Complete Technical Design Specification

**Status:** Architecture approved; written specification prepared for final user review before implementation.
**Date:** 2026-09-15
**Project:** SignalLayerLabs/CYMONIA

## 1. Product thesis

CYMONIA v2 is not an economic dashboard, a scripted city-builder, or deterministic NPC logic presented as AI. It is a persistent artificial world in which the simulator defines what is physically and biologically possible, the inhabitants decide what actually happens, and the observer does not control the world.

> **The simulator determines what is possible. The inhabitants determine what happens. The observer determines nothing.**

Additional invariants:

> **Nothing exists without cause. Nothing is known without provenance. Nothing important happens off-ledger.**

The world must be able to evolve toward outcomes its developers did not explicitly design.

## 2. Non-negotiable principles

### 2.1 No scripted society

The engine must not contain social-outcome rules such as "if wealth > X, found a company", "every N ticks buy something", "if crime > X spawn police", "if population > X create government" or "if homeless build a house".

The kernel may expose only general capabilities such as move, observe, consume, sleep, gather, transform, carry, construct, communicate, cooperate, attack, defend, care, teach, experiment, transfer possession, promise, record and reproduce. Society emerges from combinations of these primitives.

### 2.2 No magic creation

Every persistent object must have causal provenance. A good, structure or artifact can exist only if its resources existed, an actor or environmental process caused its transformation, sufficient time elapsed, energy and labor requirements were met, and the result was committed to canonical history.

This applies to food, tools, buildings, roads, products, medicine, infrastructure, machines, records and any later currency artifacts.

### 2.3 Social rules are not physical rules

The kernel enforces physical and biological constraints. It does not enforce human social assumptions. It may track physical possession or occupancy, but it must not automatically enforce private ownership. It may model injury and death, but it must not contain a universal rule that homicide is illegal.

### 2.4 AI sovereignty

Citizens are the decision-makers. Developers define available physical actions, biology, perception, causal validation and runtime limits, but do not choose political, economic, religious or cultural outcomes for them.

### 2.5 Observer non-intervention

The public Observer may inspect, follow, translate, replay, query causal history and visualize actions. It must not spawn resources, move inhabitants, create firms, change beliefs, alter prices, issue laws, resurrect citizens or rewrite history.

Operational disaster recovery may only restore the latest valid canonical state and replay the canonical ledger.

## 3. Genesis

### 3.1 Genesis population

The world begins with exactly **100 Genesis Citizens**. They are adult organisms capable of locomotion, manipulation, perception, primitive affective responses, survival reflexes, learning and primitive signaling.

They do not begin with human cultural knowledge. They do not know English, Italian, existing nations, capitalism, socialism, religions, democracy, monarchy, corporations, banks, law, money, electricity, engines, computers, modern medicine or human history.

The Observer may initially identify them externally as `Genesis-001` through `Genesis-100`. If they later invent names, the Observer may show both observer ID and self-chosen name.

### 3.2 Genesis environment

The starting territory contains terrain, water, climate, weather, vegetation, soil, edible resources, minerals, stone, timber, renewable and finite resources, pathogens/disease ecology and natural hazards.

There is no existing city, commercial firm, government, court, police force, bank, religion or school.

### 3.3 Genesis endowment

A finite temporary survival endowment is explicitly recorded as `GENESIS_ENDOWMENT`. It may contain temporary shelters, limited water storage, limited food, simple generic tools and basic raw materials. It contains no manuals, maps, history or cultural instruction.

Every item has mass, composition, position, condition and provenance. Once consumed or destroyed it is gone.

### 3.4 Closed material world

After Genesis, no material good enters from outside. Matter cannot be created by observer actions. Energy enters only through explicitly modeled natural processes such as sunlight, wind, flowing water, heat gradients and chemical energy.

## 4. Canonical time

The immutable ratio is:

> **1 real minute = 1 CYMONIA hour**

Therefore 24 real minutes = 1 CYMONIA day, about 6.08 real days = 1 CYMONIA year, about six real months ≈ 30 CYMONIA years, and about sixteen real months ≈ 80 CYMONIA years.

The world continues when no browser is open.

World time is timestamp-based, not frontend-refresh-based. Every long action contains start world time, expected finish world time, origin, destination/path where relevant, purpose, resource reservation and interruption conditions. The client calculates visual progress from canonical world time.

## 5. World Kernel

The kernel is the smallest trusted computing base. It contains only rules required to keep the universe coherent.

Responsibilities:

- world clock;
- coordinates/topology;
- collision and occupancy constraints;
- resource accounting;
- material transformations;
- energy accounting;
- environmental processes;
- action scheduling;
- biology and mortality;
- causal ordering;
- epistemic validation;
- tamper-evident event ledger;
- deterministic PRNG for kernel stochastic processes.

It must not contain predefined governments, religions, legal systems, companies, fixed currencies, mandatory private property, fixed marriage/inheritance, predetermined technology eras, scripted wars or scripted social movements.

## 6. Physical world model

Atomic-scale physics is computationally impossible for this product. The binding contract is instead: **no simulated effect may occur without a modeled physical cause**.

### 6.1 Materials

Materials carry properties including mass, density, hardness, toughness, flexibility, brittleness, thermal tolerance, conductivity, combustibility, toxicity, nutritional properties where relevant, moisture, decay rate and biological compatibility.

Composite objects consist of parts and material quantities.

### 6.2 Generic transformations

The engine supports general processes such as cutting, crushing, mixing, heating, cooling, burning, drying, fermenting, joining, fastening, shaping, digging, filtering, grinding, dissolving, extracting and assembling. Thermal separation/metallurgy-like behavior is available only when physical conditions and acquired knowledge support it.

There is no fixed technology tree.

### 6.3 Invention feasibility

An invention is represented as a graph of intended function, components, material properties, transformations, energy source and operating process. The kernel determines whether the proposed design works under modeled physics. It may succeed, partially work or fail.

An invention cannot work merely because the LLM knows the real-world answer.

## 7. Environment

Environment evolves independently through day/night, seasons, temperature, weather, precipitation, soil moisture, vegetation growth, renewable-resource regeneration, water availability, resource depletion, fire, pollution, decomposition and disease exposure.

Environmental events change real constraints. Drought reduces water availability; winter changes temperature and food/energy pressure.

## 8. Biology

Every Citizen is a biological organism.

Canonical body state includes biological age, body mass, hydration, caloric reserve, fatigue, sleep debt, body temperature, injuries, disease, immune state, fertility, pregnancy where applicable, physical capability and sensory capability.

### 8.1 Needs

Needs are measurements, not scripted goals: hydration deficit, hunger, sleep pressure, thermal stress, injury, illness, safety perception and social isolation. Cognition decides how to respond.

### 8.2 Genetics

Organisms have inheritable traits with recombination and mutation affecting metabolism, disease susceptibility, physical capacity, fertility, sensory sensitivity, lifespan tendencies and temperament predispositions. Genetics does not directly encode ideology, profession, religion or language.

### 8.3 Reproduction and childhood

Reproduction is modeled biologically and non-explicitly through fertility, conception, pregnancy, birth and caregiving. Social concepts around reproduction are emergent.

Newborn Citizens start without cultural knowledge and must acquire language, beliefs, skills, norms and relationships through observation, imitation, teaching, communication and artifacts.

### 8.4 Aging and death

Death may result from aging, disease, starvation, dehydration, exposure, trauma or other modeled causes. Death is permanent. No automatic respawn exists.

The corpse remains physical matter. Possessions remain in the world. No automatic inheritance occurs unless inhabitants create and enforce such a concept.

## 9. Psychology

Each Citizen has persistent temperament, preferences, risk tolerance, curiosity, social drive, aggression tendency, empathy tendency, novelty seeking, stress, fear, attachment, trust, confidence, motivation, current goals and long-term aspirations. Experience can change these properties.

## 10. Memory

Memory is canonical state.

- **Episodic memory:** experienced events, location, time, participants, salience, confidence and source.
- **Semantic memory:** consolidated beliefs, including beliefs that may be wrong.
- **Procedural memory:** learned skills and action competence.
- **Forgetting:** memories decay according to salience, repetition, age, sleep, cognitive state and reinforcement.

Knowledge can therefore disappear from the world.

## 11. Epistemic Sovereignty

An LLM may contain latent Earth knowledge. CYMONIA inhabitants must not gain actionable access to that knowledge unless acquired in-world.

Every actionable concept carries provenance: direct observation, experiment, inference, teaching, communication, artifact, rumor or explicitly permitted biological prior.

### 11.1 Epistemic compiler

Before a proposed plan becomes canonical:

1. parse referenced concepts;
2. resolve each against the Citizen knowledge graph;
3. verify provenance;
4. verify known tools/materials/processes;
5. reject unsupported knowledge;
6. request or derive a plan using only allowed concepts.

If a model proposes a combustion engine while the Citizen lacks the necessary concepts, the proposal is invalid. The Citizen may only reason from what it has actually discovered.

The kernel distinguishes physical truth from Citizen belief. Citizens may be wrong.

## 12. Emergent language

No human natural language exists inside Genesis.

Citizens begin with primitive signaling capabilities: attention, direction, affect, danger, acceptance/rejection and referential pointing/association.

Lexicons emerge from repeated associations between generated signals and concepts. Lexicons are individual. Shared meaning grows through successful interaction. Grammar, dialects, writing, numerical notation and specialist vocabularies may emerge later.

The Observer may display external translations generated from canonical semantic mappings, but translations never flow back into Citizen cognition.

## 13. Cognition architecture

### 13.1 Reflex Engine

No LLM call. It executes immediate bodily and safety behavior: continue walking, eat known food, sleep, flee immediate danger, maintain a carried load and continue already-chosen physical work. Reflexes cannot invent social goals.

### 13.2 Deliberative Agent Policy

Runs frequently without an LLM. It chooses concrete next actions from current goals, active plans, needs, known opportunities/risks, commitments and relationships. It is a general planner constrained by each Citizen's knowledge graph, not a scripted social behavior tree.

### 13.3 LLM Cognitive Planner

Workers AI is invoked when open-ended reasoning materially matters: major surprise, significant new need, plan failure, discovery, interpersonal conflict, opportunity, existential threat, completion of a major goal, scientific experimentation, novel organization or reflection interval.

The LLM proposes structured goals, hypotheses, candidate plans, questions and social intentions. The epistemic compiler and kernel validate them before they can act.

### 13.4 Reflection

Lower-frequency reflection may change values, relationships, identity, ambitions, beliefs and group membership, giving Citizens continuity over a lifetime.

## 14. AI budget and degradation

The architecture must not depend on unlimited model calls. Cognition receives a configurable daily AI budget.

Priority order: survival-critical novel reasoning, major life decisions, plan failures, invention/experimentation, social negotiation, reflection.

If LLM capacity is unavailable, Citizens continue existing plans, reflexes and local deliberation. Low-priority reflection waits. The engine does not fabricate a replacement social decision authored by developers.

## 15. Action model

Every physical action is canonical and contains actor, type, intent, goal, target, start, expected finish, path, reserved resources, tool, collaborators, preconditions, interruption rules, result and causes.

Primitive actions include MOVE, OBSERVE, REST, SLEEP, EAT, DRINK, GATHER, CARRY, CUT, DIG, HEAT, ASSEMBLE, BUILD, CARE, TEACH, COMMUNICATE, EXPERIMENT, ATTACK, DEFEND, TRANSFER and PROMISE.

Human categories such as "company" or "government" are not primitive actions.

## 16. Buildings and land

Buildings never spawn directly from demand.

Required causal chain:

`perceived need/opportunity → idea → plan → access to site → resources → labor → tools → transport → construction actions → completed structure → actual use`

The kernel stores physical territory, occupancy, access, modifications and claims made by Citizens/groups. It does not impose a universal property regime.

A land claim becomes socially meaningful only to the degree others recognize or enforce it.

Citizens may build speculative structures. If nobody wants them, they remain empty and still require maintenance. Investors bear the result.

"Rent" is not a kernel feature. It may emerge as a recurring agreement granting access in exchange for something else.

## 17. Production and economy

There is no mandatory initial money.

The kernel supports possession, transfer, labor, services, promises, obligations, shared assets and resource pools.

Citizens may invent barter, gifts, credit, commodity money, token money, banks, insurance, equity, rent, wages, taxation, cooperatives or unknown systems.

### 17.1 Organizations

A generic Organization is only a coordination structure with members, roles, shared rules, assets, commitments, decision mechanisms and purpose.

The Observer may later classify an organization as a company, government, religion, military, school, guild, cooperative or family-like unit. Classification never changes behavior.

## 18. Culture, religion and ideology

Ideas are transmissible belief/knowledge objects. They spread through teaching, imitation, ritual, stories, artifacts, persuasion, coercion and prestige.

Religion is not hard-coded. It can emerge when beliefs become shared and socially organized. The same substrate supports myth, philosophy, ideology, science, superstition, tradition and propaganda.

## 19. Law and institutions

There is no government, police or court at Genesis.

Citizens can coordinate, form groups, establish rules, make commitments, recognize authority, punish, reward, arbitrate and delegate. If a community creates a rule system, the Observer may classify it as law. If a group creates enforcement, it may be classified as police-like. If a group monopolizes authority over territory, it may be classified as a state.

The kernel remains neutral.

## 20. Conflict and war

There is no `DECLARE_WAR` primitive. Conflict emerges from incompatible goals, scarcity, beliefs, relationships and power.

War is an Observer classification when canonical history shows sustained organized intergroup violence.

Combat is simulated through abstract physical state and outcomes. The public Observer must not expose actionable real-world weapon-building instructions.

## 21. Scientific discovery

`EXPERIMENT` is a generic epistemic action requiring a hypothesis, known materials, setup, action, observation and outcome. Citizens may culturally develop a scientific method, but experimentation is available as a physical capability.

Knowledge can be lost if all holders die, artifacts are destroyed, teaching fails or records become unreadable. Rediscovery is possible.

## 22. Human avatar

GitHub identity creates access to a **human-linked avatar**, never administrator rights.

The avatar enters the physical world with a body, local sensory access, no omniscient map, no privileged goods and no Earth technology injected into canonical cognition.

### 22.1 Closed-world reconciliation

Genesis includes a finite `Observer Embodiment Reserve`. When a human avatar enters, reserved matter/energy is converted into a body and logged. No arbitrary goods appear.

### 22.2 Personal AI Agent

The external user may provide direction such as become influential, avoid violence, seek knowledge, improve transport or build relationships. The Personal Agent converts intent into goal constraints, not knowledge.

If the user says "invent a car" but the avatar does not know what a car is, the in-world goal may become "seek a way to move people or loads faster".

### 22.3 Equal vulnerability

The avatar can be injured, fail, be deceived, imprisoned, influential, worshipped, ignored or killed. Death is permanent for that avatar identity. Any later entry must be a new distinct Citizen without inherited in-world knowledge.

## 23. Observer UI

The production UI is no longer a dashboard stack. **The world is the application.**

Remove/archive from the primary experience:

- old economic dashboard;
- duplicate city canvas;
- legacy macro charts;
- old transaction tables;
- Research as a primary tab;
- Mission Control as a separate page;
- Protocol as a separate page;
- old population cards.

Research and protocol remain available in GitHub/docs.

Main experience: fullscreen world, canonical time, population, selected entity inspector, event stream, map, filters, follow mode, timeline, causal WHY and Personal Agent entry.

A Citizen inspector may expose observer ID, self-name, age, health, location, current physical action, goal, active plan, relationships, beliefs, known concepts, memory timeline, language representation, possessions, needs and causal history.

Private external prompts for human-linked avatars are never public.

## 24. Continuous visual world

Snapshot-like movement is forbidden.

A moving Citizen has canonical action state containing path, start and finish. Position is derived continuously from canonical time. Gathering, building, eating, sleeping, talking, fighting, caring, teaching and experimenting are rendered only when those actions are actually occurring.

Decorative animation may exist only when clearly non-semantic.

## 25. Persistent runtime architecture

The existing five-minute GitHub Action heartbeat is insufficient.

Recommended production architecture:

- **Cloudflare Pages:** Observer frontend and existing auth-facing Pages Functions.
- **Dedicated SQLite-backed Durable Object Worker:** single-writer canonical world coordinator.
- **D1:** GitHub identity/session/account metadata and selected historical indexes.
- **Workers AI:** cognition only.
- **WebSocket:** real-time world deltas.
- **GitHub Actions:** CI, integrity verification, exports/backups and research/replay jobs, not the world clock.

The Durable Object owns canonical time, due-action queue, serialized mutations, live connections, cognition scheduling and checkpointing.

### 25.1 Alarms and catch-up

The Durable Object schedules the next relevant wake-up from action completions, biological transitions, environmental events and cognition deadlines.

If execution is delayed, it computes elapsed world time and processes all due events in order in bounded batches, immediately scheduling continuation when needed. Time is never silently skipped.

## 26. Real-time delivery

Clients subscribe to canonical deltas via WebSocket. A polling/delta endpoint remains a fallback.

The server does not send animation frames. It sends canonical action schedules; the client interpolates locally.

## 27. Canonical ledger

Every meaningful transition writes an immutable event: observation, action start/completion, resource transformation, communication, belief change, memory creation, injury, birth, death, organization formation, claim, commitment, construction stage, experiment, invention validation and accepted/rejected AI deliberation.

Events include event ID, world time, actor, type, payload, causal parents, previous ledger hash and event hash.

Every accepted LLM decision stores model ID, Citizen ID, world time, knowledge-context hash, memory-context hash, goal-state hash, structured proposal/safe retained representation, validation result, accepted plan and causes.

Replay never calls the model again. It reuses recorded accepted decisions.

## 28. Privacy boundary

Public Observer may inspect simulated internal state for Genesis Citizens, but must never publish raw human prompts, private GitHub data, auth tokens, private account metadata or hidden Personal Agent configuration unless the user explicitly opts in.

Public history exposes only in-world consequences and safe canonical summaries.

## 29. Safety boundary

CYMONIA may simulate violence, conflict, crime, harmful beliefs and dangerous inventions. Public output must not turn simulation state into actionable real-world wrongdoing or weapon-construction instructions. Unsafe implementation details can be represented internally at an abstract capability level while preserving in-world causality.

## 30. Storage model

Core records include:

- **World:** clock, environment, seed, version, ledger head, resource maps.
- **Citizen:** identity, body, genetics, psychology, location, action, goals, plans, inventory, knowledge, memory, language, relationships.
- **Object:** composition, parts, mass, condition, location, holder/container, provenance.
- **ResourceDeposit:** type, quantity, renewability, location, accessibility.
- **Action:** actor, parameters, start/end, status, preconditions, reservations, result.
- **Memory:** owner, type, content graph, source, confidence, salience, decay.
- **KnowledgeNode:** concept, provenance, confidence, observations, links.
- **Relationship:** subject/object, familiarity, trust, affection, fear, obligations, history.
- **Communication:** sender, receivers, symbols, intended semantics, receiver interpretation, outcome.
- **Organization:** membership, roles, rules, shared assets, goals, decision process.
- **Claim:** generic assertion such as possession, territory, debt, authority, promise or entitlement.

The kernel records claims but does not assume legitimacy.

## 31. Scaling

Genesis target is 100 Citizens. Architecture must allow growth through event-driven execution, long actions, spatial indexing, batched environment updates, memory compaction and cognition triggers rather than per-frame server simulation.

Target stages:

- 100: full fidelity;
- 1,000: same semantics with more batching;
- 10,000+: hierarchical scheduling/spatial partitioning;
- larger populations may later require multiple coordinated world regions.

Semantics do not change merely because population grows.

## 32. World Fidelity Contract

"100% real life" is operationally defined as:

1. no uncaused persistent state;
2. no scripted social outcomes;
3. no free knowledge;
4. no free resources;
5. no teleportation;
6. no fake economy;
7. no fake visual action;
8. biological needs have consequences;
9. social outcomes come from agents;
10. history persists;
11. death is permanent;
12. construction consumes modeled inputs;
13. knowledge can be lost;
14. institutions can fail;
15. investments can fail;
16. beliefs can be false;
17. agents can disagree;
18. agents can create new social structures;
19. agents can create novel technology within modeled physics;
20. observer cannot alter canonical history.

The simulator does not claim atomic physics or perfect human neurobiology. It claims **causal consistency inside its declared model**.

## 33. Migration from CYMONIA v1

The existing world must not be silently mutated into v2.

Archive v1 as `CYMONIA v1 — historical prototype`, preserving its engine, ledger, state and research artifacts.

v2 receives a fresh canonical world ID. Current v1 companies, money, buildings and institutions are not carried forward because they were created under rules incompatible with the v2 sovereignty contract.

Reusable components may include GitHub OAuth, sessions, Workers AI binding, D1 account records, deployment pipeline, selected renderer utilities and the causal WHY concept.

Replace the deterministic social engine, hard-coded institutions, GitHub five-minute heartbeat, dashboard-centric primary UI and snapshot-only motion.

## 34. Code boundaries

Proposed modules:

```text
world/
  kernel/
    clock
    ledger
    scheduler
    physics
    environment
    resources
    actions
    invariants
  biology/
    body
    needs
    genetics
    disease
    aging
    reproduction
    mortality
  cognition/
    reflex
    planner
    llm
    reflection
    goals
    validation
  epistemics/
    knowledge
    provenance
    memory
    inference
    forgetting
    experimentation
  language/
    signals
    lexicon
    grammar
    interpretation
    observer-translation
  society/
    relationships
    claims
    commitments
    organizations
    culture
    conflict
  artifacts/
    materials
    objects
    designs
    construction
    transformations
  runtime/
    durable-object
    alarms
    catchup
    stream
    persistence
observer/
  world-renderer
  citizen-renderer
  inspector
  why
  timeline
  overlays
  personal-agent
```

Runtime dependencies should remain minimal.

## 35. Testing strategy

### 35.1 Kernel invariant/property tests

Must prove matter conservation, no negative inventory, no impossible locations, no time reversal, no action finishing before start, no use of unavailable resources, no knowledge without provenance, no dead Citizen acting, no building without construction history, no object duplication and no accepted plan using forbidden knowledge.

### 35.2 Biology

Test hunger/dehydration, sleep, injury, disease, aging, pregnancy/birth, empty child cultural knowledge, death permanence and decomposition/material return.

### 35.3 Epistemics

Test Earth concept rejection when unknown, concept acceptance after valid learning, rumor producing false belief, forgetting, and written artifacts preserving knowledge after author death.

### 35.4 Social primitives

Verify that Citizens can make recurring commitments, form groups, create rules, refuse rules, create conflicting claims and change membership. Tests must never assert that a government/religion/company must exist by a certain time.

### 35.5 Construction

Every completed structure must prove provenance for design, materials, transport, labor and time.

### 35.6 Replay

Given Genesis state, kernel PRNG and recorded AI decisions, replay must reproduce canonical history without re-calling AI.

### 35.7 Browser

Verify no legacy dashboard below the world, fullscreen world-first experience, continuous canonical movement, real Citizen inspection, working WHY, truthful activity labels, responsive layout and safe live-stream reconnection.

## 36. Operational integrity

Production world mutation paths are limited to the World Durable Object, authenticated human-avatar intent and validated cognition flow.

There is no general admin endpoint to change world outcomes.

Maintenance tooling may verify, export, checkpoint, restore exact backups and replay. It may not manufacture preferred history.

## 37. Deployment architecture

Production:

- Cloudflare Pages — Observer frontend;
- Pages Functions — auth/API facade;
- dedicated Durable Object Worker — canonical world coordinator;
- Durable Object SQLite — high-frequency world state/event queue;
- D1 — identity/account metadata and selected indexes;
- Workers AI — LLM cognition;
- WebSocket — live deltas;
- GitHub Actions — CI/integrity/export, not world heartbeat.

Pages Functions bind to the dedicated Durable Object Worker.

## 38. AI scheduling policy

Each Citizen has cognition priority based on survival urgency, novelty, uncertainty, emotional salience, long-term importance, unresolved conflict and plan failure.

High-value cognition runs first. Low-value reflection is deferred. The system records deferred cognition rather than silently replacing it with developer-authored behavior.

## 39. Human direction boundary

External users may provide preferences, values, goals, priorities and risk posture.

They may not directly inject maps, technological recipes, hidden Citizen data, future knowledge, Earth history or material goods.

The Personal Agent is an advocate, not a cheat console.

## 40. Observer classification layer

Human-friendly labels such as company, religion, government, army, market, family, currency or school are generated descriptively from canonical structures.

Changing a label cannot change behavior. The Observer may show uncertainty, e.g. `proto-religious coordination — confidence 0.62`.

## 41. Definition of Done

CYMONIA v2 is not complete until all of the following are true.

### World

- fresh v2 Genesis exists;
- 100 Genesis Citizens exist;
- natural environment evolves;
- material world is closed;
- no social institutions are pre-spawned;
- canonical time runs at 1 real minute = 1 world hour;
- world continues without browsers.

### Citizens

- every Citizen has persistent cognition, needs, health, memory, knowledge and relationships;
- Citizens pursue individual goals;
- LLM cognition is event-driven;
- no Citizen uses unearned Earth knowledge;
- Citizens can learn, teach, forget and hold false beliefs.

### Life cycle

- birth, childhood learning, aging, disease/injury and death work;
- death is permanent;
- post-death possessions remain physical;
- knowledge can die with holders.

### Language

- no human language is granted at Genesis;
- primitive signals work;
- lexicons can emerge;
- communication can succeed/fail;
- observer translation is external only.

### Society

- organizations, beliefs, religions, governance, law, money, property norms, conflict and war can emerge;
- none is mandatory or pre-scripted.

### Economy/construction

- resources are conserved;
- production chains are physical;
- buildings require real inputs/labor/time;
- speculative construction can fail;
- occupancy/use is demand-driven;
- recurring access agreements such as rent can emerge;
- investment risk is real.

### Innovation

- no fixed tech tree;
- experiments create knowledge;
- inventions pass physical feasibility;
- novel non-Earth designs are possible within modeled physics;
- knowledge can be lost and rediscovered.

### Human avatar

- GitHub user can enter as a human-linked Citizen;
- Personal Agent represents user direction without leaking knowledge;
- avatar has equal physical vulnerability;
- avatar can influence/fail, be socially interpreted in any way and die permanently.

### Observer

- old dashboard removed from primary production experience;
- duplicate old city removed;
- world is homepage;
- actions render continuously from canonical state;
- movement is real, not decorative;
- Citizen inspector reflects canonical state;
- WHY traces real causes;
- observer cannot mutate the world.

### Runtime

- Durable Object single-writer deployed;
- action queue persists;
- alarms and catch-up work;
- WebSocket deltas work;
- AI quota exhaustion does not fabricate decisions;
- disaster recovery preserves canonical history.

### Quality

- kernel invariants green;
- biology tests green;
- epistemic tests green;
- replay tests green;
- browser tests green;
- CI green;
- production smoke green;
- production world verified live;
- no known path allows uncaused entity creation.

Only after this checklist is satisfied may the implementation be called complete.

## 42. Implementation order

1. archive v1 and introduce v2 schema boundary;
2. build kernel, clock, ledger and invariants;
3. build material/environment/resource system;
4. build biology, mortality and reproduction;
5. build actions and scheduler;
6. build memory and knowledge provenance;
7. build reflex/local deliberation;
8. integrate LLM planner and epistemic compiler;
9. build emergent signaling/language;
10. build relationships, claims, commitments and organizations;
11. build construction, artifacts and invention;
12. build conflict and shared-belief systems;
13. build Durable Object runtime and live stream;
14. build human-avatar embodiment and Personal Agent boundary;
15. replace production UI with Observer-only world;
16. remove legacy dashboard experience;
17. complete integration/replay/property/browser tests;
18. cut over production to v2 Genesis;
19. verify autonomous operation without browser;
20. preserve v1 as read-only archive.

No step is finished solely because the UI looks correct.

## 43. Explicit rejection of v1 behavior

The following v1 patterns must not survive as authoritative world behavior:

- hash/tick deciding social actions;
- deterministic company-founding thresholds;
- automatic citizen purchase schedules;
- pre-existing government/police/justice/central bank;
- scripted innovation from need records;
- five-minute GitHub Actions as simulation heartbeat;
- frontend-only motion between sparse snapshots;
- old dashboard below the new world;
- state labeled live when no action is actually progressing.

## 44. Final architecture statement

CYMONIA v2 is a **persistent artificial civilization substrate**.

The engine supplies physics, biology, perception, action, time and causal consistency.

The inhabitants supply goals, language, culture, technology, economy, religion, politics, morality, war, peace, institutions and history.

The Observer watches. It does not rule.
