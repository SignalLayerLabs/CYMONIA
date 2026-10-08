# Memory Path V2

The current private knowledge format is [Packed canonical knowledge checkpoints](packed-knowledge-checkpoints.md). The sections below record the earlier memory-path fixes.

## Production reason

Cloudflare production evidence showed repeated Durable Object isolate resets while
the canonical world was checkpointing. The first memory-pressure hotfix removed
the second full committed world graph, but the critical persistence path still
materialized a complete compressed checkpoint string, split that string into
rows, built the public Observer projection, compressed that projection, and
retained causal readers in the same persistence activation.

Memory Path V2 separates those responsibilities.

## Canonical checkpoint

The private canonical checkpoint is compressed into bounded base64 parts while
the gzip stream is consumed. The persistence path no longer creates a whole
compressed `ArrayBuffer` and then another complete base64 checkpoint string
before splitting it.

The inactive SQLite slot is still written completely before the manifest is
switched. The clock guard, slotted recovery, SHA-256 seal, write budget and
rollback rules remain authoritative.

## Public projection

Canonical SQLite commit happens before the Observer projection is refreshed.
Private checkpoint buffers live in a separate method and are out of scope before
public projection begins.

A failure while creating the public snapshot is diagnostic only after the
canonical transaction has succeeded. It cannot roll the world back.

On Durable Object wake, `/health` does not construct the public world. `/state`
builds the projection lazily only from the currently committed in-memory state.
If an older committed public snapshot is still available, it remains a safe
fallback while a newer projection is unavailable.

## Bounded diagnostics

The canonical ledger remains governed by its existing retention policy.
The separate in-memory causal reader is strictly bounded to a small recent
window of ledger entries, receipts, objects and procedures. Canonical objects,
procedures and Citizen knowledge are not deleted or truncated by this change.

## Non-goals

This patch does not reset world state, alter the world clock, remove Citizen
knowledge, change emergence rules, or change Durable Object identity.

## Bounded canonical records

The codec now streams nested Citizen fields as well as root arrays. Knowledge,
memories and provenance are never serialized as one Citizen-sized JSON string.
Small records are coalesced into at most 64 KiB text batches before UTF-8 encoding.

Cold wake and rollback parse the decompressed root arrays one entity at a time.
They no longer allocate the entire private world JSON string before hydrating
the canonical graph. Existing gzip/base64 SQLite slots, field ordering and
SHA-256 seals retain their original format.

Small evidence objects use native JSON serialization within the record-size
budget; large private arrays continue to stream. Encoded SQLite parts use
1.5 MiB per row to keep the current civilization's checkpoints within the daily
write budget. Each part remains below SQLite's 2 MB per-value/row limit.

Simulation indexes active knowledge outside canonical state and computes
perception positions once per segment. Fifteen-second alarms split ordinary
world-time progression into CPU-bounded segments; the checkpoint remains due
every 60 world minutes. Scheduled alarms drain ordinary lag in chunks of at
most 30 world minutes; only a true outage beyond 360 world minutes rebases
the clock. This avoids both unbounded CPU work and discarding pending time.

On the first tick after a legacy oversized snapshot wakes, each Citizen keeps
the newest 512 private memories and the compacted world is checkpointed
immediately. Future memories follow the same bound. Long-term causal evidence
remains in the ledger and provenance records while the private working set
stays below the Durable Object memory ceiling.

An alarm whose scheduled time and last successful tick are both more than five
minutes old is rearmed for immediate delivery. A durable two-minute cooldown
prevents repeated health polling from postponing that delivery; recently due
alarms remain under Cloudflare's normal retry handling.
