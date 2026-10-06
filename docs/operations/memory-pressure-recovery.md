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
