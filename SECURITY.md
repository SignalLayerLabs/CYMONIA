# CYMONIA Security Policy

CYMONIA is an open-source artificial-life and multi-agent simulation. It is **not** a wallet, exchange, payment processor, custody system or production financial network. Do not connect it to real funds.

## Security model

- `SovereignWorld` is the single canonical writer.
- Pages Functions authenticate and proxy; they do not own world truth.
- Workers AI proposes bounded cognition; it cannot directly mutate canonical state.
- The browser Observer renders canonical state and sends explicit authenticated intent; it does not advance the world.
- D1 stores identity/session metadata outside the Citizen knowledge model.

## Report these issues privately

Please report vulnerabilities involving:

- unauthorized world advancement or canonical state mutation;
- bypasses of material, biological, epistemic or action invariants;
- forged ledger history, checkpoints, seals or WebSocket state;
- avatar ownership or cross-user intent injection;
- GitHub OAuth, D1 session or cookie bypasses;
- secret exposure or sensitive logging;
- arbitrary code execution, injection or unsafe deserialization;
- GitHub Actions or Cloudflare permissions beyond deployment requirements;
- persistence-budget abuse that can intentionally deny canonical writes.

## Reporting

Use a **private GitHub security advisory** when available.

Include affected commit/URL, minimal reproduction steps, expected vs actual security boundary, impact, and sanitized evidence.

## Out of scope

These are not security vulnerabilities by themselves:

- a Citizen making a bad decision;
- incorrect in-world beliefs that remain within epistemic rules;
- Observer-only labels you disagree with;
- normal permanent Citizen death;
- temporary visual differences that do not alter canonical state.

Security bugs are about crossing trust boundaries, not guaranteeing desirable emergent behavior.
