# CYMONIA Self-Evolving World Design

Date: 2026-09-16
Status: Approved architecture
Target: CYMONIA Sovereign World v2

> Nothing in CYMONIA should look evolved unless something in CYMONIA caused it to evolve.

## Purpose

CYMONIA must evolve its technologies, structures, clothing, symbols, visual cultures and landscape from canonical history. Human code defines laws, scarcity, embodiment, perception, cognition and time; it does not define the civilization future identity.

## Invariants

- The SovereignWorld Durable Object remains the only mutation authority.
- AI proposes; deterministic kernel validation authorizes.
- Visual evolution requires canonical causes and real matter where physical objects are involved.
- Citizens cannot invent from unknown concepts or unknown parent designs.
- Observer rendering and generated assets never mutate canonical state.
- Every design has deterministic procedural fallback and preserved provenance/genealogy.
- Generated images are caches, never truth; external service failure cannot halt the world.
- Replay remains deterministic and public projection does not grant Citizen knowledge.
- No named cultural presets, faction colors or externally authored styles become canonical.

## Architecture

1. Canonical world: Citizens, knowledge, actions, objects, organizations, designs, lineages and adoption through real events.
2. Invention: bounded proposals constrained by knowledge, observed designs, materials, function and complexity.
3. Visual genome: renderer-independent structural description of form, materials, proportions, motifs and symbols.
4. Observer: deterministic Pixi and Canvas projections, with optional content-addressed generated assets.

Data flows only from cognition to validated design to physical object or project to public projection to renderer. Never from an image back into the world.

## Phase 1: Canonical Design Genome

Add world/designs.js with schema validation, design registration, derivation, novelty checks, cycle-free parentDesignIds, provenance and deterministic hashing. Extend existing artifact construction rather than replacing it. Design creation alone creates no matter; construction still consumes materials, labor and time.

A genome should express domain, form, known concepts, function, material requirements, physical claims, neutral primitives, palette roles, motif and symbol references, and causal provenance. Initial primitives remain geometry-neutral: point, line, strip, panel, volume, block, frame, layer, enclosure, opening, ridge, shell, support, repeated unit and surface motif.

Expose only public render data: id, parents, domain, structural genome, material roles, creator where permitted, creation minute and hash.

## Later phases

- Phase 2: site/life-readability.js, canonical action signatures, multi-scale activity and group readability.
- Phase 3: deterministic procedural structure renderer with Pixi and Canvas parity.
- Phase 4: canonical wearables and individual visual identity.
- Phase 5: symbols, motifs and emergent visual culture.
- Phase 6: bounded Workers AI invention proposals and teaching or observation.
- Phase 7: optional asynchronous generated-asset cache with strict budgets and fallback.
- Phase 8: Genesis-versus-now comparison and design genealogy explorer.

## Required tests

Prove that unknown concepts and parents are rejected, genealogy cannot cycle, invalid genomes fail, invention does not create matter, construction consumes matter, public projection does not grant knowledge, procedural rendering is deterministic, visual assets cannot mutate state, and failed generation leaves canonical state unchanged. Add seeded emergence tests for independent invention, derivation, adoption, disappearance from use and caused appearance changes.

## Non-goals

No user-authored skins, manual factions, named cultural eras, marketplace, blockchain ownership, generative 3D meshes, image generation inside world ticks, unconstrained model code or self-modifying kernel rules.

The desired outcome is not a better medieval simulation. It is a civilization whose future visual and logical identity is unknowable at Genesis, but causally explainable afterward.

