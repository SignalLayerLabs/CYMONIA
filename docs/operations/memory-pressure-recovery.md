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

## Private knowledge paging

The October 5 diagnostics at committed minute 140546 recorded another memory-limit reset with 365,298 knowledge entries and 53,572 recent memories. The automatic scheduler was already running at 1 ms CPU per invocation, so incoming requests alone did not resolve this memory pressure.

Private knowledge uses immutable compressed RAM pages, compact logical indexes,
a decoded LRU bounded to eight pages and 512 Ki code units, and a dirty overlay
flushed at 512 Ki code units. Compressed backing owns its buffers and is capped
at 32 MiB including obsolete pages. The cap is a capacity boundary: it fails
explicitly without trimming knowledge or replacing the canonical world.

The previous SQLite scratch adapter amplified reads when pages were fragmented,
and cold recovery repeatedly deleted and rebuilt those pages. Production reached
the account read quota and then the internal emergency write budget during wake.
The RAM adapter performs **zero scratch SQL reads or writes**, including cold
recovery. Old scratch rows are left inert; cleanup must never gate loading.

The complete guarded gzip remains authoritative. It includes all ordinary
knowledge arrays and every provenance source, with unchanged world identity,
clock guard, slot publication and seal semantics. Recovery reconstructs the RAM
pages one Citizen at a time. Corrupt pages fail the mutation and reload this
checkpoint. Records over the existing 1.5 MB transient limit fail explicitly.

Entity counts and concept access use compact indexes without decompression.
Checkpoint serialization groups bounded logical windows by page, then emits
records in original order. Each window retains at most 2,048 record strings and
1 Mi code units (one oversized record can exceed the text target), limiting
fragmentation costs without retaining the entire decoded private graph.

October 7 production logs showed checkpoint encoding exceeding the 30-second
CPU window with 672,634 knowledge records. Checkpoints now emit detached JSON
spans from immutable pages directly, avoiding evidence hydration and object
reserialization. Per-page UTF-16 offsets carry an integrity checksum; exact
concept and active-state metadata validate each emitted record. The raw text
cache shares the decoded cache's eight-page/512 Ki code-unit bounds, and the
two cache forms are cleared when switching between runtime reads and encoding.
Small native JSON shortcuts also reject nested private archive adapters.

A 675,000-record Node comparison reduced checkpoint wall time from 8.26 to
3.85 seconds. Local workerd encoded a 30.4 MB compressed archive with fragmented
updates in 3.87 seconds and committed it successfully. These fixtures establish
local behavior; production CPU and unattended durable progression still require
verification after deployment.

The subsequent production trace exposed cumulative CPU coupling: a cold alarm
spent 24.9–29.6 seconds recovering the archive, then its successor exceeded the
CPU limit while attempting a checkpoint. Cold alarms now retain their warm
successor but wait for a subsequent internal heartbeat to echo a per-recovery
challenge before running another phase. The challenge is returned only after
decode, so a queued wake request cannot release the gate. Rollback rotates it;
late responses cannot replace a newer scheduler slot's challenge.
The existing autonomous cron supplies these requests even with no Observers.
Cold recovery also archives knowledge before attaching the evidence pool, so
historical sources are interned and frozen on access rather than all at wake.
Recent memory sources remain eagerly frozen. Recovery uses this order for
slotted checkpoints, legacy snapshots and rollback. The 675k fixture recovered
in 5.43 seconds under Node and 6.96 seconds in fresh workerd, with its knowledge
counts and checked records preserved.

The next production trace still hit the CPU limit before decode completed.
Full recovery was inside `blockConcurrencyWhile`, which blocks all incoming
events and has its own 30-second deadline. Only synchronous schema setup now
uses that gate. A shared readiness promise protects every canonical HTTP reader
and alarm; the internal scheduler can return bounded `initializing` status
while recovery continues. This response exposes no canonical minute or renewal
challenge. Genuine scheduler arrivals can therefore renew CPU during recovery,
and the post-decode challenge still separates it from the next simulation phase.
Recovery errors abort the instance without creating a replacement world.

Page reclamation now tracks reference counts reaching zero, rather than scanning
the full page map on every new page (the previous startup path was quadratic).
Local workerd recovered 675,000 records after a deliberately delayed 40.63-second
wake, with internal heartbeat responses available during recovery and canonical
readers waiting for completion. See Cloudflare's
[input-gate and timeout contract](https://developers.cloudflare.com/durable-objects/api/state/).

Production then recorded storage-operation timeouts despite limited native CPU,
and application elapsed time remained zero across long decode work. Resolved
stream promises can continuously queue microtasks even outside the input gate.
Recovery now flushes storage and yields a timer after each decoded Citizen;
checkpoint encoding does the same after each 4 MiB batch of serialized input and
at completion. Input batching also yields for highly compressible data and avoids a timer for
every tiny native gzip emission.
Writers remain serialized, and the manifest/clock guard still publish only after
all inactive-slot parts complete. Progress-hook failures retain the previous
canonical generation. A real local workerd recovery of 675,000 records completed
in 5.82 seconds while an incoming heartbeat returned initializing status in
53 ms. The same 675k fixture encoded its fragmented checkpoint in 4.14 seconds,
with a concurrent heartbeat completing in 1.92 seconds before encoding finished.
Knowledge counts and the checked first/last evidence remained intact. These
local measurements do not replace unattended production validation.

Production subsequently passed the unattended gate (124 saved minutes, 36 moved
Citizens, 89 changed actions and 100 changed bodies), but short physics pulses
could still force a full checkpoint whenever an AI strategy changed. AI now runs
once inside the planned checkpoint phase, immediately before its serialized save;
forced recovery/trim checkpoints skip it. Physics pulses keep advancing locally
while the cognition queue retains its ordering and admission/accounting rules.
The save interval uses the last verified snapshot part count and its measured
worst-case row cost, targeting 38,000 normal canonical rows per real UTC day
without raising the persisted 40,000/60,000 admission caps. The current 25-part
world therefore uses an 80-minute interval (35 rows × 1,080 saves = 37,800).
Forced saves, retries and other account workloads still consume their allowances.
CI read deadlines are bounded at 60 seconds to cover the observed 26–51-second
cold loads; advancement, physical-state, identity and quiet-window assertions remain.

The synchronous codec is the MIT-licensed fflate 0.8.2 subset documented in
`worker/src/vendor/fflate.NOTICE.md`. `/health.knowledge_archive` reports compressed
bytes, cache sizes, page decompressions and the adapter's zero scratch SQL cost.
These counters exclude canonical SQL, alarms and other account workloads.

Previously consumed quota remains consumed. This migration does not reset the
persisted daily write counter, bypass its limits or upgrade the Cloudflare plan.
If the existing counter exceeds the normal allowance, canonical writes remain
in backoff until the next UTC day. A Free account also resumes blocked platform
operations only after its daily quota resets. The confirmed quota-cost fix and
production restart status must be reported separately.

## Seal history read budget

A covering index serves `MAX(world_minute)` without scanning all seal rows.
A trigger-maintained inventory supplies the exact retained row count, including
sequence gaps, so checkpoint pruning never counts the whole history. Workerd measurements reserve four writes per insertion (table, index,
inventory trigger, AUTOINCREMENT sequence) and two per deletion (table and
inventory trigger). A 100-row index backfill writes 101 rows; creating the
inventory table writes two rows, and each trigger writes one catalog row.
The index backfill and inventory initialization are reserved and charged before
staging. If the old daily budget is exhausted, read recovery remains available
and migration retries on a later checkpoint after the UTC reset. The health
field `seal_read_index_ready` distinguishes this remaining migration condition.
