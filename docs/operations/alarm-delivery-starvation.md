# Alarm delivery starvation

## Production evidence

Run 167 deployed the memory-pressure hotfix successfully and the Worker became healthy at world minute 128591. The production verification then polled `/health` every two seconds for several minutes. During that period the canonical minute did not move, `tick_stalled` became true, and the scheduled alarm timestamp was repeatedly moved forward by fetch-side stale-alarm recovery.

The failure was therefore not a unit-test or deployment failure. The production verifier itself was applying sustained fetch pressure while `ensureAlarm()` was allowed to rewrite an already-existing overdue alarm.

## Contract

HTTP reads may repair a *missing* alarm only.

If Durable Object storage already reports an alarm timestamp, including an overdue timestamp, fetch handlers preserve it exactly and let Cloudflare deliver it. Reads never replace an existing alarm with `now + 1000`.

Production CI also gives the alarm scheduler quiet windows. It samples health, waits at least one full alarm interval plus scheduling jitter, and samples again. It no longer polls the same Durable Object every two seconds while simultaneously testing whether alarms can run.

This does not alter canonical world state, persistence slots, world identity, calendar, Citizen knowledge, or rollback data.
