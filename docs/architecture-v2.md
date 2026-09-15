# CYMONIA v2 Architecture

## Authority boundary

The v2 canonical world has exactly one mutation authority: the `SovereignWorld` Durable Object. Browser clients, Pages Functions and GitHub Actions cannot directly change canonical state.

The world kernel decides whether an action is possible; Citizens decide which allowed actions they pursue. Observer classifications such as "proto-religious", "company-like" or "organized conflict" are descriptive and never change canonical behavior.

## Runtime flow

1. Durable Object loads or creates the v2 Genesis world in SQLite-backed storage.
2. An alarm wakes the object and advances canonical time to real time.
3. Due biological/environmental/action events execute in causal order.
4. Local deliberation keeps Citizens physically active between LLM decisions.
5. High-priority cognition items may call Workers AI within the configured daily budget.
6. Proposed AI plans pass epistemic and action validation before acceptance.
7. Canonical state is persisted and periodically sealed with SHA-256 checkpoints.
8. Live Observer clients receive snapshots/deltas through WebSocket.

## Causal world modules

`world/` is deliberately split by responsibility:

- `clock.js`, `ledger.js`, `rng.js`, `constants.js` — trusted kernel foundations.
- `materials.js`, `environment.js`, `actions.js`, `artifacts.js` — physical world and transformations.
- `biology.js`, `genetics.js`, `disease.js`, `reproduction.js` — life cycle.
- `memory.js`, `epistemics.js`, `perception.js`, `beliefs.js` — private knowledge boundary.
- `language.js`, `society.js` — emergent communication and social primitives.
- `cognition.js` — structured plans and validation.
- `observer.js` — non-authoritative classification/history.
- `engine.js` — catch-up integration and public projection.

## No social presets

The v2 canonical state contains no mandatory government, company, bank, police, court, religion, currency, property regime or family structure. Generic organization/claim/commitment primitives are available; social meaning must emerge from Citizen actions and mutual recognition.

## Human avatar

GitHub authentication remains outside the world in the account/session layer. Creating an avatar consumes the finite Genesis Observer Embodiment Reserve. External user intent becomes a direction/goal constraint and cannot import factual Earth knowledge into the avatar.

## Observer

The Observer is one full-viewport game shell. It visualizes only canonical state or clearly labeled derived classification. The Society History window is built from the ledger and can trace real events with `WHY?`.
