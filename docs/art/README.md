# Medieval Observer art revamp

Original medieval RTS art created with the built-in ImageGen tool on 2026-09-16. The 4 × 4 transparent atlas includes oak, fir, autumn oak, rocks, temporary shelter, cottage, communal hall, construction frame, berries, logs, ore, clay/reeds and four citizen appearances. The separate meadow material is blended with deterministic terrain and the canonical river course.

Assets: `site/assets/medieval-atlas.png` and `site/assets/meadow-texture.png`.

Both WebGL and Canvas share projection, atlas bounds, terrain, and canonical resource/structure filtering. Transparent pixels are ignored during selection. Trees, buildings and people are sorted by ground depth. The browser does not change simulation state. Decorative foliage and character attire are visual styling; they do not create harvestable resources, tools or inventory. Completed houses are shown only for existing canonical buildings; Genesis still starts with its actual temporary shelters.

Desktop and mobile screenshots here show the actual frozen Genesis replay, not a fabricated city. This is an original 2D isometric art treatment; it is not a 3D engine or a reproduction of Age of Empires assets.

Validation: unit/invariant suite, CHECK.sh, browser-sovereign.mjs, browser-replay.mjs, and browser-art.mjs (Canvas and GPU, selection, follow, knowledge/relations, windows, zoom, recenter, mobile). The generic game client also ran; its single-canvas capture cannot composite the separate WebGL and overlay canvases, so full-page browser screenshots are the visual evidence. Local static-server API 404s correctly enter the labeled frozen replay.

Run visual checks with a local server and Playwright installed:

    python3 -m http.server 8768 --directory site
    CYMONIA_URL=http://127.0.0.1:8768 node tests/browser-art.mjs

Marginal was enabled with live lifecycle hooks in the task workspace. Mode remained Shadow because promotion evidence was not sufficient. No measured credit savings are claimed.
