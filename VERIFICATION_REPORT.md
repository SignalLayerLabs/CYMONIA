# Verification report — Cinematic Autonomous World

Generated: 2026-09-15

## Fresh verification performed before packaging

- JavaScript/domain suite: **95/95 pass** (`node --test tests/test_*.mjs`).
- Python suite: **50/50 pass** (`python -m unittest discover -s tests -v`).
- Original economy smoke: **100 epochs, verify OK, 0 problems**.
- Autonomous World static replay: **tick 72, 100 Citizens, 17 companies, 17 buildings, 12 needs, 11 innovations**.
- Replay reproducibility: generated twice and compared byte-for-byte.
- Replay SHA-256: `1d4b9390234147c0da024917994efbfdd315d62020219c2f4cca96dd42d05bda`.
- JavaScript syntax: every `.js`/`.mjs` under `functions/`, `site/`, `scripts/`, and `tests/` passed `node --check`.
- Legacy event sequence rollover regression fixed and covered by `tests/test_autonomous_world.mjs`.
- Research retry regression fixed: a failed/malformed research snapshot is no longer cached, so Retry performs a fresh fetch.
- Browser CI readiness probe now waits cleanly for the static server and reports the server log only if startup actually fails.

## Browser smoke

Astra's cinematic browser smoke previously passed with 121 visible entities, 4 institutions, Citizen follow, zoom/pan/reset, pause, keyboard, fullscreen, building/company picking, WHY, agent login, responsive tablet/mobile checks and zero page errors.

The subsequent CI run exposed the malformed-research Retry regression (`studyRequests` 1 instead of 2). That root cause has been fixed in `site/app.js`. Local Playwright installation timed out in this packaging runtime, so the updated browser smoke must be re-validated by GitHub Actions; this report does not claim a fresh local Playwright pass after the fix.

## Deployment contract

The static UI falls back to deterministic `site/data/world.json`. Persistent operation uses Cloudflare D1 plus Pages Functions; scheduled world compute can run on the public GitHub Actions runner and write the result to D1 with narrowly scoped Cloudflare credentials.
