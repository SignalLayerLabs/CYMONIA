# Constitutional Forks

The canonical Genesis network is identified by:

```text
SHA256(constitution/genesis.json)
```

The expected value is stored in `constitution/GENESIS_SHA256`.

## Rule

A change to `constitution/genesis.json` does not silently amend Genesis.

It creates a different constitutional network identity.

This is deliberate. Monetary participants should be able to know exactly which foundational rule set generated a state history.

## Fork process

A research fork should:

1. copy the canonical repository at a known commit;
2. change the Constitution;
3. generate a new Constitution hash;
4. rename the network identity;
5. initialize a new state lineage or explicitly record a fork point;
6. never present the fork as the unchanged canonical Genesis network.

## Upgradeable machinery

Non-constitutional implementation machinery may be improved without changing the monetary Constitution, provided the change preserves the defined rules and deterministic state semantics.

This implements the principle:

> **Immutable principles. Upgradeable machinery.**
