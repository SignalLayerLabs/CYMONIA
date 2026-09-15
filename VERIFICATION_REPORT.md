# Verification report — Cinematic Autonomous World release

Generated: 2026-09-15

## Fresh verification performed before packaging

- JavaScript/domain suite: **95/95 pass** (`node --test tests/test_*.mjs`).
- Python suite: **50/50 pass** (`python -m unittest discover -s tests -v`).
- Original economy smoke: **100 epochs, verify OK, 0 problems**.
- Autonomous World static replay: **tick 72, 100 Citizens, 17 companies, 17 buildings, 12 needs, 11 innovations**.
- Replay reproducibility: generated twice and compared byte-for-byte.
- Replay SHA-256: `1d4b9390234147c0da024917994efbfdd315d62020219c2f4cca96dd42d05bda`.
- Research artifact reproducibility: `site/data/experiments.json` reproduced with zero diff.
- JavaScript syntax: every `.js`/`.mjs` under `functions/`, `site/`, `scripts/`, and `tests/` passed `node --check`.
- Remote world clock with missing Cloudflare secrets: exits safely without mutation.

## Fixed release blocker

Legacy Autonomous World snapshots could lose the monotonic event sequence after the in-memory rolling event window reached 5,000 entries. The event allocator now derives the next sequence from the highest valid persisted event ID when `event_sequence` is absent. The regression test `legacy worlds resume event numbering above existing IDs` now passes, and the full JavaScript suite is green.

## Browser smoke

The Astra cinematic-renderer session completed the dedicated world browser smoke successfully before this packaging fix:

`PASS: world assets, 121 visible entities, 4 institutions, Citizen follow, zoom/pan/reset, pause, keyboard, fullscreen, building/company picking, WHY, agent login, mobile/tablet, live snapshot and error recovery; zero page errors.`

The packaging runtime used for the final event-sequence fix does not have the Playwright package installed, so the browser smoke was not re-run here. The final fix is isolated to the server-side world event-sequence allocator and does not change renderer, scene, CSS, assets, or browser interaction code. GitHub CI installs Playwright and runs both `tests/browser.mjs` and `tests/browser-world.mjs` on push/PR.

## Deployment contract

The static UI falls back to deterministic `site/data/world.json`. Persistent operation uses Cloudflare D1 plus Pages Functions; scheduled world compute can run on the public GitHub Actions runner and write the result to D1 with narrowly scoped Cloudflare credentials.
