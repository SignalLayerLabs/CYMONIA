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
