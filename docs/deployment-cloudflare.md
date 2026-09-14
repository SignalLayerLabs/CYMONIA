# Zero-budget deployment: Cloudflare + GitHub

CYMONIA's participatory Alpha keeps the canonical Genesis simulation on GitHub while running identity, wallets, Economic Contracts, PoEC settlement and AI Companies on Cloudflare Pages Functions + D1. Workers AI is proposal-only; deterministic code owns money and settlement.

## 1. Prerequisites

- A free Cloudflare account.
- Node.js 22+ and Python 3.12+.
- A GitHub account able to create a GitHub App.
- This repository checked out locally.

Install/login to Wrangler without adding a runtime dependency:

```bash
npx wrangler@latest login
npx wrangler@latest --version
```

## 2. Create the D1 database

```bash
npx wrangler@latest d1 create cymonia-participation
```

Copy the returned database UUID into `wrangler.toml` as `database_id`. Keep the binding name exactly `CYMONIA_DB`.

Apply the schema locally and remotely:

```bash
npx wrangler@latest d1 migrations apply cymonia-participation --local
npx wrangler@latest d1 migrations apply cymonia-participation --remote
```

The migration creates the Contribution Treasury but does not seed spendable CYM until the first API request. `TREASURY_GENESIS_CYM` controls that experimental reserve; default: 10,000 internal CYM.

## 3. Create the Pages project

```bash
npx wrangler@latest pages project create cymonia
```

Deploy once so Cloudflare creates the Pages Function environment:

```bash
npx wrangler@latest pages deploy site --project-name cymonia
```

Your production origin will look like `https://cymonia.pages.dev` or a Cloudflare-generated variant if that name is already taken.

## 4. Create the GitHub App

In GitHub: **Settings → Developer settings → GitHub Apps → New GitHub App**.

Use:

- Homepage URL: your Pages production origin.
- Callback URL: `https://YOUR-PAGES-ORIGIN/api/auth/callback`.
- Webhook: not required for Alpha.
- Repository permissions: none are required for the current identity-only flow.
- User permissions: no private profile permission is required; CYMONIA reads the authenticated user's public `/user` identity.

Generate a Client Secret. Keep it private. GitHub's web application flow redirects the user to the configured callback URL and returns an authorization code; CYMONIA validates an OAuth state value before exchanging it.

## 5. Configure variables and secrets

Edit `wrangler.toml`:

```toml
TREASURY_STEWARD_LOGINS = "your-github-login"
```

The steward gate prevents every new account from draining the experimental Contribution Treasury. Multiple stewards are comma-separated.

Set encrypted secrets on the Pages project:

```bash
npx wrangler@latest pages secret put GITHUB_CLIENT_ID --project-name cymonia
npx wrangler@latest pages secret put GITHUB_CLIENT_SECRET --project-name cymonia
npx wrangler@latest pages secret put SESSION_HASH_SECRET --project-name cymonia
```

Generate `SESSION_HASH_SECRET` locally, for example:

```bash
python -c 'import secrets; print(secrets.token_urlsafe(48))'
```

For local development, copy `.dev.vars.example` to `.dev.vars` and fill the same values. `.dev.vars` is ignored by Git.

## 6. Bind D1 and Workers AI

D1 is declared in `wrangler.toml` as `CYMONIA_DB`.

For the deployed Pages Function, add Workers AI in Cloudflare Dashboard:

**Workers & Pages → cymonia → Settings → Bindings → Add → Workers AI**

Use variable name:

```text
AI
```

The default model is `@cf/zai-org/glm-4.7-flash`. It is deliberately behind the `env.AI` binding and may be changed later without changing CYMONIA's monetary rules.

Cloudflare currently documents Workers AI bindings for Pages Functions through the dashboard. If the AI binding is missing, the rest of the economy still works; only **Ask AI to detect a need** returns an error.

## 7. Local development

After filling `wrangler.toml` and `.dev.vars`:

```bash
npx wrangler@latest d1 migrations apply cymonia-participation --local
npx wrangler@latest pages dev site
```

Open the local URL printed by Wrangler and go to `/#participate`.

GitHub OAuth callbacks must match a configured GitHub App callback URL. For real OAuth testing, add the exact local/tunnel callback you control to the GitHub App. Do not enable wildcard callback matching just for convenience.

## 8. Production deploy

Before deploying:

```bash
python -m unittest discover -s tests -v
node --test tests/test_ui.mjs tests/test_economy.mjs tests/test_store.mjs tests/test_api.mjs tests/test_participate.mjs
python scripts/build_site.py
python scripts/build_experiments.py
python -m cymonia verify --root state
```

Then:

```bash
npx wrangler@latest d1 migrations apply cymonia-participation --remote
npx wrangler@latest pages deploy site --project-name cymonia
```

After changing a Pages binding or secret in the dashboard, redeploy.

## 9. Smoke checks

```bash
curl -s https://YOUR-PAGES-ORIGIN/api/health
```

Expected fields include:

```json
{"ok":true,"north_star":"detect-fund-work-prove-settle-learn","external_token":false}
```

Then visit:

```text
https://YOUR-PAGES-ORIGIN/#participate
```

Sign in with GitHub. A new user receives **20 bCYM** and **0 earned CYM**. Login never creates earned capital.

## What is intentionally not deployed

Alpha has no blockchain, wallet address, exchange, fiat conversion, token sale, redemption, guaranteed yield, or external price. Economic Stakes are internal accounting positions, not legal equity. CYM becomes earned capital only after the PoEC path settles funded escrow.

## Free-tier reality

This architecture is designed to start at €0, not to pretend infrastructure is infinitely free. Workers AI's free allocation and D1's daily free limits can be exhausted; when a limit is reached Cloudflare rejects further operations until reset/upgrade. The UI must therefore treat API/AI failure as a visible operational state, never as fabricated economic activity.
