# Architecture

## Design goals

CYMONIA Genesis is designed around five properties:

1. **Reproducibility** — identical state and seed produce identical next state.
2. **Auditability** — transactions and policy decisions are inspectable.
3. **Constitutional supremacy** — policy agents cannot bypass deterministic bounds.
4. **Zero-cost operability** — standard-library Python + GitHub Actions + Pages.
5. **Future separability** — the simulation, monetary law, UI and future settlement layer remain distinct.

## State transition

Each epoch executes:

```text
verify Constitution identity
        ↓
load prior state
        ↓
generate agent offers/demand
        ↓
clear service markets
        ↓
settle trades
        ↓
compute macro metrics
        ↓
policy meeting due?
   ↙ no       yes ↘
 persist      policy council
                 ↓
             Governor proposal
                 ↓
        Constitutional Validator
            ↙ reject  valid ↘
                      enact
                        ↓
                recompute metrics
                        ↓
           hash + persist new state
```

## Trust boundaries

### Policy agents

Policy agents are allowed to propose. They are not trusted to authorize their own actions.

### Constitutional Validator

The validator is deterministic code. It checks rate bounds, rate-change bounds, issuance bounds and meeting cadence before policy execution.

### Ledger

Each transaction hash commits to the previous transaction hash and transaction payload. Any mutation to an earlier record invalidates the chain from that point.

### GitHub

GitHub is the hosting/automation layer in Genesis, not a cryptographic consensus network. Repository administrators can technically rewrite Git history. CYMONIA therefore does not claim that GitHub itself provides blockchain-grade immutability.

Genesis constitutional identity instead relies on a pinned SHA-256 identifier and reproducible public history. A future external-value system would require a stronger settlement/consensus architecture.

## Modules

- `constitution.py` — Genesis identity and constitutional policy constraints.
- `models.py` — economic data structures.
- `genesis.py` — deterministic initial population.
- `market.py` — intent generation and service-market settlement.
- `ledger.py` — append-only hash chain.
- `metrics.py` — macro measurement.
- `policy.py` — policy council, Governor and enactment.
- `simulation.py` — epoch state machine.
- `storage.py` — atomic state persistence.
- `cli.py` — operator interface.

## Future external settlement

No blockchain assumptions are embedded into the simulation core. A future settlement adapter should consume explicit monetary events and stable transaction identifiers rather than rewriting Genesis semantics.
