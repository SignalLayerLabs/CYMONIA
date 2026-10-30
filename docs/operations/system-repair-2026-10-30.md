# Survival deterioration incident — 2026-10-30

Production inspection at world minute 1,941,000 found all 100 Genesis citizens
and eleven human-linked citizens dead, with one human-linked survivor. Food
(approximately 12,367 kg) and water (7,726,521 kg) remained available. The evidence
does not support a global resource shortage as the sole cause.

Three deterministic defects are corrected:

- Biological health could only fall; ordinary exposure and temporary deprivation
  accumulated permanently, even after needs were satisfied. Healthy, rested,
  nourished and hydrated citizens now recover 7.2 health per world day, capped at
  100. Active exposure damage, disease, injuries and old-age decline block recovery.
- Survival selected the nearest known resource even when exhausted. It now requires
  enough quantity for the actual drink/meal, allowing another known source.
- Critical dehydration/starvation now precedes the adult sleep reflex.

The operator explicitly authorized an exceptional reinsertion of 100 inhabitants.
`SYSTEM_REPAIR_ID=2026-10-30-survival-deterioration` enables this incident only for
`sovereign-20260915` at or after minute 1,941,000. It inserts 100 new adult identities
with empty learned knowledge, debits their body mass from natural biomass, preserves
all prior citizens/deaths, and leaves the world clock, structures and history intact.
The existing survivor remains alive. This is not an automatic population floor.

The canonical event `SYSTEM_POPULATION_REPAIR` and durable `systemRepairs` marker
are committed with the inserted population. The marker prevents repeats after
restart or ledger compaction. Society History retains this Italian notice even
after the original hot-ledger event ages out:

> 100 abitanti reinseriti a causa di un bug di sistema: corretto il deterioramento
> irreversibile della salute e la gestione delle risorse esaurite.

The runtime applies the authorized incident on cold initialization, before normal
advancement, and requests a sealed checkpoint. Deployment uses the existing CI
Worker → Pages ordering. Future unrelated worlds and fresh Genesis replays are
ineligible. Disabling the variable after a successful durable checkpoint is safe;
the stored marker remains the permanent audit record.

Regression coverage: `tests/test_sovereign_system_repair.mjs`, including needs,
resource selection, conservation of mass, death preservation, ledger integrity,
history after compaction, and real SQLite cold-wake publication/idempotence.
