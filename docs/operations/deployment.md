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

The canonical world uses a fifteen-second Durable Object alarm cadence. This divides simulation CPU across four invocations per real minute while preserving the original world clock and one-checkpoint-per-60-world-minute schedule.

Snapshot persistence uses a 40,000-row soft daily budget and a 60,000-row emergency ceiling, both below the 100,000 free-tier account ceiling. The remaining capacity is intentional headroom for alarms, SQLite index effects, migrations, and other account-level Durable Object writes.

Production Observer transport is canonical REST polling every 10 seconds through `/api/v2/state`. The endpoint streams the compressed committed public snapshot, and `ObserverConnection` preserves world identity, rejects clock regression, retries transient outages, and keeps rendering the last canonical state while degraded.

WebSocket support is quarantined from production after repeated `1006` abnormal closures were reproduced both through Pages and through the direct Sovereign Worker endpoint while canonical REST health continued to advance and persist successfully. The server-side WebSocket implementation remains available for isolated diagnostics, but deployment correctness no longer depends on it. See [Realtime transport quarantine](direct-websocket-topology.md).

Cloudflare observability may still emit `CYMONIA_WS_CLOSE`, `CYMONIA_WS_ERROR`, and `CYMONIA_WS_SEND_FAILED` events during explicit WebSocket diagnostics without persisting additional rows.



Alarm recovery is deliberately non-postponing. A missing alarm is scheduled normally. A recently due alarm is left untouched so Cloudflare can deliver it. If an alarm is abnormally stale, HTTP traffic may pull it to a near-immediate recovery time, but repeated `/health` polling must never move that recovery farther into the future. See [heartbeat recovery](heartbeat-recovery.md).


## Alarm delivery under production verification

Production reads repair only a missing Durable Object alarm. Existing alarms, including overdue alarms, are never rewritten by `/health` or `/state`; Cloudflare remains responsible for delivering them. CI uses quiet 75-second sampling windows instead of two-second polling loops so verification cannot starve the scheduler it is testing. See [alarm delivery starvation](alarm-delivery-starvation.md).

## Canonical memory path V2

Canonical checkpoints now stream gzip output into bounded encoded SQLite parts, so the write path does not create a whole compressed checkpoint buffer and then a second complete base64 string before splitting it. Canonical commit finishes before the Observer projection is refreshed. A public-projection failure cannot roll back an already committed world checkpoint, and waking `/health` does not build the Observer world. See [Memory Path V2](memory-path-v2.md).

## Durable Object memory-pressure model

The production Durable Object retains one full canonical object graph only. Public Observer state is a bounded projection, rollback reloads the durable committed generation from SQLite on demand, and health/history/WHY use bounded committed readers. This prevents civilization growth from multiplying isolate memory through full in-memory clones. See [memory-pressure recovery](memory-pressure-recovery.md).

## Workers AI neuron governor

The Worker uses `@cf/zai-org/glm-4.7-flash` unless `BRAIN_MODEL` is overridden. AI produces a
persistent strategy with `max_completion_tokens: 200`; deterministic cognition executes the
concrete actions. There is no fixed calls-per-day admission limit.

Defaults current on 2026-09-21 are:

- 8,000 neurons for normal novelty;
- 9,000 neurons including the high-priority reserve;
- 9,500 neurons including human direction and emergency work;
- 5,500 neurons per million GLM-4.7-Flash input tokens;
- 36,400 neurons per million GLM-4.7-Flash output tokens.

Cloudflare's free allocation is 10,000 neurons per day and resets at 00:00 UTC. CYMONIA keeps the
last 500 unallocated. Before a call, the governor reserves a conservative prompt estimate plus the
full 200-token output cap. It then reconciles the reservation with
`usage.prompt_tokens` and `usage.completion_tokens`. A missing, negative or malformed usage object
charges the full reservation and records an accounting warning; it never produces a zero-cost
call. An unknown model is fail-closed unless explicit rates are supplied.

These optional Worker variables are supported:

| Variable | Purpose | Safety behavior |
| --- | --- | --- |
| `AI_NEURON_SOFT_LIMIT` | Normal-work ceiling | Can lower, but not raise, 8,000 |
| `AI_NEURON_PRIORITY_LIMIT` | High-priority ceiling | Can lower, but not raise, 9,000 |
| `AI_NEURON_HARD_LIMIT` | Human/emergency ceiling | Can lower, but not raise, 9,500 |
| `AI_INPUT_NEURONS_PER_MILLION` | Model input rate | Positive numeric override |
| `AI_OUTPUT_NEURONS_PER_MILLION` | Model output rate | Positive numeric override |

For a custom `BRAIN_MODEL`, set both rate variables. A partial rate override can reuse the other
known rate only when the model already exists in the built-in table.

`GET /api/v2/health` exposes only safe accounting metadata under `ai_budget`: UTC day,
`used_neurons`, `reserved_neurons`, input/output token totals, call count, all three ceilings,
capacity by reserve class, `model_rate_id`, and `last_accounting_warning`. It never returns prompts,
memories, private directions or strategy content.

Cloudflare references for the dated assumptions and cache-compatible prompt layout:

- [Workers AI pricing and neurons](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [GLM-4.7-Flash model](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)
- [Workers AI prompt caching](https://developers.cloudflare.com/workers-ai/features/prompt-caching/)
