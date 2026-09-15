# Cloudflare production deployment

CYMONIA production runs on Cloudflare Pages + Pages Functions + D1 + Workers AI. GitHub is source control, CI and the free five-minute world clock. GitHub Pages is only an optional manual static mirror.

## Runtime architecture

```text
GitHub main
  -> CI tests
  -> browser smoke
  -> D1 migrations
  -> Cloudflare Pages/Functions deploy
  -> production health check

GitHub scheduled Live Economy (5 min)
  -> legacy deterministic economy step
  -> POST https://cymonia.pages.dev/api/world/advance
  -> Cloudflare D1 canonical Autonomous World

Cloudflare Pages Functions
  -> D1 (CYMONIA_DB)
  -> Workers AI (AI)
  -> @cf/zai-org/glm-4.7-flash
```

## One-time GitHub repository configuration

Add repository Actions secrets:

- `CLOUDFLARE_API_TOKEN` — Cloudflare token with Pages deploy and D1 edit permissions for this account/project.
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID.
- `WORLD_ADVANCE_TOKEN` — same random value configured as the Cloudflare Pages runtime secret.

Optional repository variable:

- `CYMONIA_WORLD_URL` — defaults to `https://cymonia.pages.dev` if omitted. Set this to a custom production domain later.

## One-time Cloudflare Pages runtime secrets

These remain in Cloudflare and are preserved by CI deploys:

```bash
npx wrangler@4 pages secret put GITHUB_CLIENT_ID --project-name cymonia
npx wrangler@4 pages secret put GITHUB_CLIENT_SECRET --project-name cymonia
npx wrangler@4 pages secret put SESSION_HASH_SECRET --project-name cymonia
npx wrangler@4 pages secret put WORLD_ADVANCE_TOKEN --project-name cymonia
```

The GitHub OAuth callback must be:

```text
https://cymonia.pages.dev/api/auth/callback
```

or the equivalent custom-domain callback after a custom domain is enabled.

## Automatic production flow

Every push to `main` runs `.github/workflows/ci.yml`. Cloudflare deployment occurs only after both the complete test job and Playwright browser smoke are green. The deploy job then:

1. rebuilds deterministic static/research data;
2. applies unapplied migrations to `cymonia-participation`;
3. deploys `site/` and `functions/` to the `cymonia` Pages project;
4. verifies `https://cymonia.pages.dev/api/health`;
5. requires the health response to report the configured GLM model.

A failed test, browser smoke, migration, deployment or production health check prevents a successful release.

## Personal Agent AI

`env.AI` is bound as `AI` by `wrangler.toml`. The configured model is `@cf/zai-org/glm-4.7-flash`. The Personal Agent sends the owner's intent plus the current validated strategy to Workers AI and requests a strict JSON strategy schema. It cannot change Agent autonomy mode, transfer CYM, call tools, bypass the Constitution, or directly mutate D1.

The model result is converted into CymScript and parsed again before persistence. If Workers AI is unavailable, malformed or quota-limited, CYMONIA falls back to the deterministic intent translator. No paid third-party provider is used.

## D1 and Workers AI bindings

Production bindings are declared in `wrangler.toml`:

- `CYMONIA_DB` -> `cymonia-participation`
- `AI` -> Workers AI
- `BRAIN_MODEL` -> `@cf/zai-org/glm-4.7-flash`

## Avoid duplicate Cloudflare deployments

If the existing `cymonia` Pages project is also connected through Cloudflare's GitHub automatic-build integration, disable automatic production builds there (or disconnect the Git integration) once this GitHub Actions deploy flow is enabled. Otherwise a push to `main` can create two deployments: one directly from Cloudflare Git integration and one after CI.

The CI-gated GitHub Actions path is the canonical production deploy.
