## Problem

What limitation or failure does this PR address?

## Change

What changed, and in which layer?

## Authority boundary

- [ ] Canonical mutation still flows only through the Sovereign World runtime.
- [ ] Observer-only logic does not write back into world state.
- [ ] AI output remains a proposal subject to deterministic validation.
- [ ] Human-linked identity does not import Earth knowledge into Citizens.

## Evidence

```text
node --test tests/test_sovereign_*.mjs
bash CHECK.sh . --skip-browser
```

For Observer changes:

```text
bash CHECK.sh .
```

## Operational impact

Describe any effect on Durable Object writes, alarms, SQLite, Workers AI, D1, Cloudflare bindings, WebSockets or deployment order.

## Screenshots / traces

For visual changes, include before/after evidence. For canonical changes, include invariant output or causal evidence.
