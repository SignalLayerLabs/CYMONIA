# Deploying CYMONIA Sovereign World v2

## Cloudflare components

The production topology is:

1. Worker `cymonia-sovereign-world` from `wrangler.world.toml`.
2. Durable Object binding `WORLD`, class `SovereignWorld`, SQLite migration `sovereign-v2-genesis`.
3. Workers AI binding `AI` with `BRAIN_MODEL=@cf/zai-org/glm-4.7-flash` by default.
4. Pages project `cymonia` from `wrangler.toml`.
5. Pages service binding `WORLD_SERVICE` -> `cymonia-sovereign-world`.
6. Existing D1 binding `CYMONIA_DB` for identity/session metadata.

## Deployment order

Deploy the world Worker first, then Pages:

```bash
npm install --no-save wrangler@4
npx wrangler deploy --config wrangler.world.toml
node scripts/build_sovereign_genesis.mjs
npx wrangler pages deploy site --project-name cymonia --branch main
```

GitHub Actions encodes this ordering so Pages never points to a not-yet-deployed v2 worker.

## Secrets and bindings

Retain the existing GitHub OAuth/session secrets used by Pages Functions. Cloudflare deployment requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in GitHub Actions.

No `WORLD_ADVANCE_TOKEN` is required for v2. GitHub Actions is not the heartbeat.

## Production verification

Check the Pages facade:

```bash
curl -fsS https://cymonia.pages.dev/api/v2/health
```

Expected service path: Pages -> `WORLD_SERVICE` -> Sovereign Worker -> canonical Durable Object.

Then open the production site and verify that it enters the game-only Observer directly and that Society History opens over the same live world.

## Runtime reliability guardrails

The canonical world uses a one-minute Durable Object alarm cadence. Each alarm catches the deterministic world up to canonical real time, so reducing alarm frequency does not slow in-world time while it substantially reduces `setAlarm()` row writes.

Snapshot persistence uses a 40,000-row soft daily budget and a 60,000-row emergency ceiling, both below the 100,000 free-tier account ceiling. The remaining capacity is intentional headroom for alarms, SQLite index effects, migrations, and other account-level Durable Object writes.

Observer streaming uses the Durable Objects WebSocket Hibernation API. Active sockets are enumerated from `ctx.getWebSockets()` and carry serialized connection metadata so they remain usable after object eviction. A WebSocket-only outage does not mark the canonical world degraded while REST polling continues to return valid state; the stream reconnects independently with exponential backoff.

Cloudflare observability emits `CYMONIA_WS_CLOSE`, `CYMONIA_WS_ERROR`, and `CYMONIA_WS_SEND_FAILED` events for stream diagnostics without persisting additional rows.
