# CYMONIA Observer Art

CYMONIA uses an original medieval-isometric Observer treatment to make canonical world state legible as a living strategy world.

Current production art is intentionally small:

- `site/assets/medieval-atlas.png` — resources, structures and Citizen appearances;
- `site/assets/meadow-texture.png` — ground material;
- `site/medieval-art.js` — deterministic atlas/projection mapping;
- `site/pixi-observer.js` — GPU rendering;
- `site/sovereign-renderer.js` — camera, Canvas fallback, selection and minimap.

## Canonical boundary

Visuals are an interpretation layer. Decorative foliage does not create harvestable resources. Clothing does not create inventory. A completed building is rendered only when a canonical building exists. The browser may interpolate movement between canonical timestamps, but it cannot move a Citizen in world state.

## Screenshots

- [`../images/observer-desktop.png`](../images/observer-desktop.png)
- [`../images/observer-mobile.png`](../images/observer-mobile.png)

These show real deterministic/replayed world state rather than a fabricated marketing city.

## Validation

```bash
node tests/browser-art.mjs
node tests/browser-sovereign.mjs
node tests/browser-replay.mjs
```

The project does not reproduce Age of Empires assets or rely on a 3D engine.
