# Contributing to CYMONIA

CYMONIA is an open-source persistent artificial civilization. Contributions are welcome when they make the world richer **without weakening the causal, epistemic or authority boundaries that make the project meaningful**.

Start with:

1. [`README.md`](README.md) — product model.
2. [`docs/architecture/overview.md`](docs/architecture/overview.md) — runtime and trust boundaries.
3. [`docs/reference/repository-map.md`](docs/reference/repository-map.md) — file-by-file map.
4. [`docs/design/sovereign-world-v2.md`](docs/design/sovereign-world-v2.md) — world contract.

## Pick the right layer

| You want to change… | Start here |
|---|---|
| physics, resources, terrain, movement | `world/materials.js`, `world/terrain.js`, `world/actions.js`, `world/impact.js` |
| biology, disease, genetics, reproduction | `world/biology.js`, `world/disease.js`, `world/genetics.js`, `world/reproduction.js` |
| knowledge, perception, memory, beliefs | `world/epistemics.js`, `world/perception.js`, `world/memory.js`, `world/beliefs.js` |
| cognition and plans | `world/cognition.js`, `world/engine.js` |
| language or society | `world/language.js`, `world/society.js` |
| canonical persistence/runtime | `worker/src/index.js`, `worker/src/persistence.js` |
| GitHub auth / human-linked identity | `functions/api/auth/`, `functions/_lib/` |
| public API facade | `functions/api/v2/` |
| Observer UI and camera | `site/sovereign-world.js`, `site/sovereign-renderer.js` |
| GPU rendering | `site/pixi-observer.js`, `site/medieval-art.js` |
| visual concept interpretation | `site/observer-concepts.js` |
| Citizen animation | `site/citizen-animation.js`, `site/spine-citizen-adapter.js` |
| CI / deployment | `.github/workflows/`, `wrangler.toml`, `wrangler.world.toml` |
| documentation | `docs/` |

## Non-negotiable invariants

- The `SovereignWorld` Durable Object is the **single canonical writer**.
- The browser is an Observer. It does not advance world time or author canonical outcomes.
- Workers AI may **propose** cognition. Deterministic validation authorizes mutation.
- Citizens may not act on unknown concepts or receive omniscient context.
- Persistent physical outcomes require physical causes and provenance.
- Death is permanent.
- The deterministic Genesis replay remains reproducible.
- Observer-only classifications and visual labels never write back into canonical state.
- Human-linked Citizens receive no Earth knowledge or privileged physics.
- A runtime outage is not silently converted into fictional lived history.

## Development workflow

```bash
node --test tests/test_sovereign_*.mjs
bash CHECK.sh . --skip-browser
```

If you changed the Observer, rendering, browser connection or UI:

```bash
bash CHECK.sh .
```

## Tests are part of the feature

Every new canonical behavior should add or strengthen an invariant under `tests/test_sovereign_*.mjs`.

Examples:

- physical transformation → prove conservation/provenance;
- cognition path → prove unknown concepts cannot leak in;
- social primitive → prove canonical relationships/commitments change rather than narration only;
- Observer feature → prove it cannot mutate world state;
- persistence change → prove write budget, recovery and checkpoint behavior;
- UI change → add contract coverage and run browser smoke.

## Pull request format

A strong PR explains:

**Problem** — what limitation exists?
**World effect** — canonical behavior, Observer behavior or both?
**Authority boundary** — which layer may mutate state?
**Evidence** — which tests prove the behavior?
**Operational impact** — bindings, writes, schemas, budgets or deployment?

The repository includes a PR template that mirrors this structure.

## Security and identity

Never commit or log OAuth codes, access tokens, raw session tokens, Cloudflare secrets or private user data.

Identity metadata must not become free in-world knowledge.

Report vulnerabilities according to [`SECURITY.md`](SECURITY.md).

## Style

- Prefer small ES modules with explicit responsibilities.
- Prefer deterministic logic over hidden side effects.
- Delete obsolete paths instead of preserving dead compatibility layers.
- Comment invariants, authority boundaries and non-obvious runtime behavior.
- Use **Citizen**, **Observer**, **Sovereign World** and **canonical** consistently.

For a complete file-by-file explanation, use [`docs/reference/repository-map.md`](docs/reference/repository-map.md).
