# Durable Object memory-pressure recovery

## Production evidence

On 2026-10-01 Cloudflare logs recorded:

`Durable Object's isolate exceeded its memory limit and was reset.`

The same condition appeared in the canonical tick path and while saving heartbeat diagnostics. The world later recovered from its durable snapshot, proving that persistent state was still available, but repeated isolate resets caused long heartbeat stalls and CI failures.

## Root pressure

The runtime previously retained several representations of the same civilization at once:

- the full mutable canonical world;
- a second structured-cloned committed reader;
- a compressed canonical rollback snapshot;
- a compressed public snapshot;
- a materialized public projection during persistence.

As Citizen knowledge, plans, relationships, procedures, objects, and history grow, peak isolate memory therefore grows faster than the canonical world itself.

## Recovery model

Production now follows a single-canonical-memory model:

- `this.world` is the only full canonical object graph;
- rollback reloads the latest committed generation from Durable Object SQLite only when needed;
- no full `committedWorld` clone is retained;
- no full private compressed rollback snapshot is retained in isolate memory;
- health uses scalar committed statistics;
- WHY uses a bounded causal reader;
- history uses the already-created bounded public history;
- `/state` continues to stream a compressed public snapshot.

The public Observer projection is also bounded. Large private knowledge remains canonical and durable, but only a small recent preview is exposed to the Observer. The same rule is applied to lexicon, known-entity, possession, and relationship views.

Canonical knowledge, its personal provenance, the world identity and the durable calendar remain authoritative. Recent private episodic memories use the existing FIFO retention rule with a 512-record window.

## Mature-world recovery

On 2026-10-02 the committed snapshot at world minute 128901 contained 105,436,862 uncompressed bytes. Trimming old memories after loading the complete graph still left too little memory for the next checkpoint. Later, a growing world also reached the invocation CPU limit during perception.

The runtime now applies these bounds while loading and advancing the existing world:

- The decoder trims each Citizen's recent memories before adding that Citizen to the root graph. The next checkpoint phase persists a pending trim even if no further world time advances.
- Identical sensory evidence is represented by one deeply immutable object. Every Citizen keeps separate knowledge entries, confidence, source event IDs and access checks. Sharing storage grants no new knowledge. New `learn()` evidence uses the same pool.
- The evidence pool's lookup keys are bounded to 4 Mi code units and 16,384 entries. Eviction removes only an index entry; evidence still referenced by a Citizen remains intact.
- Known-entity membership uses an index over the canonical append-only array. New IDs are indexed once, while snapshot replacements and truncation rebuild the index.
- Spatial memory retains the same 64 highest timestamps and stable tie order. Cached minima discard dense, equal-time overflow without repeatedly scanning or allocating rejected observations.
- Compressed checkpoint chunks are staged individually into the inactive slot. A small final transaction publishes the manifest, clock guard, seal and row budget together. An interrupted stage cannot publish a partial world.

Regression coverage checks personal knowledge isolation, immutable sharing, bounded pool retention, entity-index updates, spatial tie ordering and interruption during snapshot staging. Recovery must also be verified against production alarms and consecutive durable clock advances; HTTP health alone does not prove that the simulation is running.

At world minute 133578 a later production invocation exhausted the default 30-second CPU limit (32,500 ms recorded), causing resets and queued-request overload despite successful snapshot hydration. The snapshot was then 137,341,255 uncompressed bytes with 257,653 personal knowledge entries. Cloudflare rejected custom CPU limits on the Free plan with error 100328.

The alarm handler now completes at most four simulation boundaries per invocation, retaining the remaining lag. Checkpoint compression runs in a separate invocation without another simulation step. Each alarm flushes its successor before risky work: 2.5 seconds for pending time, a checkpoint or unsaved minutes, and 15 seconds when fully committed and caught up. Keeping uncommitted work warm prevents the ten-second hibernation window from discarding every pulse before the 60-minute checkpoint. Healthy pulses leave that successor unchanged, bounding alarm writes to 34,560 per day. Healthy status writes are throttled to the normal heartbeat interval, with immediate writes for commits and error changes. Failures keep the fallback and durable committed readers. Recovery and memory trims request a forced checkpoint; its pending flags clear after a successful save or a rollback to the previous committed world. Partial pulses retain their original catch-up target so reflection cannot drift or starve while draining a backlog. Outage rebasing, memory bounds, row budgets and atomic durable commits remain in effect. No paid-plan CPU setting is required.

Regression coverage checks partial lag accounting, deterministic segmented simulation, separate checkpoint invocations, failed-save retention and prompt alarm continuation. Production proof must include successful ticks and checkpoints after a fresh wake.

## Observer calendar

Durable checkpoints are separated by at least 60 world minutes to respect the write budget. Showing only the latest checkpoint minute left the visible clock frozen between saves, followed by an abrupt jump.

The Observer now plays the last 120 confirmed world minutes at one world minute per real second. Two checkpoint intervals absorb alarm execution and delivery jitter, so a healthy world does not pause at the nominal 60-minute save boundary. This small display delay makes minutes visible between polls without extrapolating beyond durable state. Repeated snapshots do not restart playback, new checkpoints extend its upper bound, and a disconnected client stops at the last confirmed minute. Genesis replay remains frozen. The canonical world clock, motion model and persistence schedule are unchanged.
