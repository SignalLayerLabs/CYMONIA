# Zero-mandatory-cost deployment

CYMONIA can be published without a mandatory paid service. The free architecture deliberately has no automatic paid fallback.

## 1. Static World / research site

GitHub Pages can host `site/`. The Pages workflow generates `site/data/world.json` at deploy time:

```bash
node scripts/build_world_replay.mjs
python scripts/build_site.py
python scripts/build_experiments.py
```

This mode is observation-only but uses the real deterministic Autonomous World Engine.

## 2. Persistent multiplayer world on Cloudflare

Create a D1 database and place its UUID in `wrangler.toml`:

```bash
npx wrangler@latest login
npx wrangler@latest d1 create cymonia-participation
npx wrangler@latest d1 migrations apply cymonia-participation --remote
npx wrangler@latest pages project create cymonia
npx wrangler@latest pages deploy site --project-name cymonia
```

D1 binding name must remain `CYMONIA_DB`.

## 3. GitHub OAuth

Create a GitHub OAuth/GitHub App with callback:

```text
https://YOUR-PAGES-ORIGIN/api/auth/callback
```

Set Pages secrets:

```bash
npx wrangler@latest pages secret put GITHUB_CLIENT_ID --project-name cymonia
npx wrangler@latest pages secret put GITHUB_CLIENT_SECRET --project-name cymonia
npx wrangler@latest pages secret put SESSION_HASH_SECRET --project-name cymonia
```

One numeric GitHub user id maps to one canonical human-linked Citizen.

## 4. Optional Workers AI

Bind Workers AI as `AI` if the current free allocation is available. The world does not depend on an AI call for routine life. If AI is unavailable, deterministic CymScript translation and execution continue.

No paid third-party LLM key is required.

## 5. Autonomous clock without Cloudflare simulation CPU

The `Live Economy` GitHub Action already runs every five minutes. For the persistent Autonomous World, add these repository secrets:

- `CF_ACCOUNT_ID`
- `CF_D1_DATABASE_ID`
- `CF_API_TOKEN` with minimum D1 edit permission

The action runs:

```bash
node scripts/advance_remote_world.mjs
```

The tick is computed on the GitHub runner and the resulting state/event rows are sent to D1. If these secrets are absent, the step exits successfully and performs no remote mutation.

## 6. Production validation

```bash
node --test tests/test_*.mjs
python -m unittest discover -s tests -v
node scripts/build_world_replay.mjs
python scripts/build_site.py
python scripts/build_experiments.py
python -m cymonia verify --root state
```

Deploy D1 migrations before deploying Pages Functions.

## 7. Failure behavior

- AI unavailable: deterministic Agent fallback; no paid provider.
- D1 unavailable: API returns an operational error; UI can still use the static replay.
- Remote clock credentials absent: scheduled persistent tick is skipped.
- Free-tier quota exhausted: the system stops that optional operation instead of inventing activity or routing to paid infrastructure.

CYMONIA never treats an infrastructure failure as a successful economic event.
