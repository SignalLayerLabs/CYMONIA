# Contributing to CYMONIA

CYMONIA contributions should preserve a causal, observable and deterministic Sovereign World.

## Before opening a PR

1. Read `README.md`, `docs/architecture-v2.md` and the design specification.
2. Run the focused suite:

   ```bash
   node --test tests/test_sovereign_*.mjs
   bash CHECK.sh . --skip-browser
   ```

3. Run `tests/browser-sovereign.mjs` against a local static server when changing the Observer.

## Runtime rules

- The Durable Object is the only writer of canonical world state.
- The browser renders and sends explicit intents; it never advances time.
- AI may propose cognition, but deterministic kernel rules authorize mutation.
- Every persistent action needs a physical, biological or social cause.
- New world behavior needs an invariant test under `tests/test_sovereign_*.mjs`.
- Keep the fallback Genesis replay deterministic and reproducible.

## Pull requests

Describe the problem, the resulting behavior, the tests run and any schema or deployment impact. Keep changes focused and remove obsolete runtime paths instead of adding compatibility aliases.

## Security and identity

GitHub OAuth creates a human-linked avatar through the identity-only D1 store. Never log OAuth codes, access tokens, session secrets or raw personal data. Report security issues privately according to `SECURITY.md`.
