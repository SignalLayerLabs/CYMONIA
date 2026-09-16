# CYMONIA — Premium RTS Observer + Physical World Layer

This upgrade keeps Sovereign World v2 causal and observer-only while making the world visibly readable as a classic strategy game.

## Observer reliability

The browser now uses an explicit connection state machine: `CONNECTING`, `LIVE`, `DEGRADED`, `REPLAY`, and `RECONNECTING`. Genesis replay is temporary fallback only. A transient failure no longer strands a tab offline; canonical polling continues, WebSocket reconnect is deduplicated, and the last valid canonical snapshot remains on screen during short outages.

## Continuous movement

Rendering uses fractional world minutes. Canonical `MOVE` actions interpolate every animation frame instead of changing at integer-second boundaries. No `MOVE` means no visual roaming. The canonical action itself now carries its physical route/travel profile so the Observer can display the same path the simulation authorized.

## Classic RTS presentation

The Observer is a full-viewport game shell with a late-90s/early-2000s strategy vocabulary rather than a sterile isometric dashboard. It includes visible river/water, wetland, forest, meadow and rocky terrain, vegetation, natural deposits, shelters, real construction sites, readable units, shadows, rain, day/night tint, game HUD, minimap, Chronicle, Citizen inspector and causal WHY panel.

Semantic activity is still rendered only from canonical state. Ambient water, foliage, weather and light may animate because they represent environmental state, not invented Citizen actions.

## Physical laws v1

The new phenomenological world layer adds:

- deterministic terrain classes shared by the simulation and Observer;
- terrain-dependent movement cost;
- weather/soil contribution to movement cost;
- Citizen physical-capacity contribution to travel time;
- load-dependent movement time from physically held objects;
- structure occupancy and a simple route detour around occupied cores;
- construction-site collision checks;
- no ordinary construction directly in the river corridor;
- foundation work affected by terrain (wetland/rock/forest cost real time); 
- construction still consumes canonical material and labor;
- building thermal/rain protection derived from incorporated material properties;
- material thermal resistance and water resistance become discoverable through the existing experiment system;
- rain and thermal exposure affected by real shelters/buildings;
- river traversal carries a high movement cost;
- canonical action provenance records travel physics.

This is deliberately not atomic physics. It is an expandable, testable causal layer. The engine defines physical possibility; Citizens still choose goals and actions.

## Public Observer projection

The engine projection is extended, without exposing private human prompts, to include:

- MOVE path and physical travel profile;
- Citizen body temperature/exposure state;
- object material/properties needed for physical inspection.

The included patcher verifies exact current v2 structural anchors and is safe to run twice.

## Production-state safety

The package does **not** reset Genesis, change the seed, wipe the Durable Object, rewrite history or manufacture progression. Existing persisted world data remains in place. Existing active actions that predate the upgrade remain compatible; newly started MOVE/construction actions use the physical layer.

## PixiJS + Matter.js integration

The browser Observer now has an optional GPU path based on **PixiJS 8.19.0**. It keeps the existing Canvas renderer as a fallback, but when PixiJS is available the world is split into explicit GPU layers:

- terrain;
- water;
- vegetation;
- canonical resources;
- canonical structures/projects;
- Citizens;
- transient physical effects;
- atmosphere/weather.

The visual style remains classic RTS/top-down rather than a dashboard or technical isometric viewer.

**Matter.js 0.20.0 is deliberately observer-only.** It never decides canonical outcomes and never writes to `/api/v2/*`. It is used only to animate short-lived rigid-body consequences of events the Sovereign Kernel has already committed, such as debris after a canonical structure fracture.

The boundary is therefore:

> PixiJS shows the world. Matter.js animates physical consequences. The Sovereign Kernel decides reality.

If either CDN library is unavailable, CYMONIA falls back to the existing Canvas Observer without changing the canonical world.

## Impact and fracture physics

The physical kernel now exposes a canonical impact model based on projectile mass, velocity, material properties, structure condition and incorporated mass. It records `PHYSICAL_IMPACT`, can record `STRUCTURE_DAMAGED`, and on supercritical impacts converts structural mass into canonical debris objects through `STRUCTURE_FRACTURED` while preserving tracked mass.

Material properties now include friction, toughness and structural-integrity parameters in addition to density, hardness, thermal and water resistance. These are phenomenological simulation values, not claims of laboratory-grade material science.

Recent canonical impact/fracture events are projected read-only to the Observer so transient Matter.js effects can visualize exactly what the server already decided.
