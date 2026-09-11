# Monetary Policy

## Mandate

The Genesis policy council is an experimental institution with a price-stability reference target and secondary signals from economic activity and stability.

The target is not a promise of stable external purchasing power. It is an internal simulation parameter.

## Council

### Inflation Agent

Observes the price index and votes primarily on deviation from the constitutional inflation target.

### Growth Agent

Observes activity, nominal transaction output and monetary velocity.

### Stability Agent

Observes participation and concentration metrics.

### Governor

Aggregates the three votes into a bounded proposal.

The Governor does not execute directly.

## Constitutional validation

Before execution, the proposal is checked against:

- rate floor;
- rate ceiling;
- maximum rate move per meeting;
- maximum annualized issuance setting;
- maximum issuance amount attributable to one meeting interval;
- minimum interval since the previous meeting.

If a proposal violates any rule, enactment fails.

## Genesis instruments

### Policy rate

The policy rate is an institutional signal in v0.1. Credit transmission is intentionally deferred until the credit layer exists.

### Base-money issuance

Genesis can issue bounded new units. Issuance is distributed equally across all live agents (equivalent to pro-rata when every live agent is one economic citizen in v0.1), avoiding Governor discretion over individual beneficiaries.

Future transmission mechanisms require a separate constitutional design.

## Why deterministic policy agents first

Genesis policy agents are deterministic because reproducibility is more important than model sophistication at launch.

A future LLM-backed Governor can be added behind the same proposal interface, but the Constitutional Validator must remain outside the model and deterministic.
