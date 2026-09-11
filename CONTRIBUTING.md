# Contributing to CYMONIA

CYMONIA welcomes contributions that make the experimental economy more reproducible, inspectable, secure or economically meaningful.

## Before opening a PR

1. Read `README.md` and `docs/architecture.md`.
2. Run the full test suite:
   ```bash
   python -m unittest discover -s tests -v
   ```
3. Run a fresh 100-epoch smoke economy:
   ```bash
   rm -rf /tmp/cymonia-smoke
   python -m cymonia init --root /tmp/cymonia-smoke
   python -m cymonia run --root /tmp/cymonia-smoke --epochs 100
   python -m cymonia verify --root /tmp/cymonia-smoke
   ```
4. Keep runtime dependencies at zero unless a proposal demonstrates why the dependency is necessary.

## Contribution areas

Good contribution targets include:

- agent behavior and market microstructure;
- macroeconomic metrics;
- monetary-policy experiments;
- ledger/state integrity;
- property and invariant tests;
- dashboard accessibility and performance;
- comparative experiments;
- documentation.

## Constitutional changes

Do **not** edit `constitution/genesis.json` as part of a normal feature PR.

The SHA-256 of that file defines the canonical Genesis network identity. A rule change produces a different constitutional network. If you want to test a different monetary Constitution, propose a named fork under a separate network identity.

See `docs/constitutional-forks.md`.

## Pull-request expectations

A PR should state:

- the problem;
- the economic or technical assumption being changed;
- expected effect;
- tests added;
- reproducibility impact;
- whether state-file formats change.

Behavior changes require tests. Prefer deterministic tests over mocks.

## Financial claims

Do not describe Genesis units as an investment, promise appreciation, or imply guaranteed future convertibility. CYMONIA Genesis is an experimental accounting economy.
