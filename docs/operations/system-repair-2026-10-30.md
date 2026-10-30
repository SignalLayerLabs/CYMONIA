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

## Follow-up: restore affected GitHub-linked inhabitants

The operator subsequently authorized recovery of the GitHub-linked inhabitants
who died before the survival fix took effect. The initial production snapshot
contained eleven such deceased avatars and one living GitHub-linked citizen.

`HUMAN_SYSTEM_REPAIR_ID=2026-10-30-github-survival-recovery` enables a separate,
one-time incident operation, restricted to the same production world. Only
`HUMAN_LINKED` citizens with a recorded death at or before minute 1,942,898 are
eligible. Later deaths and living avatars are untouched.

This explicitly authorized exception restores each existing citizen ID and
external identity link instead of creating duplicate accounts or avatars. It
preserves names, knowledge, relationships and existing identity/session mappings.
It resets biological needs/health, cancels stale active plans/actions and queues
normal local cognition. Previous death times remain in the incident audit record
and canonical per-citizen recovery provenance; old corpse matter remains in the
world. Restored body mass is debited from natural biomass, preserving mass closure.

A separate durable marker prevents the follow-up from repeating after restarts,
ledger compaction or a later natural death. The same checkpoint publishes the
restored bodies, material debit and incident marker. Society History explains in
Italian that the GitHub-linked inhabitants were restored because of a system bug.
The public notice contains citizen IDs and death times, never external GitHub IDs,
session data or private intent content.

Coverage: `tests/test_sovereign_human_system_repair.mjs` verifies identity reuse,
canonical direction submission after recovery, conservation, audit history,
post-fix exclusion, fail-before-mutation on insufficient biomass, and real SQLite
cold-wake recovery with a subsequent death remaining permanent.

## Runtime memory correction during mass recovery

The post-deployment autonomous-progress check failed after the population returned.
A mature-world replay produced approximately 96,000 discovery events within 71
world minutes. The runtime previously compacted the hot ledger only during saves;
meanwhile archive growth increased the adaptive checkpoint interval. Uncommitted
ledger objects could therefore accumulate alongside the existing large archive.

The runtime now applies its existing 4,096-event hot-history window after every
complete simulation boundary, before yielding to the next pulse. Absolute sequence
numbers, ledger hash head and chain anchor are preserved; learned evidence is not
discarded. This uses the same retention policy as canonical snapshot persistence.
It does not alter offline kernel advancement or the authoritative world clock.

`tests/test_sovereign_hot_ledger_memory.mjs` reproduces a dense discovery burst
(11,702 events in the first unbounded boundary), checks the bound before each yield
across multiple boundaries, and verifies chain continuity after real SQLite
publication/reload and a subsequent event append. The memory defect is reproduced;
its impact on production progress still requires the deployment smoke check.
