# Security Policy

## Genesis security boundary

CYMONIA Genesis is a research simulator. It is **not** a custody system, wallet, payment processor, exchange, smart contract or production financial network.

Do not connect this reference implementation directly to real funds.

## What is security-sensitive

Please report issues involving:

- Constitution identity bypass;
- monetary issuance outside constitutional bounds;
- ledger tampering that passes verification;
- negative balances or supply-accounting violations;
- nondeterministic state transitions from identical inputs;
- GitHub Actions permissions that exceed what is required;
- arbitrary code execution through economic state data;
- dashboard injection from generated data.

## Reporting

For the initial public release, open a GitHub security advisory if the repository supports private vulnerability reporting. If private reporting is not enabled, open an issue containing only enough information to establish that a security problem exists, without publishing an exploit against any future production deployment.

## Future external-value boundary

A move from experimental Genesis units to any externally transferable or tradeable representation requires a separate threat model, independent audit, key-management design, consensus/settlement analysis and legal/regulatory review. Passing the Genesis test suite is not evidence that such a system is safe for real funds.
