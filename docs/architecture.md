# CYMONIA architecture

CYMONIA contains two compatible experimental layers: the original deterministic Genesis economy/research engine in Python and the new Autonomous World in JavaScript. Both remain reproducible and inspectable.

## Autonomous World pipeline

```text
GitHub identity ─────► Human-linked Citizen
       │                       │
       └────────────► Personal Agent ─► CymScript strategy
                                      │
Genesis 100 strategies ───────────────┤
Company / institution strategies ─────┤
                                      ▼
                            Deterministic World Engine
                                      │
                  ┌───────────────────┼─────────────────┐
                  ▼                   ▼                 ▼
              Economy             City/Life        Institutions
        jobs / trade / needs   land / buildings   CB / Govt / Justice
                  └───────────────────┼─────────────────┘
                                      ▼
                              Causal event ledger
                                      │
                              D1 canonical state
                                      │
                     ┌────────────────┴───────────────┐
                     ▼                                ▼
                Public APIs                      RTS World UI
```

## Trust boundaries

### Constitution
Runtime AI cannot change constitutional invariants. Any future constitutional change is a new explicitly identified world/fork.

### Strategy
CymScript is declarative and bounded. No loops, imports, filesystem, sockets, shell or dynamic evaluation are exposed.

### Settlement
Agents propose actions. Deterministic code checks balances and authority before state mutation. Visible activity must originate in world state or the causal event log.

### Institutions
Central Bank, Government, Police and Justice have separate bounded authority. Police records investigations; Justice acts on recorded evidence. LLM output alone is never evidence.

## Persistence

`autonomous_world_state` stores the current canonical world snapshot. `world_event_log` stores causal events independently. Human identities are mapped once in `world_human_links`; strategy history is versioned in `world_strategy_versions`.

The public endpoint `/api/world` is read-only. `/api/agent/*` requires the authenticated owner. `/api/world/advance` exists only for an authenticated scheduler token; the preferred free deployment instead computes ticks on GitHub runners and writes D1 through `scripts/advance_remote_world.mjs`.

## Rendering contract

`site/live-world.js` projects canonical data into an isometric canvas. Camera movement and interpolation are client-only; they cannot create economic events. World News and WHY use recorded events.

## Zero-cost fallback

`node scripts/build_world_replay.mjs` runs the same World Engine with the same seed and produces `site/data/world.json`. If the Cloudflare API is unavailable, the UI automatically loads this deterministic observation-only replay.

## Original engine

The Python `cymonia/` package remains the original reproducible market/policy experiment and AI laboratory. It is intentionally not deleted or silently reinterpreted by the Autonomous World work.
