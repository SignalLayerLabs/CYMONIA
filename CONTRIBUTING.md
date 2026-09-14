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

## Research contributions

Start with `python -m cymonia research --epochs 60 --seeds 11 29 47 --output study.json` and read [the model methods](docs/research.md). Include seeds, horizon, reward, action space, model version and paired results with every experiment. Distinguish a changed assumption from a measured outcome. A learning ablation, more seeds and an explicit interest-rate transmission model are useful starting points.

Research runs stay isolated from `state/`. Do not replace public history with experimental results. Rebuild the published study with `python scripts/build_experiments.py` when changing research code; explain intentional output changes in the PR.

For frontend changes, run `node --test tests/test_ui.mjs` with Node 22+, serve `site/`, and check the city, agent dialog, council, macro replay, laboratory, mobile layout, reduced motion and data-error recovery. The map's geometry is illustrative; transactions, metrics and agent details must come from exported data.

## Economic Contracts (participatory Alpha)

CYMONIA is not a general-purpose bounty board. A proposed task belongs here only if it can answer **how does this measurably improve CYMONIA itself?**

A valid Economic Contract preregisters a metric, baseline, target direction, minimum improvement and CYM reward before work begins. The Alpha PoEC gate then compares the submitted before/after measurement against that frozen baseline. An accepted proof releases already-funded escrow; it does not mint CYM.

Good: reduce failed contract settlements, improve deterministic replay performance, test a monetary mechanism in an isolated experiment, increase market observability, or add a capability needed by the economy.

Not in scope: unrelated client work, generic websites, arbitrary coding bounties, token-price promotion, or work whose only proof is “the PR was large.”

For deployment and local participation setup, see [`docs/deployment-cloudflare.md`](docs/deployment-cloudflare.md).
