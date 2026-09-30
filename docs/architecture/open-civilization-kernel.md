# Open Civilization Kernel foundations

This sprint adds a complete physical-operation → evidence → personal procedure → repetition/teaching → Observer vertical slice. It does not script civilization or introduce technology names, currency, governments, professions or institutions.

## Canonical data language

`world/physical-operations.js` interprets 18 declarative primitives: apply_force, impact, separate, join, support, contain, move, rotate, compress, abrade, pierce, transfer_heat, cool, ignite, extinguish, transfer_matter, shape and mix. A sequence contains 1–12 operations and binds 1–8 distinct physical object IDs. Slots can target matter, a source and a tool. Only bounded numeric values, seven geometric forms and local positions are accepted; executable fields and unknown primitives are rejected.

All steps stage copies before committing. Material resistance, live actor capability, tool properties, work/caloric limits, holder/proximity, temperature, environment, attachment dependencies and mass closure are checked. Failure changes no matter, ledger or physical work reserve. Outputs retain input IDs, action/procedure IDs and physical execution event IDs. In-place changes link the preceding physical event. Transport charges actual staged displacement, including bound contents; detached matter returns to personal possessions.

Thermal transfer is finite-source and mass-weighted. Cooling accounts for ambient exchange. Ignition converts declared work into temperature and requires combustible matter and sufficiently dry conditions. These are simplified local models: persistent combustion, fire spread, fluid dynamics, arbitrary geometry and chemical reactions remain future work. Mechanical work has a recorded receipt and physiological cost; this is not a complete thermodynamic simulation.

`world/physical-actions.js` lets EXPERIMENT and existing CUT/DIG/HEAT/COOL/MIX/ASSEMBLE carry a physical payload through ordinary action validation and completion. Legacy payloads keep existing behavior; this does not rewrite every legacy action into primitives. Operations commit at action completion; the public current step represents the Citizen's planned motion, not a claim that intermediate material changes have already happened.

## Knowledge in personal minds

`world/procedures.js` stores bounded historical procedure records and individual `procedureKnowledge`. A registry record alone grants no Citizen execution access. Real receipts, nearby recorded witnesses and nearby teaching from a living holder are required. Citizens can remember, repeat, propose variants, transmit imperfect copies, record failures, decay confidence and lose execution knowledge on death. Final-holder loss emits a causal event. Personal proposals select locally held matching materials; sparse physical hypotheses also arise through existing local cognition without an AI request. Self-programming EXPERIMENT steps can bind this same declarative language.

Bounds: 256 procedure records; 24 entries per personal mind; six provenance edges, eight recent outcomes and eight recent learners per procedure; 128 retained physical receipts; 12 recorded witnesses per execution. New physical outputs stop at 8,192 existing objects instead of deleting historical objects. Slow procedure memory decay integrates coarse daily intervals analytically. At a full registry, living-held procedures are protected; registration can defer while a successful physical action remains successful.

## Provenance and Observer

WHY resolves action, object, receipt and procedure IDs to canonical events. Public history and recent event surfaces contain compact receipt summaries instead of repeated operation sequences. The authoritative ledger and retained receipts preserve detailed evidence. Compaction limits reconstruction of very old causal chains; this is not yet a permanent universal provenance database or a full descendant query API.

The Citizen inspector shows physical primitive/target, procedure, personal procedure count/confidence/outcomes and evidence links. This adds inspection detail without changing the world hierarchy or granting knowledge to Citizens.

## Graphics 2.0

`site/action-animations.js` explicitly covers every current action and every physical primitive, with a safe unknown-primitive fallback. A test fails when a canonical action lacks a mapping. Four bundled identity atlases contain 39 states × four actual articulated frames, generated deterministically from existing project art by `scripts/build_citizen_animations.py` (requires Pillow only when rebuilding assets). Canvas and Pixi use the same frame/timing/context registry; glyph broadcasting is removed. Target facing, held matter/tool context and heat effects derive from canonical state. Heat actions on cold objects do not invent fire.

Ground objects and debris are visible; condition changes invalidate static scenery caches. Pixi fracture sprites reuse a pool capped at 256. Atlas textures remain reusable. Existing terrain, water, trails, lighting, seasons and construction rendering are preserved; this sprint does not comprehensively redraw the entire environment. Articulated cutouts are coherent replaceable assets, not hand-painted animation for every contextual action. Pixi 8.19.0 and Matter 0.20.0 plus MIT licenses are bundled under `site/vendor/`; the Observer requires no runtime CDN scripts.

## Persistence and operations

No Durable Object schema, alarm scheduling, checkpoint cadence, clock, identity, Genesis state or historical buildings are reset. New fields initialize lazily and tolerate old snapshots. Actual production SQLite storage, compressed checkpoint encoding and DO recreation are tested with physical outputs and personal procedures. The published Genesis replay changes only its optional public fields, preserving the seeded canonical Genesis.

The branch is based on main commit `a32b8eb4de20d5ce2f79649252a74f55ddcf6637`, which includes the health-polling alarm-starvation hotfix. Existing alarm recovery, mass, calendar and persistence budget tests remain gates. No Cloudflare resources or production deployments are changed by this sprint.

## Local measurements and limits

Three seeded runs, 100 Citizens and 60 world minutes: median advance time 696.08 ms on baseline and 686.22 ms on this branch. Median public serialization 2.51 → 2.77 ms; public JSON 632,455 → 645,573 bytes. Canonical snapshot/gzip remained 3,541,672 / 293,191 bytes for this scene, which did not yet execute physical experiments. These are local Node wall times, not evidence that a Cloudflare tick fits a particular CPU plan.

The browser fixture with 110 Citizens averaged 1.72 ms Canvas and 1.17 ms WebGL across 30 render submissions on the local Mac IAB. It excludes compositor/vsync time. Four animated PNGs add 3,503,376 bytes; pinned vendor scripts add approximately 861 KiB. Texture memory and mobile initial load still need production-device measurement. Existing Citizen perception/terrain loops and retained plans remain the dominant inherited scaling risk; this sprint adds bounded work and does not eliminate those costs.

## Verification

Run `node --test tests/test_sovereign_*.mjs` and `bash CHECK.sh . --skip-browser`. Full `bash CHECK.sh .` also runs replay, sovereign, state-sprite and Graphics 2.0 browser smoke. CI installs Playwright Chromium. Browser tests exercise Canvas and actual WebGL, all action/primitive families, frame advancement, alpha hit masks, canonical immutability and cold-heat truth. The native Mac sandbox may deny direct Playwright Chromium launch; equivalent smoke can run through the in-app browser, while Linux CI remains the exact-script gate.

Language/dialects, economic or institutional primitives, uncertain belief expansion, durable genealogy, natural-entity ecology and a new general multiscale scheduler were not expanded in this vertical slice. Existing systems remain authoritative. Parent/caregiver public fields tolerate absence; no family knowledge or cultural inheritance is invented.
