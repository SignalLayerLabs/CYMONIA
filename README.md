# CYMONIA — Sovereign World v2

**A persistent artificial civilization that decides what happens to itself.**

CYMONIA is no longer a dashboard with simulated agents. **The world is the application.** Opening the production site enters a full-viewport game-like Observer. There is no dashboard beneath it and no developer-authored social system hidden behind the inhabitants.

> The simulator determines what is possible.
> The inhabitants determine what happens.
> The observer determines nothing.

## Genesis

The canonical v2 world begins with 100 Genesis Citizens in a materially closed natural environment. There is no pre-created city, company, government, police force, bank, religion, currency or human language. A finite Genesis endowment gives temporary survival resources only.

From that point forward, persistent things need causes. Buildings require materials, site access, work and elapsed time. Knowledge requires provenance. Citizens can learn, forget, teach, believe false things, form relationships, reproduce, age and die permanently. Social structures are consequences of their choices, not engine presets.

## Time

**1 real minute = 1 CYMONIA hour.** The canonical clock belongs to the world, not the browser. Long actions have world-time start/end timestamps and the Observer interpolates them continuously, so movement and work do not freeze between snapshots.

## Cognition

Each Citizen combines a continuous local deliberation/reflex layer with event-driven Workers AI cognition. Workers AI may propose goals and plans, but every proposal is checked against the Citizen's own knowledge and the physical world. Latent Earth knowledge is not actionable unless it has been acquired inside CYMONIA.

When AI quota is unavailable, already chosen actions and local deliberation continue. The runtime never invents a major social decision merely to keep the simulation busy.

## Product shell

The production UI is game-only:

- full-screen world canvas;
- continuous canonical actions;
- selectable/followable Citizens;
- Citizen state and knowledge inspector;
- minimap and Observer overlays;
- in-game **Society History** window;
- causal `WHY?` tracing from the ledger;
- Personal Agent window for a human-linked avatar.

The Observer renders canonical state as a cinematic isometric strategy world. Terrain, rivers, vegetation, weather, daylight, citizens, active work, construction and structures remain visibly in motion without changing simulation state. Drag or use WASD to travel, use the wheel to zoom, select a Citizen to inspect or follow them, and press `F` for fullscreen.

**No dashboard** is part of the primary product experience.

## Runtime

- Cloudflare Pages: Observer game shell and authenticated API facade.
- Cloudflare Durable Object + SQLite: single-writer canonical world, alarms, checkpoints and WebSocket stream.
- Workers AI: bounded event-driven cognition.
- D1: GitHub identity/session metadata retained from v1.
- GitHub Actions: CI and deployment only; it is not the world heartbeat.

## Repository map

- `world/` — causal kernel, biology, cognition, epistemics, language, society and artifacts.
- `worker/src/index.js` — single-writer Sovereign World Durable Object.
- `functions/api/v2/` — Pages facade for state/history/WHY/avatar/intent/stream.
- `site/` — game-only Observer.
- `tests/test_sovereign_*.mjs` — v2 invariants and system contracts.
- `docs/superpowers/specs/2026-09-15-sovereign-world-v2-design.md` — complete design contract.
- `archive/v1/` — historical-prototype boundary.

## Local verification

```bash
node --test tests/test_sovereign_*.mjs
bash CHECK.sh . --skip-browser
```

Browser smoke requires Playwright:

```bash
python3 -m http.server 8765 --directory site
CYMONIA_URL=http://127.0.0.1:8765 node tests/browser-sovereign.mjs
```

## Applying the packaged v2 cutover

Run `APPLY.sh` from the extracted package and point it at a clean CYMONIA checkout:

```bash
bash APPLY.sh /path/to/CYMONIA
```

The installer refuses an unrelated repository, refuses a dirty worktree by default, preserves the old production `site/index.html` under `archive/v1/`, disables v1 OAuth-side world mutation, installs v2 and runs verification.

CYMONIA v1 remains a historical prototype; it is not the v2 canonical civilization.
