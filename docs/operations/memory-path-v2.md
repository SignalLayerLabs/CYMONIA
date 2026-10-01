# Memory Path V2

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
