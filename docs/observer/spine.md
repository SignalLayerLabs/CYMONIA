# Optional Spine Citizen renderer

CYMONIA's canonical world does not depend on animation middleware. Citizen animation is an Observer concern: canonical actions select a visual state, while the browser renderer may never create or modify world state.

## Current integration

The public MIT repository contains an action-to-animation contract, improved native PixiJS procedural Citizen motion, and `site/spine-citizen-adapter.js`, an optional adapter for a licensed Spine PixiJS v8 runtime and exported Citizen skeleton assets. The native renderer remains the automatic fallback.

No Spine Runtime source, package, CDN script, skeleton export, atlas, or proprietary asset is included or enabled by default.

## Licensing boundary

Spine Runtimes are governed by the Spine Runtimes License, not CYMONIA's MIT license. A valid Spine license is required when integrating or distributing the runtime under Esoteric Software's published terms. Keep the optional adapter disabled unless the project owner has satisfied those terms.

## Enabling a licensed rig

Configure the Observer before `sovereign-world.js` starts:

```js
window.CYMONIA_SPINE = {
  Spine: LicensedSpineConstructor,
  skeletonAlias: 'citizen-skeleton',
  atlasAlias: 'citizen-atlas',
  skeletonUrl: '/assets/licensed/citizen.skel',
  atlasUrl: '/assets/licensed/citizen.atlas',
  scale: 0.22,
  animations: {
    idle: 'idle',
    walk: 'walk',
    gather: 'gather',
    build: 'build',
    sleep: 'sleep',
    communicate: 'communicate',
    attack: 'attack',
    defend: 'defend'
  }
};
```

The adapter preloads the aliases through `PIXI.Assets`, creates one Spine container per living Citizen, and maps only canonical `currentAction.type` values to animation tracks. Missing assets or animations fall back safely.

A useful first rig should export at least `idle`, `walk`, `gather`, `build`, `sleep`, and `communicate`. Skins may represent Observer-side interpretations of canonical clothing, equipment and injuries, but they must never write back into the world.
