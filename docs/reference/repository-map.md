# CYMONIA Repository Map

> **`world/` defines what can happen. `worker/` owns when canonical state changes. `functions/` authenticates and proxies. `site/` observes. `tests/` prove the boundaries.**

## Root

| Path | Purpose |
|---|---|
| `README.md` | Product landing page and technical overview |
| `CONTRIBUTING.md` | Contributor workflow and invariants |
| `SECURITY.md` | Security scope and trust boundaries |
| `LICENSE` | MIT license |
| `CHECK.sh` | Repository-wide verification |
| `MANIFEST.sha256` | Integrity manifest |
| `wrangler.toml` | Cloudflare Pages, D1 and service binding |
| `wrangler.world.toml` | Sovereign Worker, Durable Object and Workers AI |

## `.github/`

| Path | Purpose |
|---|---|
| `.github/workflows/ci.yml` | CI plus production deployment/verification |
| `.github/workflows/pages.yml` | Pages deployment |
| `.github/CODEOWNERS` | Review ownership |
| `.github/PULL_REQUEST_TEMPLATE.md` | Authority/evidence PR template |
| `.github/ISSUE_TEMPLATE/*` | Structured bug and feature proposals |

## `world/` — canonical simulation kernel

| File | Responsibility |
|---|---|
| `index.js` | Kernel exports |
| `constants.js` | Constitutional constants / time scale |
| `clock.js` | World-time mapping |
| `rng.js` | Deterministic random source |
| `ledger.js` | Canonical events and hash continuity |
| `genesis.js` | Deterministic Genesis |
| `materials.js` | Material properties and transformations |
| `terrain.js` | Terrain, costs, routing and placement |
| `environment.js` | Climate and environmental state |
| `actions.js` | Canonical action lifecycle |
| `artifacts.js` | Objects and provenance |
| `designs.js` | Learned designs / construction requirements |
| `impact.js` | Kinetic damage and fracture |
| `biology.js` | Needs, health and physiology |
| `genetics.js` | Inherited traits |
| `disease.js` | Disease state |
| `reproduction.js` | Pregnancy, birth and biomass transfer |
| `memory.js` | Memory and forgetting |
| `epistemics.js` | Knowledge provenance / actionability |
| `perception.js` | Sensory concept acquisition |
| `beliefs.js` | Fallible beliefs |
| `language.js` | Signals, lexicon and grammar |
| `society.js` | Relationships, claims, commitments and organizations |
| `cognition.js` | Cognitive context and proposal validation |
| `observer.js` | Non-authoritative derived history/classification |
| `engine.js` | Advancement, deliberation, avatars and public projection |

## `worker/` — canonical runtime

| File | Responsibility |
|---|---|
| `worker/src/index.js` | Durable Object lifecycle, alarms, AI, APIs, avatars, persistence and WebSockets |
| `worker/src/persistence.js` | Snapshot codec, write budgets and slot helpers |

## `functions/` — Pages boundary

| File | Responsibility |
|---|---|
| `functions/_lib/auth.js` | Auth cookies and opaque tokens |
| `functions/_lib/http.js` | HTTP helpers and session requirements |
| `functions/_lib/identity.js` | D1 actor/session/OAuth persistence |
| `functions/api/auth/[[path]].js` | GitHub OAuth / logout |
| `functions/api/v2/[[path]].js` | State, history, WHY, stream, avatar and intent facade |

## `migrations/`

`migrations/0001_identity.sql` defines D1 actors, OAuth states and sessions. This is external identity metadata, not Citizen knowledge.

## `site/` — public Observer

| File | Responsibility |
|---|---|
| `index.html` | Product shell and SEO metadata |
| `sovereign-world.js` | Browser app state, HUD, inspector, history and owned avatar |
| `sovereign-renderer.js` | Camera, selection, Canvas fallback, minimap, follow/locate |
| `pixi-observer.js` | PixiJS GPU world rendering |
| `observer-connection.js` | REST/WebSocket/replay connection semantics |
| `observer-concepts.js` | Human-readable labels for opaque concepts |
| `citizen-animation.js` | Action-to-animation and procedural poses |
| `spine-citizen-adapter.js` | Optional licensed Spine adapter |
| `medieval-art.js` | Atlas/projection helpers |
| `terrain-model.js` | Browser terrain interpretation |
| `transient-physics.js` | Observer-only Matter.js effects |
| `sovereign-world.css` | Core shell styles |
| `medieval-world.css` | Isometric visual treatment |
| `icon.svg` | Browser icon |
| `preview.png` | Social/Open Graph preview |
| `robots.txt` | Search crawling policy |
| `sitemap.xml` | Public sitemap |
| `llms.txt` | Machine-readable project summary |
| `data/sovereign-genesis.json` | Deterministic frozen Genesis fallback |
| `assets/medieval-atlas.png` | Current production atlas |
| `assets/meadow-texture.png` | Current terrain material |

## `scripts/`

- `build_sovereign_genesis.mjs` — rebuilds deterministic replay.
- `patch_current_v2.mjs` — maintenance patcher with regression coverage.

## `tests/`

### Browser
- `browser-sovereign.mjs` — canonical rendering, movement, shell and mobile.
- `browser-replay.mjs` — API outage and replay fallback.
- `browser-art.mjs` — Canvas/GPU visual contract.

### World behavior
Action effects, actions, artifacts, beliefs/language, biology, cognition, conservation, construction, engine, epistemics, exposure, Genesis, history, impact, language, local deliberation, mass closure, material transform, emergence, physics, relationships, reproduction, shelter and society are covered by the corresponding `test_sovereign_*.mjs` files.

### Runtime
Persistence, row-write budget, ledger compaction, runtime contract, delivery and maintenance-patcher behavior have dedicated sovereign tests.

### Observer/product
Avatar ownership, animation, connection semantics, readable concepts, Pixi/Matter boundary, shell, renderer motion and transient effects have dedicated sovereign tests.

`test_sovereign_repository_presentation.mjs` protects the repository/SEO cleanup itself.

## `docs/`

| Path | Purpose |
|---|---|
| `docs/README.md` | Documentation hub |
| `docs/architecture/overview.md` | Authority and runtime architecture |
| `docs/architecture/physics.md` | Detailed physical model |
| `docs/design/sovereign-world-v2.md` | Sovereign World specification |
| `docs/design/self-evolving-world.md` | Self-evolving design direction |
| `docs/observer/art.md` | Art/rendering boundary |
| `docs/observer/spine.md` | Optional Spine integration |
| `docs/operations/deployment.md` | Cloudflare deployment |
| `docs/reference/repository-map.md` | This map |
| `docs/history/*` | Historical release/implementation records |
| `docs/images/*` | Documentation screenshots |

## Where should my PR go?

If it changes what can happen → `world/`.
If it changes persistence/scheduling/AI/streaming → `worker/`.
If it changes auth/API translation → `functions/`.
If it changes how humans see the world → `site/`.

If you cannot identify the authority owner, open a proposal first.
