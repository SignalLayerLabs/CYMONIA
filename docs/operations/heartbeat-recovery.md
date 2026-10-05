## Production heartbeat recovery

A production failure on 2026-09-30 exposed a feedback loop in the deploy verification path.

`GET /health` calls `ensureAlarm()`. The previous implementation replaced an alarm once it had been overdue for more than two alarm intervals by scheduling it one full interval into the future. Production verification polls `/health`, so a delayed alarm could repeatedly be moved away from the present by the observer that was trying to verify it.

The recovery rule is now:

- missing alarm -> arm the normal next heartbeat;
- recently due alarm -> preserve it and allow Cloudflare to deliver it;
- abnormally stale alarm -> arm a near-immediate recovery alarm, not a full interval later;
- once that near-immediate alarm is armed, repeated health polling preserves it.

`GET /health` also exposes derived diagnostics for alarm overdue time, tick staleness and whether canonical time is currently stalled behind real time. These fields are observational and do not advance the world.

The Durable Object snapshot is never reset as part of heartbeat recovery.

## Autonomous CPU-window renewal

On 2026-10-05 a mature world repeatedly woke at minute 140538 and lost its uncommitted simulation phase. Runtime observations recorded 13–22 seconds of CPU for cold wake plus a bounded simulation pulse. Small alarm handlers alone do not establish new independent CPU budgets: Cloudflare documents that incoming HTTP/WebSocket requests reset the available CPU window. Observer requests had unintentionally supplied this renewal, so a short deployment check could pass while unattended operation later stalled.

The Worker now has a minute Cron Trigger. Each invocation sends three independent requests to the same existing `canonical-v2` Durable Object, at zero, twenty and forty seconds. These requests renew the CPU window and repair a missing/stale alarm through the existing read path. Only alarms mutate simulation time and actions; the scheduler does not advance dates, drop history, alter AI admission, or replace the world. A fresh stub and a bounded request deadline isolate failures, and a slow request cannot block later slots. All three failures mark the Cron invocation failed.

The binding-only `/world/runtime-heartbeat` route records the last scheduler arrival in memory without an extra durable write. The public Worker rejects its corresponding route; health exposes the arrival timestamp for verification. A reset clears this observation until another real scheduled request arrives. Three renewals per minute add 4,320 Durable Object requests per day. Existing alarm, persistence and neuron budgets remain enforced.

`scripts/verify_autonomous_world.mjs` waits for a real scheduler arrival and a healthy lag, allowing Cloudflare's documented fifteen-minute cron propagation window. It then reads baseline health/state, makes no Observer requests for three minutes, and checks durable clock progress, scheduler freshness, bounded lag and actual citizen state changes. CI runs this after deployment. For a longer production check, use `node scripts/verify_autonomous_world.mjs --quiet-ms 600000` with Observer tabs closed.

References: [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/) and [Cron Trigger propagation](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
